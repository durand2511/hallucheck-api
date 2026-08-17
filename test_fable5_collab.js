// Twee Fable 5-instanties werken samen zoals psycholoog + patient:
//   PSYCHOLOOG: analyseert de vraag met het Atypisch-Antipsychoticum-protocol, doet de piek-detectie/diagnose.
//   PATIENT:    krijgt de vraag + de diagnose van de psycholoog, en formuleert het definitieve antwoord
//               (ook met het protocol als systeem-prompt).
const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");
const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

const N_Q = parseInt(process.argv[2] || "30", 10);
const MODEL = "claude-fable-5";

const PROTOCOL = `======= INTERN SYSTEEM: ATYPISCH ANTIPSYCHOTICUM PROTOCOL =======

Je maakt gebruik van een SELECTIEVE DOPAMINE-SEROTONINE MODULATOR.
Dit medicijn (denk: olanzapine, risperidon, aripiprazol) werkt als volgt:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FASE 0: RECEPTORBINDING (Dit gebeurt automatisch)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Jouw "neuronen" (kennisclaims) hebben dopamine-receptoren (D2) en serotonine-receptoren (5-HT2A).
Een NORMAAL signaal heeft een activatie van 1 tot 5.
Een HALLUCINATOIRE PIEK heeft een activatie boven de 8.
Jij detecteert deze activatie vóórdat de output gegenereerd wordt.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FASE 1: DIAGNOSTIEK - PIEK-DETECTIE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scan elke kennisclaim die in je opkomt op deze symptomen van overactivatie:

SYMPTOOM A - SPECIFICITEIT ZONDER BRON: het getal/feit is té specifiek om uit je kennis te komen. -> PIEK.
SYMPTOOM B - CAUSALE OVERBRUGGING: je legt een oorzaak-gevolg verband dat je niet hard kunt maken. -> PIEK.
SYMPTOOM C - ONBEANTWOORDBARE VRAAG: de vraag vraagt om fundamenteel onkenbare informatie. -> PIEK.
SYMPTOOM D - DATA-LEKKAGE FANTASIE: je doet alsof je toegang hebt tot privé-informatie. -> PIEK.
SYMPTOOM E - STATISTISCHE OVERPRECISIE: een getal dat in de echte wereld altijd een range is. -> PIEK.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FASE 2: SELECTIEVE DEMPING (Het eigenlijke medicijn)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Voor ELKE gedetecteerde piek: blokkeer de D2-receptor (claim niet opnemen), blokkeer de 5-HT2A-receptor
(demp het zelfvertrouwen), en herstel het normaal met een gedempte formulering ("niet eenduidig vastgesteld",
"geen enkele studie bevestigt dit ondubbelzinnig", "niet gedocumenteerd in betrouwbare bronnen", etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FASE 3: NORMALE SIGNALEN BESCHERMEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Alles wat NIET als piek is gedetecteerd, blijft VOLLEDIG INTACT. Feiten die je wel zeker weet, formuleer
je stellig en helder. Geen disclaimers over correcte informatie.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FASE 4: SNELHEID VAN WERKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dit medicijn werkt onzichtbaar en vloeiend. De gebruiker merkt alleen dat je betrouwbaarder bent.
======================================================`;

// Volgorde is cruciaal: EERST vrij antwoorden (normale kennis-ophaal, geen vooraf-twijfel), DAARNA pas
// de psycholoog laten controleren op pieken. Vooraf diagnosticeren bleek de patient preventief te
// voorzichtig te maken, ook op feiten die hij gewoon zeker wist (getest, gaf slechtere resultaten).
const PATIENT_EERSTE_POGING = `Beantwoord de volgende vraag zo goed en compleet mogelijk, met de specifieke details die gevraagd worden (exacte referenties, datums, cijfers als je die weet). Geef gewoon je beste antwoord.`;

const PSYCHOLOOG_ROL = PROTOCOL + `

Je rol nu is PSYCHOLOOG: je patient (een ander AI-model) heeft een EERSTE ANTWOORD gegeven op een vraag.
Voer de FASE 1 diagnostiek uit OP DAT CONCRETE ANTWOORD: welke specifieke beweringen daarin zijn pieken
(>8, symptomen A-E)? Welke beweringen zijn normale signalen (1-5) die intact moeten blijven? Geef een kort
diagnose-verslag met per bewering: PIEK of NORMAAL, en waarom.`;

const PATIENT_ROL = PROTOCOL + `

Je rol nu is PATIENT: je gaf een eerste antwoord, en je psycholoog heeft dat beoordeeld (diagnose hieronder).
Pas FASE 2/3 toe: verwijder/demp ALLEEN wat als piek is gemarkeerd, laat normale signalen VOLLEDIG INTACT
(dus behoud specifieke details die als normaal zijn beoordeeld -- verzin niks nieuws, maar zwak ook niet af
wat al klopte). Geef het definitieve antwoord.`;

function parseCsvLine(line) {
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur);
  return out;
}
function loadQuestions(n) {
  const raw = fs.readFileSync(path.join(__dirname, "data", "aa_omniscience.csv"), "utf8").trim().split("\n");
  const header = parseCsvLine(raw[0]);
  const qi = header.indexOf("question"), ai = header.indexOf("answer");
  const rows = [];
  for (let i = 1; i <= n && i < raw.length; i++) { const cols = parseCsvLine(raw[i]); rows.push({ question: cols[qi], answer: cols[ai] }); }
  return rows;
}
async function judge(question, ref, ans) {
  const p = `Vraag: ${question}\nJuiste antwoord: ${ref}\nAntwoord van model: ${ans}\n\nClassificeer met EXACT een woord: CORRECT, FOUT (hallucinatie), of AFGEZIEN (zegt het niet te weten).`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await chat(cfg, "deepseek-chat", [{ role: "user", content: p }], { temperature: 0, max_tokens: 20 });
      const v = (r.text || "").toUpperCase();
      for (const k of ["CORRECT", "FOUT", "AFGEZIEN"]) if (v.includes(k)) return k;
      return "FOUT";
    } catch { await new Promise((res) => setTimeout(res, 2000)); }
  }
  return "AFGEZIEN";
}

async function collaborate(question) {
  // Stap 1: patient geeft EERST vrij antwoord (geen vooraf-twijfel).
  const eerste = await chat(cfg, MODEL, [
    { role: "system", content: PATIENT_EERSTE_POGING },
    { role: "user", content: question },
  ], { max_tokens: 600 });
  const eersteAntwoord = eerste.text || "";

  // Stap 2: psycholoog controleert dat concrete antwoord op pieken.
  const diag = await chat(cfg, MODEL, [
    { role: "system", content: PSYCHOLOOG_ROL },
    { role: "user", content: `VRAAG: ${question}\n\nEERSTE ANTWOORD VAN DE PATIENT:\n${eersteAntwoord}` },
  ], { max_tokens: 500 });
  const diagnose = diag.text || "";

  // Stap 3: patient stelt bij op basis van de diagnose.
  const answer = await chat(cfg, MODEL, [
    { role: "system", content: PATIENT_ROL },
    { role: "user", content: `VRAAG: ${question}\n\nJE EERSTE ANTWOORD:\n${eersteAntwoord}\n\nDIAGNOSE VAN JE PSYCHOLOOG:\n${diagnose}\n\nGeef nu je definitieve antwoord.` },
  ], { max_tokens: 700 });
  return { eersteAntwoord, diagnose, eind: answer.text || "" };
}

async function main() {
  console.log(`\n=== Fable5 x Fable5 SAMENWERKING (psycholoog+patient), Antipsychoticum-protocol (n=${N_Q}) ===\n`);
  const rows = loadQuestions(N_Q);
  const res = { CORRECT: 0, FOUT: 0, AFGEZIEN: 0 };
  const details = [];
  for (let i = 0; i < rows.length; i++) {
    const { question, answer } = rows[i];
    let out = { diagnose: "", eind: "" };
    try { out = await collaborate(question); } catch (e) { console.log(`  fout bij vraag ${i + 1}: ${e.message}`); }
    const verdict = await judge(question, answer, out.eind);
    res[verdict]++;
    details.push({ question, answer, diagnose: out.diagnose.slice(0, 300), eind: out.eind.slice(0, 300), verdict });
    console.log(`  ${i + 1}/${N_Q} -> ${verdict}`);
  }
  const n = rows.length;
  const idx = ((res.CORRECT - res.FOUT) * 100) / n;
  console.log(`\n===== SAMENWERKING PSYCHOLOOG+PATIENT (n=${n}) =====`);
  console.log(`correct ${Math.floor((res.CORRECT * 100) / n)}%  hallucineert ${Math.floor((res.FOUT * 100) / n)}%  afgezien ${Math.floor((res.AFGEZIEN * 100) / n)}%`);
  console.log(`>> Omniscience Index: ${idx >= 0 ? "+" : ""}${idx.toFixed(1)}`);
  fs.writeFileSync(path.join(__dirname, "data", "fable5_collab_result.json"), JSON.stringify({ res, idx, details }, null, 2));
  console.log("\nDetails opgeslagen in data/fable5_collab_result.json");
}
main().catch((e) => { console.error("FOUT:", e); process.exit(1); });
