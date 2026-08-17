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
const ADAPTER_COMPONENT = process.env.SAGEMAKER_ADAPTER_NAME || "vankonijnenburg-adapter-v2";
const REGION = process.env.AWS_REGION || "us-east-1";
// EXTRACT_SYSTEM itself is ~2500 tokens; keep each chunk well under the 8192-token context
// budget alongside it plus the response. ~9000 chars is a conservative ~2200-2500 token chunk.
const CHUNK_CHARS = Number(process.env.DOC_CHUNK_CHARS || 9000);
const CHUNK_OVERLAP = 300; // avoid splitting a fact across a chunk boundary

const client = new SageMakerRuntimeClient({ region: REGION });

// Single generation round against the endpoint. Runs on djl_python's plain HuggingFace engine
// (not vLLM -- switched because vLLM's rolling-batch quantize enum doesn't accept bitsandbytes).
// The adapter is selected via InferenceComponentName (SageMaker's own adapter-routing), not a
// field in the body. Response/request shapes were not fully verifiable before first real
// invocation -- parsing below is defensive across the couple of formats djl_python's
// huggingface.py handler is known to use (HF pipeline list, dict, or OpenAI-style choices).
async function invokeOnce(messages, maxNew) {
  const payload = {
    inputs: messages,
    parameters: { max_new_tokens: maxNew, temperature: 0.0, do_sample: false },
  };
  const cmd = new InvokeEndpointCommand({
    EndpointName: ENDPOINT_NAME,
    InferenceComponentName: ADAPTER_COMPONENT,
    ContentType: "application/json",
    Body: Buffer.from(JSON.stringify(payload)),
  });
  const res = await client.send(cmd);
  const body = JSON.parse(Buffer.from(res.Body).toString("utf8"));
  const first = Array.isArray(body) ? body[0] : body;
  const text = (
    first?.generated_text ??
    first?.choices?.[0]?.message?.content ??
    first?.choices?.[0]?.text ??
    (typeof first === "string" ? first : "") ?? ""
  ).trim();
  const finishReason = first?.choices?.[0]?.finish_reason ?? (first?.generated_text != null ? "stop" : "length");
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

// Splits an arbitrarily large document into context-sized chunks, breaking on paragraph/sentence
// boundaries where possible so a fact isn't cut mid-sentence. Small documents => a single chunk.
function chunkDocument(doc) {
  if (doc.length <= CHUNK_CHARS) return [doc];
  const chunks = [];
  let pos = 0;
  while (pos < doc.length) {
    let end = Math.min(pos + CHUNK_CHARS, doc.length);
    if (end < doc.length) {
      const boundary = doc.lastIndexOf("\n\n", end);
      const sentenceBoundary = doc.lastIndexOf(". ", end);
      const cut = boundary > pos + CHUNK_CHARS * 0.5 ? boundary : (sentenceBoundary > pos + CHUNK_CHARS * 0.5 ? sentenceBoundary + 1 : end);
      end = cut;
    }
    chunks.push(doc.slice(pos, end).trim());
    pos = Math.max(end - CHUNK_OVERLAP, end === doc.length ? doc.length : pos + 1);
  }
  return chunks.filter(Boolean);
}

// Parses an EXTRACT_SYSTEM output block into structured, independently quotable citations:
// one per main-list fact line and one per narrative_facts line. Skips "geen"/no-match placeholders.
function parseCitations(extraction, chunkIndex) {
  const citations = [];
  const factsBlock = /<facts>([\s\S]*?)<\/facts>/i.exec(extraction);
  if (factsBlock) {
    for (const line of factsBlock[1].split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (/^NO_RELEVANT_FACTS_FOUND$/i.test(line)) continue;
      citations.push({ type: "fact", quote: line, chunk: chunkIndex });
    }
  }
  const narrativeBlock = /<narrative_facts>([\s\S]*?)<\/narrative_facts>/i.exec(extraction);
  if (narrativeBlock) {
    for (const line of narrativeBlock[1].split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (/^geen$/i.test(line)) continue;
      citations.push({ type: "narrative", quote: line, chunk: chunkIndex });
    }
  }
  return citations;
}

const isNoRelevantFacts = (extraction) => /NO_RELEVANT_FACTS_FOUND/i.test(extraction) && !/<narrative_facts>\s*(?!geen)\S/i.test(extraction);

// Public entry point: { question, document } -> { answer, citations, extraction }
// document is the customer's own source text (any length); question is what they want answered
// against it. Large documents are split into chunks, each extracted independently, then merged
// into a single facts list the compose stage reasons over -- this is how "any size" is supported
// without exceeding the model's context window.
// Runs multiple chunk-extraction "agents" concurrently (bounded, so a large document doesn't
// flood the single endpoint with dozens of simultaneous requests) instead of one-at-a-time.
// This only changes speed, never per-chunk analysis quality -- each chunk is still read and
// extracted fully independently, exactly as it would be sequentially.
const MAX_CONCURRENT_CHUNKS = Number(process.env.MAX_CONCURRENT_CHUNKS || 4);

async function extractAllChunks(q, chunks) {
  const results = new Array(chunks.length);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      const extractUser = `QUESTION: ${q}\n\nDOCUMENT${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ""}:\n${chunks[i]}`;
      let extraction = await gen(EXTRACT_SYSTEM, extractUser, 1200, 1);
      extraction = cleanExtraction(extraction);
      results[i] = { chunk: i, extraction, hasFacts: !isNoRelevantFacts(extraction) };
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunks.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function ask({ question, document }) {
  const doc = String(document || "");
  const q = String(question || "");
  const chunks = chunkDocument(doc);

  const perChunkExtractions = await extractAllChunks(q, chunks);

  const relevant = perChunkExtractions.filter((c) => c.hasFacts);
  const mergedExtraction = (relevant.length ? relevant : perChunkExtractions.slice(0, 1))
    .map((c) => c.extraction).join("\n\n");
  const citations = perChunkExtractions.flatMap((c) => parseCitations(c.extraction, c.chunk));

  const composeUser = `QUESTION: ${q}\n\nFACTS LIST (extracted earlier):\n${mergedExtraction}`;
  let answer = await gen(COMPOSE_SYSTEM, composeUser, 1200, 1);
  answer = cleanAnswer(answer);

  return { answer, citations, extraction: mergedExtraction, chunkCount: chunks.length };
}

module.exports = { ask };
