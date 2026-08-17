// Chain-of-Evidence (CoE) verificatie — trouw aan ScientistOne (Google, arXiv 2605.26340):
//  - claim-taxonomie: citation / numerical / methodological / conclusion
//  - elke claim herleidbaar naar bewijs (evidence chain)
//  - citation-claims: referentie-verificatie (bestaat de bron? = CoE Integrity check I3)
//  - overige claims: entailment tegen de opgegeven bronnen (supported/contradicted/insufficient)
const { chat, anthropicWebSearch } = require("./providers");
const { searchCrossref } = require("./refcheck");
const { gatherEvidence } = require("./evidence");

function parseJSON(text, fallback) {
  if (!text) return fallback;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"), a = t.indexOf("[");
  const start = (a >= 0 && (a < s || s < 0)) ? a : s;
  if (start > 0) t = t.slice(start);
  try { return JSON.parse(t); } catch { return fallback; }
}

// ---- Stap 1: claim-decompositie + taxonomie ----
async function extractClaims(cfg, model, answer) {
  const messages = [
    { role: "system", content:
`Je bent een precieze feit-extractor voor Chain-of-Evidence-verificatie. Splits de tekst in losse ATOMAIRE, verifieerbare claims (los verwijswoorden op). Classificeer elke claim in één type:
- "citation": verwijst naar/citeert een bron of publicatie.
- "numerical": bevat een getal/statistiek/score.
- "methodological": beschrijft hoe iets werkt/gedaan is.
- "conclusion": een gevolgtrekking/bewering.
Bij "citation": geef "reference" = de volledige citatie (auteurs, jaar, titel) én "title" = ALLEEN de exacte titel van het werk. Anders beide leeg.
Antwoord ALLEEN met JSON: {"claims":[{"text":"...","type":"...","reference":"...","title":"..."}]}` },
    { role: "user", content: "TEKST:\n" + answer + "\n\nGeef de JSON." },
  ];
  const r = await chat(cfg, model, messages, { json: true, max_tokens: 1800, temperature: 0 });
  const parsed = parseJSON(r.text, { claims: [] });
  let claims = Array.isArray(parsed) ? parsed : (parsed.claims || []);
  claims = claims.map((c) => (typeof c === "string" ? { text: c, type: "conclusion", reference: "" } : c))
    .filter((c) => c && c.text)
    .map((c) => ({ text: String(c.text), type: ["citation", "numerical", "methodological", "conclusion"].includes(c.type) ? c.type : "conclusion", reference: String(c.reference || ""), title: String(c.title || "") }));
  return { claims, usage: r };
}

// ---- Entailment-oordeel (batched) voor niet-citation claims ----
async function judgeClaims(cfg, model, claims, sources) {
  if (!claims.length) return { results: [] };
  const srcBlock = sources.map((s, i) => `[S${i + 1}] ${s.text}`).join("\n\n");
  const list = claims.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
  const messages = [
    { role: "system", content:
`Je bent een strenge fact-checker (Chain-of-Evidence). Beoordeel ELKE claim UITSLUITEND op de gegeven BRONNEN — verzin niets, gebruik geen eigen kennis.
- "supported": de bronnen bevestigen de claim expliciet (geef het letterlijke citaat + bron-id).
- "contradicted": de bronnen spreken de claim tegen (= hallucinatie).
- "insufficient": de bronnen zeggen er niets over.
Antwoord ALLEEN met JSON: {"results":[{"i":1,"verdict":"supported|contradicted|insufficient","evidence":"letterlijk citaat of leeg","source":"S1 of leeg","confidence":0.0-1.0}]}` },
    { role: "user", content: `BRONNEN:\n${srcBlock || "(geen)"}\n\nCLAIMS:\n${list}\n\nJSON:` },
  ];
  const r = await chat(cfg, model, messages, { json: true, max_tokens: 2500, temperature: 0 });
  const parsed = parseJSON(r.text, { results: [] });
  return { results: Array.isArray(parsed) ? parsed : (parsed.results || []) };
}

// ---- LLM-cross-check van referenties tegen Crossref-resultaten (CoE I3) ----
async function judgeReferences(cfg, model, refItems) {
  const block = refItems.map((it, k) =>
    `${k + 1}. GECLAIMDE REFERENTIE: ${it.ref}\n   CROSSREF-RESULTATEN:\n${it.candidates.map((c) => `   - "${c.title}"${c.year ? " (" + c.year + ")" : ""}`).join("\n") || "   (geen)"}`
  ).join("\n\n");
  const messages = [
    { role: "system", content:
`Je verifieert of geciteerde referenties ECHT bestaan (Chain-of-Evidence Integrity check I3). Voor elke geclaimde referentie: bevatten de Crossref-resultaten HETZELFDE werk (zelfde titel/onderwerp)?
- exists=true als één van de resultaten duidelijk hetzelfde werk is.
- exists=false als de resultaten ANDERE werken zijn (de geclaimde titel bestaat dus niet) — dat wijst op een gehallucineerde/verzonnen referentie.
Antwoord ALLEEN met JSON: {"results":[{"i":1,"exists":true|false,"title":"de matchende titel of leeg"}]}` },
    { role: "user", content: block + "\n\nJSON:" },
  ];
  const r = await chat(cfg, model, messages, { json: true, max_tokens: 1200, temperature: 0 });
  const parsed = parseJSON(r.text, { results: [] });
  return Array.isArray(parsed) ? parsed : (parsed.results || []);
}

// ---- Verify Sources via Claude's INGEBOUWDE web-search (het hele web) ----
async function verifyViaClaudeSearch(cfg, judgeModel, claims) {
  const apiKey = cfg.getKey("anthropic");
  const model = /^claude/.test(judgeModel) ? judgeModel : "claude-haiku-4-5";
  const list = claims.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
  const system = `Je verifieert feitelijke claims tegen het LIVE web. Zoek waar nodig met web-search. Bepaal per claim:
- "supported": het web bevestigt de claim (geef een korte bewijs-passage + bron-URL).
- "contradicted": het web spreekt de claim tegen (= hallucinatie) (geef de tegensprekende bron + URL).
- "insufficient": niet te vinden/bepalen.
Antwoord UITSLUITEND met JSON, geen andere tekst:
{"results":[{"i":1,"verdict":"supported|contradicted|insufficient","evidence":"korte passage","source":"URL","confidence":0.0-1.0}]}`;
  const r = await anthropicWebSearch({ apiKey, model, system, messages: [{ role: "user", content: "CLAIMS:\n" + list + "\n\nZoek en geef de JSON." }], max_tokens: 3000 });
  const parsed = parseJSON(r.text, { results: [] });
  return { results: Array.isArray(parsed) ? parsed : (parsed.results || []), urls: r.urls || [] };
}

// ---- Orchestratie ----
async function verify(cfg, judgeModel, answer, sources, opts = {}) {
  const autoEvidence = opts.autoEvidence !== false;
  if (!answer || !answer.trim()) return { score: null, error: "leeg antwoord" };
  const { claims } = await extractClaims(cfg, judgeModel, answer);
  if (!claims.length) return { score: null, claims: [], note: "geen verifieerbare claims gevonden" };

  const audit = new Array(claims.length);

  // I3 — referentie-verificatie: zoek Crossref-kandidaten (sequentieel), dan LLM-cross-check
  const citationIdx = claims.map((c, i) => (c.type === "citation" ? i : -1)).filter((i) => i >= 0);
  const refItems = [];
  for (let n = 0; n < citationIdx.length; n++) {
    const i = citationIdx[n];
    const c = claims[i];
    const s = await searchCrossref(c.reference || c.title || c.text);
    refItems.push({ i, ref: c.reference || c.title || c.text, candidates: s.items, ok: s.ok, note: s.note });
    if (n < citationIdx.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
  const refVerdicts = refItems.length ? await judgeReferences(cfg, judgeModel, refItems) : [];
  refItems.forEach((it, k) => {
    const v = refVerdicts.find((x) => Number(x.i) === k + 1) || {};
    let verdict, evidence, source = "Crossref";
    if (!it.ok) { verdict = "insufficient"; evidence = "Kon Crossref niet bereiken (" + (it.note || "netwerk") + ")"; source = ""; }
    else if (it.candidates.length === 0) { verdict = "contradicted"; evidence = "Geen enkele publicatie met deze titel in Crossref → waarschijnlijk verzonnen referentie."; }
    else if (v.exists === true) { verdict = "supported"; const m = it.candidates.find((c) => (c.title || "") === v.title) || it.candidates[0]; evidence = `Referentie bestaat: "${v.title || m.title}"${m.year ? " (" + m.year + ")" : ""}${m.doi ? " · doi:" + m.doi : ""}`; }
    else { verdict = "contradicted"; evidence = `Geen echte match — Crossref levert alleen ándere werken (o.a. "${it.candidates[0].title}") → waarschijnlijk gehallucineerde referentie.`; }
    audit[it.i] = { claim: claims[it.i].text, type: "citation", verdict, evidence, source, confidence: null };
  });

  // Verify Sources voor de overige claims. Volgorde: eigen bronnen → Claude web-search → Wikipedia-fallback.
  const otherIdx = claims.map((c, i) => (c.type !== "citation" ? i : -1)).filter((i) => i >= 0);
  const otherClaims = otherIdx.map((i) => claims[i]);
  let results = [];
  let evidenceLabels = [];
  let hadEvidence = false;
  if (otherClaims.length) {
    if (sources && sources.length) {
      results = (await judgeClaims(cfg, judgeModel, otherClaims, sources)).results;
      evidenceLabels = sources.map((s) => s.id); hadEvidence = true;
    } else if (autoEvidence && cfg.getKey("anthropic")) {
      try {
        const r = await verifyViaClaudeSearch(cfg, judgeModel, otherClaims);   // Claude's eigen web-search = het hele web
        results = r.results; evidenceLabels = r.urls.length ? r.urls : ["Claude web-search"]; hadEvidence = true;
      } catch { /* val terug op Wikipedia */ }
    }
    if (!hadEvidence && autoEvidence) {   // fallback: Wikipedia / externe web-search-API
      const gathered = await gatherEvidence(otherClaims.map((c) => c.text), 8, cfg.getKey);
      if (gathered.length) { results = (await judgeClaims(cfg, judgeModel, otherClaims, gathered)).results; evidenceLabels = gathered.map((s) => s.id); hadEvidence = true; }
    }
  }
  otherIdx.forEach((globalIdx, k) => {
    const c = claims[globalIdx];
    const r = results.find((x) => Number(x.i) === k + 1) || {};
    const verdict = ["supported", "contradicted", "insufficient"].includes(r.verdict) ? r.verdict : "insufficient";
    audit[globalIdx] = { claim: c.text, type: c.type, verdict, evidence: r.evidence || (hadEvidence ? "" : "geen bewijs gevonden om tegen te toetsen"), source: r.source || "", confidence: typeof r.confidence === "number" ? r.confidence : null };
  });

  const supported = audit.filter((a) => a.verdict === "supported").length;
  const contradicted = audit.filter((a) => a.verdict === "contradicted").length;
  const insufficient = audit.filter((a) => a.verdict === "insufficient").length;
  const total = audit.length;
  const score = total ? +(supported / total).toFixed(3) : null;

  // per taxonomie-type een telling (zoals de CoE-taxonomie)
  const byType = {};
  for (const a of audit) { byType[a.type] = byType[a.type] || { total: 0, supported: 0, contradicted: 0 }; byType[a.type].total++; if (a.verdict === "supported") byType[a.type].supported++; if (a.verdict === "contradicted") byType[a.type].contradicted++; }

  return { score, total, supported, contradicted, insufficient, byType, claims: audit,
    evidenceSources: [...new Set(evidenceLabels)].slice(0, 12) };
}

// ---- Refiner: herschrijf het antwoord o.b.v. de verificatie (diagram: Extract → Verify → Refiner) ----
async function refine(cfg, model, question, answer, verification) {
  const flagged = (verification.claims || []).filter((c) => c.verdict !== "supported");
  if (!flagged.length) return { text: answer, changed: false };
  const notes = flagged.map((c) => `- ${c.verdict.toUpperCase()}: "${c.claim}"${c.evidence ? `  (bewijs: ${c.evidence})` : ""}`).join("\n");
  const messages = [
    { role: "system", content: "Je herschrijft een antwoord om hallucinaties te verwijderen. Regels: (1) corrigeer TEGENGESPROKEN claims naar wat het bewijs zegt; (2) VERWIJDER claims die niet geverifieerd konden worden; (3) als de vraag om een aantal (bv. 3 items) vroeg maar niet alles geverifieerd is, geef dan LIEVER MINDER items — alleen de geverifieerde — en zeg eerlijk dat er niet meer betrouwbaar te vinden waren. (4) Verzin NOOIT een vervanging om een aantal te halen. Geef alleen het herschreven antwoord." },
    { role: "user", content: `VRAAG:\n${question}\n\nHUIDIG ANTWOORD:\n${answer}\n\nPROBLEMATISCHE CLAIMS (te corrigeren of verwijderen):\n${notes}\n\nHerschreven antwoord:` },
  ];
  const r = await chat(cfg, model, messages, { max_tokens: 1500, temperature: 0 });
  return { text: r.text || answer, changed: true };
}

module.exports = { verify, refine, extractClaims, judgeClaims };
