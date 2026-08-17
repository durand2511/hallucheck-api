// HalluCheck — hallucinatie-verificatie API (Chain-of-Verification / FActScore-principes)
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chat, anthropicWebSearch } = require("./lib/providers");
const { verify, refine } = require("./lib/verify");
const { selfCheck } = require("./lib/selfcheck");
const sagemakerModel = require("./lib/sagemaker");
const { requireApiKey, recordUsage, createCustomer, createApiKey } = require("./lib/auth");

const PORT = process.env.PORT || 8091;
const ROOT = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data.json");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

// ---------- opslag ----------
function load() { try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch { return { providers: [], logs: [] }; } }
let store = load();
const save = () => fs.writeFileSync(DATA, JSON.stringify(store, null, 2));

// cfg: haal de opgeslagen key voor een provider (of MOCK)
const makeCfg = () => ({ getKey: (provider) => { const p = store.providers.find((x) => x.provider === provider); return p ? p.apiKey : null; } });

// ---------- helpers ----------
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
const mask = (k) => (k && k.length > 8 ? k.slice(0, 4) + "…" + k.slice(-4) : "••••");

// ---------- static ----------
function serveStatic(req, res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  const fp = path.join(ROOT, path.normalize(urlPath));
  if (!fp.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });
  fs.readFile(fp, (e, data) => e ? json(res, 404, { error: "not found" }) : (res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" }), res.end(data)));
}

// ---------- admin ----------
async function handleAdmin(req, res, urlPath) {
  if (urlPath === "/admin/providers" && req.method === "GET")
    return json(res, 200, store.providers.map((p) => ({ ...p, apiKey: mask(p.apiKey) })));
  if (urlPath === "/admin/providers" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.provider || !b.apiKey) return json(res, 400, { error: "provider en apiKey verplicht" });
    store.providers = store.providers.filter((p) => p.provider !== b.provider); // 1 key per provider
    store.providers.push({ provider: b.provider, apiKey: b.apiKey });
    save();
    return json(res, 200, { ok: true });
  }
  if (urlPath === "/admin/logs" && req.method === "GET") return json(res, 200, store.logs.slice(-50).reverse());
  if (urlPath === "/admin/customers" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.email) return json(res, 400, { error: "veld 'email' verplicht" });
    try {
      const customer = await createCustomer({ email: b.email, company: b.company });
      const apiKey = await createApiKey(customer.id, b.label || "default");
      return json(res, 200, { customerId: customer.id, email: customer.email, apiKey });
    } catch (e) { return json(res, 502, { error: String(e.message || e) }); }
  }
  return json(res, 404, { error: "onbekend" });
}

function logRun(entry) { store.logs.push({ ts: Date.now(), ...entry }); if (store.logs.length > 2000) store.logs = store.logs.slice(-2000); save(); }

// ---------- /verify : verifieer een gegeven antwoord tegen bronnen ----------
async function handleVerify(req, res) {
  const b = await readBody(req);
  const judgeModel = b.judge_model || b.model || "claude-haiku-4-5";
  const sources = normSources(b.sources);
  if (!b.answer) return json(res, 400, { error: "veld 'answer' verplicht" });
  try {
    const v = await verify(makeCfg(), judgeModel, b.answer, sources);
    logRun({ type: "verify", judgeModel, score: v.score, total: v.total, contradicted: v.contradicted });
    return json(res, 200, v);
  } catch (e) { return json(res, 502, { error: String(e.message || e) }); }
}

// ---------- /v1/chat/completions : drop-in, genereert + verifieert ----------
async function handleChat(req, res) {
  const b = await readBody(req);
  const model = b.model || "claude-haiku-4-5";
  const judgeModel = b.judge_model || model;
  const sources = normSources(b.x_sources || b.sources);
  const doVerify = b.x_verify !== false; // standaard aan
  const cfg = makeCfg();
  try {
    // 1) VRIJ genereren — het model antwoordt gewoon, zonder bronnen vooraf (zoals een normaal model).
    const gen = await chat(cfg, model, b.messages || [], { max_tokens: b.max_tokens, temperature: b.temperature });
    // 2) POST-HOC verificatie — pas ná het antwoord: elke claim toetsen tegen bewijs
    //    (citaties via Crossref, feiten via web-search/Wikipedia). Dit is de CoE Integrity Audit.
    let verification = null;
    if (doVerify) verification = await verify(cfg, judgeModel, gen.text, sources, { autoEvidence: true });
    logRun({ type: "chat", model, judgeModel, score: verification ? verification.score : null, contradicted: verification ? verification.contradicted : null });
    return json(res, 200, {
      id: "chatcmpl-" + crypto.randomBytes(8).toString("hex"),
      object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content: gen.text }, finish_reason: "stop" }],
      usage: { prompt_tokens: gen.inTok, completion_tokens: gen.outTok, total_tokens: gen.inTok + gen.outTok },
      x_verification: verification,
    });
  } catch (e) { return json(res, 502, { error: { message: String(e.message || e) } }); }
}

// ---------- /answer : genereer → verifieer → REFINE-lus tot hallucinatie-vrij ----------
async function handleAnswer(req, res) {
  const b = await readBody(req);
  const model = b.model || "claude-haiku-4-5";
  const judgeModel = b.judge_model || model;
  const sources = normSources(b.x_sources || b.sources);
  const maxRefine = Math.min(b.max_refine ?? 2, 4);
  const cfg = makeCfg();
  const question = (b.messages && [...b.messages].reverse().find((m) => m.role === "user")?.content) || b.prompt || "";
  try {
    let answer = (await chat(cfg, model, b.messages || [{ role: "user", content: String(question) }], { max_tokens: b.max_tokens, temperature: b.temperature })).text;
    let v = await verify(cfg, judgeModel, answer, sources, { autoEvidence: true });
    const history = [{ iter: 0, answer, score: v.score, contradicted: v.contradicted }];
    let iter = 0;
    while (v && v.contradicted > 0 && iter < maxRefine) {
      iter++;
      const ref = await refine(cfg, model, question, answer, v);
      answer = ref.text;
      v = await verify(cfg, judgeModel, answer, sources, { autoEvidence: true });
      history.push({ iter, answer, score: v.score, contradicted: v.contradicted });
    }
    logRun({ type: "answer", model, judgeModel, iterations: iter, finalScore: v ? v.score : null, finalContradicted: v ? v.contradicted : null });
    return json(res, 200, { answer, verification: v, iterations: iter, clean: v ? v.contradicted === 0 : null, history });
  } catch (e) { return json(res, 502, { error: String(e.message || e) }); }
}

// ---------- /selfcheck : ZONDER web-search — zelf-consistentie legt eigen hallucinaties bloot ----------
async function handleSelfCheck(req, res) {
  const b = await readBody(req);
  const cfg = makeCfg();
  const model = b.model || "deepseek-chat";
  const judgeModel = b.judge_model || model;
  const question = (b.messages && [...b.messages].reverse().find((m) => m.role === "user")?.content) || b.prompt || "";
  const k = Math.min(Math.max(b.samples ?? 3, 2), 5);
  try {
    // 1) eerste poging (de "opgewekte" hallucinatie kan hier ontstaan)
    const draft = (await chat(cfg, model, [{ role: "user", content: String(question) }], { max_tokens: 800, temperature: 0.7 })).text;
    // 2) zelf-consistentie: model ziet z'n eigen verzinsels → 3) schoon antwoord
    const sc = await selfCheck(cfg, model, judgeModel, question, draft, k);
    logRun({ type: "selfcheck", model, hallucinations: sc.hallucinations.length });
    return json(res, 200, { draft, ...sc });
  } catch (e) { return json(res, 502, { error: String(e.message || e) }); }
}

// ---------- /grounded : schrijf MÉT web-search (gegrond tijdens het schrijven → nul hallucinaties) ----------
async function handleGrounded(req, res) {
  const b = await readBody(req);
  const cfg = makeCfg();
  const judgeModel = b.judge_model || "claude-haiku-4-5";
  const question = (b.messages && [...b.messages].reverse().find((m) => m.role === "user")?.content) || b.prompt || "";
  const apiKey = cfg.getKey("anthropic");
  if (!apiKey || apiKey === "MOCK") return json(res, 400, { error: "Grounded generatie gebruikt Claude's INGEBOUWDE web-search — voeg eerst een Anthropic-key toe." });
  const model = /^claude/.test(b.model || "") ? b.model : "claude-sonnet-5";
  try {
    // 1) SCHRIJF met web-search: het model zoekt terwijl het schrijft en put alleen uit echte bronnen
    const g = await anthropicWebSearch({ apiKey, model,
      system: "Beantwoord de vraag nauwkeurig. Zoek waar nodig met web-search en baseer je UITSLUITEND op wat je in de zoekresultaten vindt. Verzin niets: als iets niet in de bronnen staat, zeg dat je het niet betrouwbaar kon vinden. Noem bij feiten de bron-URL.",
      messages: [{ role: "user", content: String(question) }], max_tokens: 2500 });
    // 2) Verifieer alleen ter BEVESTIGING (zou nul tegengesproken moeten opleveren)
    const v = await verify(cfg, judgeModel, g.text, [], { autoEvidence: true });
    logRun({ type: "grounded", model, score: v.score, contradicted: v.contradicted });
    return json(res, 200, { answer: g.text, groundedOn: g.urls, verification: v });
  } catch (e) { return json(res, 502, { error: String(e.message || e) }); }
}

// ---------- /v1/ask : het verkochte product-oppervlak — eigen document + vraag → gegrond antwoord ----------
// via de vanKonijnenburg-SageMaker-endpoint (Gemma-4-31B-it + dpo_gemma31b_grounding-adapter_v2).
async function handleAsk(req, res, customer) {
  const b = await readBody(req);
  if (!b.question) return json(res, 400, { error: { message: "veld 'question' verplicht" } });
  try {
    const t0 = Date.now();
    const { answer, extraction } = await sagemakerModel.ask({ question: b.question, document: b.document });
    const ms = Date.now() - t0;
    await recordUsage(customer, { route: "/v1/ask", ms });
    logRun({ type: "ask", customerId: customer.id, ms });
    return json(res, 200, {
      id: "ask-" + crypto.randomBytes(8).toString("hex"),
      model: "vankonijnenburg-1",
      answer,
      x_extraction: extraction,
    });
  } catch (e) { return json(res, 502, { error: { message: String(e.message || e) } }); }
}

function normSources(src) {
  if (!src) return [];
  if (typeof src === "string") return src.trim() ? [{ id: "S1", text: src }] : [];
  if (Array.isArray(src)) return src.map((s, i) => (typeof s === "string" ? { id: "S" + (i + 1), text: s } : { id: s.id || "S" + (i + 1), text: String(s.text || "") })).filter((s) => s.text.trim());
  return [];
}

// ---------- router ----------
http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  try {
    if (urlPath === "/healthz" && req.method === "GET") return json(res, 200, { ok: true });
    if (urlPath === "/v1/ask" && req.method === "POST") {
      const customer = await requireApiKey(req);
      if (!customer) return json(res, 401, { error: { message: "ongeldige of ontbrekende Authorization: Bearer <api key>" } });
      return handleAsk(req, res, customer);
    }
    if (urlPath === "/v1/chat/completions" && req.method === "POST") return handleChat(req, res);
    if (urlPath === "/verify" && req.method === "POST") return handleVerify(req, res);
    if (urlPath === "/answer" && req.method === "POST") return handleAnswer(req, res);
    if (urlPath === "/selfcheck" && req.method === "POST") return handleSelfCheck(req, res);
    if (urlPath === "/grounded" && req.method === "POST") return handleGrounded(req, res);
    if (urlPath.startsWith("/admin/")) return handleAdmin(req, res, urlPath);
    return serveStatic(req, res, urlPath);
  } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => {
  console.log(`\n  HalluCheck — hallucinatie-verificatie API → http://localhost:${PORT}`);
  console.log(`  drop-in endpoint → POST http://localhost:${PORT}/v1/chat/completions  (met x_sources + x_verify)`);
  console.log(`  los verifiëren   → POST http://localhost:${PORT}/verify  ({answer, sources})\n`);
});
