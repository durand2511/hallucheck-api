// Extract-then-compose pipeline against the SageMaker-hosted vanKonijnenburg model
// (google/gemma-4-31B-it base + dpo_gemma31b_grounding-adapter_v2), ported from the
// proven local RunPod evaluation script scripts/eval_extract_compose_gemma.py.
// Prompts in lib/prompts/*.txt are extracted verbatim from that script -- do not
// hand-edit them here, edit the source script and re-extract instead.
const fs = require("node:fs");
const path = require("node:path");
const { SageMakerRuntimeClient, InvokeEndpointCommand } = require("@aws-sdk/client-sagemaker-runtime");

const EXTRACT_SYSTEM = fs.readFileSync(path.join(__dirname, "prompts", "extract_system.txt"), "utf8");
const COMPOSE_SYSTEM = fs.readFileSync(path.join(__dirname, "prompts", "compose_system.txt"), "utf8");

const ENDPOINT_NAME = process.env.SAGEMAKER_ENDPOINT_NAME || "vankonijnenburg-1";
const REGION = process.env.AWS_REGION || "us-east-1";
const MAX_DOC_CHARS = Number(process.env.MAX_DOC_CHARS || 12000);

const client = new SageMakerRuntimeClient({ region: REGION });

// Single generation round against the endpoint. The LMI/vLLM container is invoked with an
// OpenAI-chat-compatible payload; response shape is `{ choices: [{ message, finish_reason }] }`.
// NOT YET VERIFIED against a live endpoint -- confirm this parsing once the endpoint is up,
// adjust if the actual container response shape differs (e.g. plain `generated_text`).
async function invokeOnce(messages, maxNew) {
  const payload = {
    messages,
    max_tokens: maxNew,
    temperature: 0,
    // Routes to the adapter inference component layered on the base model.
    adapter: process.env.SAGEMAKER_ADAPTER_NAME || "grounding-v2",
  };
  const cmd = new InvokeEndpointCommand({
    EndpointName: ENDPOINT_NAME,
    ContentType: "application/json",
    Body: Buffer.from(JSON.stringify(payload)),
  });
  const res = await client.send(cmd);
  const body = JSON.parse(Buffer.from(res.Body).toString("utf8"));
  const choice = body.choices?.[0];
  const text = (choice?.message?.content ?? body.generated_text ?? "").trim();
  const finishReason = choice?.finish_reason ?? (body.generated_text ? "stop" : "length");
  return { text, endedNaturally: finishReason === "stop" };
}

// Mirrors gen() in eval_extract_compose_gemma.py: if the model was cut off by max_tokens
// (not a natural stop), ask it to continue rather than guessing a higher limit up front.
async function gen(system, user, maxNew, maxContinuations = 1) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let fullText = "";
  for (let round = 0; round <= maxContinuations; round++) {
    const { text, endedNaturally } = await invokeOnce(messages, maxNew);
    fullText += (fullText ? " " : "") + text;
    if (endedNaturally) break;
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: "Ga door precies waar je gebleven was, zonder iets te herhalen." });
  }
  return fullText.trim();
}

function cleanExtraction(extraction) {
  const m = /<\/self_described>/i.exec(extraction);
  return m ? extraction.slice(0, m.index + m[0].length) : extraction;
}

// Ports the 5-stage answer cleanup from the eval script verbatim (leak language, degenerate
// repetition, trailing symbol lines, trailing loose fragments) -- these patterns were each
// found empirically against real failure cases, see hallucheck-fix-iteration-methodology.
function cleanAnswer(answer) {
  let a = answer;

  const leak = /\bthought\b|\bwait\b[*_]{0,2}[,.\-—]|\blet me restart\b/i.exec(a);
  if (leak && leak.index > 30) a = a.slice(0, leak.index).trimEnd();

  const degenerate = /(.{2,80}?)\1{3,}/s.exec(a);
  if (degenerate && degenerate.index > 30) a = a.slice(0, degenerate.index).trimEnd();

  let tailSymbols = /\n\s*[^\w\s]{1,10}\s*$/.exec(a);
  while (tailSymbols && tailSymbols.index > 30) {
    a = a.slice(0, tailSymbols.index).trimEnd();
    tailSymbols = /\n\s*[^\w\s]{1,10}\s*$/.exec(a);
  }

  const tailFragment = /([.!?])\s*\n+\s*([^\n]{1,40})$/.exec(a);
  if (tailFragment && tailFragment.index > 30 && !/[.!?]\s*$/.test(tailFragment[2])) {
    a = a.slice(0, tailFragment.index + 1).trimEnd();
  }

  const tailShortLine = /([.!?])\s*\n+\s*([^\n]{1,50}[.!?]?)\s*$/.exec(a);
  if (tailShortLine && tailShortLine.index > 30) {
    a = a.slice(0, tailShortLine.index + 1).trimEnd();
  }

  return a;
}

// Public entry point: { question, document } -> { answer, extraction }
// document is the customer's own source text; question is what they want answered against it.
async function ask({ question, document }) {
  const doc = String(document || "").slice(0, MAX_DOC_CHARS);
  const q = String(question || "");

  const extractUser = `QUESTION: ${q}\n\nDOCUMENT:\n${doc}`;
  let extraction = await gen(EXTRACT_SYSTEM, extractUser, 1200, 1);
  extraction = cleanExtraction(extraction);

  const composeUser = `QUESTION: ${q}\n\nFACTS LIST (extracted earlier):\n${extraction}`;
  let answer = await gen(COMPOSE_SYSTEM, composeUser, 1200, 1);
  answer = cleanAnswer(answer);

  return { answer, extraction };
}

module.exports = { ask };
