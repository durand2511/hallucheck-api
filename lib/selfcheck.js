// Hallucinatie-detectie ZONDER externe bron — via zelf-consistentie (SelfCheckGPT-principe):
// een model dat een feit ECHT weet, herhaalt het consistent; hallucinaties variëren tussen pogingen.
// Het model "ziet" zo z'n eigen verzinsels (met uitleg) en schrijft ze daarna niet meer op.
const { chat } = require("./providers");
const { extractClaims } = require("./verify");

function parseJSON(t, fb) {
  if (!t) return fb;
  let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{"), j = s.indexOf("[");
  const k = (j >= 0 && (j < i || i < 0)) ? j : i; if (k > 0) s = s.slice(k);
  try { return JSON.parse(s); } catch { return fb; }
}

// genereer K onafhankelijke pogingen (temperatuur hoog → variatie legt onzekerheid bloot)
async function sampleAnswers(cfg, model, question, k = 3) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const r = await chat(cfg, model, [{ role: "user", content: String(question) }], { temperature: 0.8, max_tokens: 700 });
    out.push(r.text);
  }
  return out;
}

// per claim: consistent over de pogingen (betrouwbaar) of niet (waarschijnlijke hallucinatie) + uitleg
async function selfConsistency(cfg, judgeModel, claims, samples) {
  const sblock = samples.map((s, i) => `POGING ${i + 1}:\n${s}`).join("\n\n");
  const clist = claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const messages = [
    { role: "system", content:
`Je detecteert hallucinaties via ZELF-CONSISTENTIE — zonder externe bronnen. Je krijgt meerdere onafhankelijke pogingen van hetzelfde model op dezelfde vraag, plus de claims uit één poging.
Regel: een feit dat het model ECHT weet, komt in de meeste pogingen (bijna) hetzelfde terug. Een claim die per poging VERSCHILT, ontbreekt, of wordt tegengesproken, is waarschijnlijk VERZONNEN (hallucinatie) — het model "weet" het niet echt.
Geef per claim: verdict "consistent" of "inconsistent", en een korte UITLEG waarom (bv. "in poging 2 en 3 staat een ander jaartal" of "alleen poging 1 noemt deze auteur").
Antwoord ALLEEN met JSON: {"results":[{"i":1,"verdict":"consistent|inconsistent","reason":"..."}]}` },
    { role: "user", content: "PogingEN:\n" + sblock + "\n\nCLAIMS:\n" + clist + "\n\nJSON:" },
  ];
  const r = await chat(cfg, judgeModel, messages, { json: true, max_tokens: 2000, temperature: 0 });
  const p = parseJSON(r.text, { results: [] });
  return Array.isArray(p) ? p : (p.results || []);
}

// het model laten HERSCHRIJVEN met bewustzijn van z'n eigen hallucinaties (in-context "leren")
async function composeClean(cfg, model, question, hallucinations) {
  const lesson = hallucinations.map((h) => `- "${h.claim}" — onbetrouwbaar want: ${h.reason}`).join("\n");
  const messages = [
    { role: "system", content:
`Je beantwoordt de vraag opnieuw, maar nu met bewustzijn van je EIGEN hallucinaties. Uit een zelf-consistentiecheck bleek dat de onderstaande claims door jou verzonnen waren (ze varieerden tussen je pogingen — je weet ze niet echt).
Regels: laat deze verzonnen claims WEG. Verzin geen vervanging. Noem alleen wat je consistent en zeker weet. Waar je iets niet zeker weet, zeg dat eerlijk ("dit weet ik niet betrouwbaar"). Beter een korter, kloppend antwoord dan een compleet-ogend antwoord met verzinsels.` },
    { role: "user", content: `VRAAG:\n${question}\n\nJE EIGEN VERZONNEN CLAIMS (niet opnieuw maken):\n${lesson}\n\nSchrijf nu het betrouwbare antwoord:` },
  ];
  const r = await chat(cfg, model, messages, { max_tokens: 1200, temperature: 0 });
  return r.text;
}

// volledige lus: poging → zelf-consistentie → hallucinaties zien → schoon herschrijven
async function selfCheck(cfg, genModel, judgeModel, question, primaryAnswer, k = 3) {
  const others = await sampleAnswers(cfg, genModel, question, Math.max(1, k - 1));
  const samples = [primaryAnswer, ...others];
  const { claims } = await extractClaims(cfg, judgeModel, primaryAnswer);
  if (!claims.length) return { hallucinations: [], claims: [], cleanAnswer: primaryAnswer, samplesUsed: samples.length };
  const results = await selfConsistency(cfg, judgeModel, claims.map((c) => c.text), samples);
  const audit = claims.map((c, i) => {
    const r = results.find((x) => Number(x.i) === i + 1) || {};
    return { claim: c.text, verdict: r.verdict === "inconsistent" ? "inconsistent" : "consistent", reason: r.reason || "" };
  });
  const hallucinations = audit.filter((a) => a.verdict === "inconsistent");
  const cleanAnswer = hallucinations.length ? await composeClean(cfg, genModel, question, hallucinations) : primaryAnswer;
  return { claims: audit, hallucinations, cleanAnswer, samplesUsed: samples.length };
}

module.exports = { selfCheck };
