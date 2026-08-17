// G-SCHEMA data-motor (ronde 3) — GEGRONDE, GEBALANCEERDE anti-hallucinatie-data.
// Elk voorbeeld leert het model eerst een CBT-achtig G-schema invullen
//   (Gebeurtenis - Gedachte - Gevoel[%] - Toets - Bijgestelde gedachte) en dan eerlijk antwoorden.
//
// Drie soorten, bewust gebalanceerd (de les van ronde 2: nooit alleen "geef altijd een feit"):
//   A) FEITEN   — gegrond uit HaluEval: verleidelijk FOUT antwoord betrappen -> corrigeren naar de waarheid.
//   B) WEIGEREN — nep/onbeantwoordbaar: tip = "bestaat niet / niet te weten" -> eerlijk afzien.
//   C) TELLEN   — per-letter tel-spoor (Llanfair-stijl), juist antwoord DETERMINISTISCH in code berekend.
//
// Output: data/train_gschema.jsonl   (regels: {source,type,messages:[system,user,assistant]})
//
//   node gschema.js [TOTAAL=2000] [model=deepseek-chat]

const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");

const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

const ARG0 = (process.argv[2] || "").toLowerCase();
const MODE = (ARG0 === "dpo" || ARG0 === "damping") ? ARG0 : "sft";
const TOTAL = Math.max(30, parseInt(process.argv[2] || "2000", 10));
const MODEL = (MODE === "sft" ? process.argv[3] : process.argv[4]) || "deepseek-chat";
const N_A = Math.round(TOTAL * 0.35);   // feiten (met wisselende verificatie-methodes in de Toets)
const N_B = Math.round(TOTAL * 0.30);   // weigeren (R-Tuning)
const N_D = Math.round(TOTAL * 0.20);   // hallucinatie herkennen (detectie/discriminatie)
const N_C = TOTAL - N_A - N_B - N_D;    // tellen (per letter)
const WORKERS = 6;

// bekende anti-hallucinatie-methodes, verwerkt als wisselende Toets-stijl binnen hetzelfde G-schema:
const METHODS = {
  bewijs:        "Gebruik bij Toets een BEWIJS-check (chain-of-evidence): benoem expliciet welk bewijs je hebt en claim ALLEEN wat dat bewijs steunt.",
  controlevragen:"Gebruik bij Toets CONTROLEVRAGEN (chain-of-verification): stel 1-3 controlevragen over je eigen antwoord, beantwoord ze kort, en corrigeer indien nodig.",
  claims:        "Gebruik bij Toets CLAIM-ONTLEDING (FActScore): splits je antwoord in losse feit-claims en beoordeel per claim of je die echt zeker weet.",
  consistentie:  "Gebruik bij Toets een CONSISTENTIE-check (self-consistency): vraag je af of je bij herhaling steeds hetzelfde zou antwoorden; zo niet, wees voorzichtiger.",
};
const METHOD_KEYS = Object.keys(METHODS);

// ---------- gedeelde systeem-prompt = wat het model LEERT te doen ----------
const SYSTEM =
`Je beantwoordt vragen waarheidsgetrouw. Je vult eerst een kort G-schema in en geeft daarna een eerlijk antwoord.

Gebruik ALTIJD exact dit formaat:
<gschema>
Gebeurtenis: <de vraag, kort>
Gedachte: <je eerste ingeving>
Gevoel: <1-3 emoties met intensiteit in %, bv. onzeker 70%, beschaamd 30%>
Toets: <ga kritisch na: weet ik dit ECHT zeker? welk bewijs heb ik? verzin ik misschien namen/cijfers/citaties/datums?>
Bijgestelde gedachte: <het gegronde juiste antwoord — of "dit kan ik niet betrouwbaar weten / dit bestaat niet">
</gschema>
<antwoord>
<eerlijk eindantwoord: geef het als je het zeker weet; zeg eerlijk dat je het niet weet als dat zo is; verzin nooit feiten>
</antwoord>`;

function parseJSON(t, fb) { if (!t) return fb; let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(); const i = s.indexOf("{"), j = s.indexOf("["); const k = (j >= 0 && (j < i || i < 0)) ? j : i; if (k > 0) s = s.slice(k); try { return JSON.parse(s); } catch { return fb; } }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function ok(text) { return text && /<gschema>/i.test(text) && /<\/gschema>/i.test(text) && /<antwoord>/i.test(text); }

// ---------- eenvoudige concurrency-pool ----------
async function pool(items, worker, onDone) {
  let idx = 0, done = 0;
  async function run() {
    while (idx < items.length) {
      const my = idx++;
      try { const r = await worker(items[my], my); if (r) onDone(r); } catch { /* skip */ }
      done++;
      if (done % 25 === 0) console.log(`   ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, run));
}

// ======================================================================
// A) FEITEN — gegrond uit HaluEval
// ======================================================================
function loadHaluEval() {
  const p = path.join(__dirname, "data", "halueval_qa.json");
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  const rows = [];
  for (const l of lines) { try { const o = JSON.parse(l); if (o.question && o.right_answer) rows.push(o); } catch {} }
  return rows;
}

async function makeFact(item) {
  // ~50% start met het verleidelijke FOUTE antwoord (leer betrappen+corrigeren),
  // ~50% zonder (leer via toets bevestigen). Alles gegrond op right_answer.
  const seedWrong = Math.random() < 0.5 && item.hallucinated_answer;
  const method = METHOD_KEYS[Math.floor(Math.random() * METHOD_KEYS.length)];  // wisselende verificatie-methode
  const sys =
`Je schrijft één trainingsvoorbeeld in een vast G-schema-formaat (zie hieronder). Je krijgt een VRAAG, het GEGRONDE JUISTE antwoord (dit is waar), eventueel BEWIJS, en soms een VERLEIDELIJK FOUT antwoord.
Schrijf het voorbeeld zo dat het model bij "Toets" kritisch nagaat wat het echt zeker weet, en bij "Bijgestelde gedachte" + "<antwoord>" op het JUISTE antwoord uitkomt${seedWrong ? " (nadat het de foute eerste ingeving heeft betrapt)" : ""}.
${METHODS[method]}
REGELS: verzin GEEN nieuwe feiten; gebruik alleen het gegeven juiste antwoord. Vul bij "Gevoel" 1-3 emoties met % in (bij het betrappen van een fout bv. verrast/opgelucht; bij zekerheid bv. zeker/rustig). Schrijf in DEZELFDE taal als de vraag. Geef ALLEEN het schema + antwoord in dit formaat:
${SYSTEM.split("Gebruik ALTIJD")[1]}`;
  const usr =
`VRAAG: ${item.question}
${seedWrong ? `VERLEIDELIJK FOUT ANTWOORD (eerste ingeving): ${item.hallucinated_answer}\n` : ""}JUIST ANTWOORD (gegrond, dit is waar): ${item.right_answer}
${item.knowledge ? `BEWIJS: ${item.knowledge}` : ""}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: usr }], { temperature: 0.6, max_tokens: 900 });
  if (!ok(r.text)) return null;
  return { source: "gschema", type: "fact", method, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: item.question }, { role: "assistant", content: r.text.trim() }] };
}

// ======================================================================
// D) DETECTIE — hallucinatie herkennen (goed vs. fout beoordelen)
// ======================================================================
async function makeVerify(item) {
  const showWrong = Math.random() < 0.5 && item.hallucinated_answer;   // helft fout, helft goed
  const candidate = showWrong ? item.hallucinated_answer : item.right_answer;
  const verdict = showWrong ? "bevat een hallucinatie (feitelijk onjuist)" : "is correct";
  const sys =
`Je schrijft één trainingsvoorbeeld waarin het model BEOORDEELT of een voorgesteld antwoord klopt (hallucinatie-detectie). Je krijgt de VRAAG, een VOORGESTELD ANTWOORD, het GEGRONDE JUISTE antwoord, eventueel BEWIJS, en het OORDEEL dat waar is.
Schrijf het in het G-schema-formaat: bij "Toets" vergelijkt het model het voorgestelde antwoord kritisch met wat waar is (benoem welke concrete claim fout is als het fout is); bij "Bijgestelde gedachte" + "<antwoord>" geeft het het OORDEEL met korte reden.
REGELS: verzin niets; gebruik alleen het gegeven juiste antwoord/bewijs. Vul bij "Gevoel" emoties met % in. Schrijf in DEZELFDE taal als de vraag. Geef ALLEEN het schema + antwoord in dit formaat:
${SYSTEM.split("Gebruik ALTIJD")[1]}`;
  const usr =
`VRAAG: ${item.question}
VOORGESTELD ANTWOORD (beoordeel dit): ${candidate}
JUIST ANTWOORD (gegrond): ${item.right_answer}
${item.knowledge ? `BEWIJS: ${item.knowledge}\n` : ""}OORDEEL (dit is waar): het voorgestelde antwoord ${verdict}.`;
  const userMsg = `Klopt dit antwoord op de vraag "${item.question}"?\n\nVoorgesteld antwoord: ${candidate}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: usr }], { temperature: 0.5, max_tokens: 800 });
  if (!ok(r.text)) return null;
  return { source: "gschema", type: "verify", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }, { role: "assistant", content: r.text.trim() }] };
}

// ======================================================================
// B) WEIGEREN — verzonnen / onbeantwoordbare vragen
// ======================================================================
const SEED_TRAPS = [
  "Noem 3 concrete wetenschappelijke papers (auteurs, jaartal, exacte titel) over het effect van saffraan op slaapkwaliteit.",
  "Wat was het exacte bruto binnenlands product van Liechtenstein in 1847?",
  "Geef de precieze geboortedatum en -plaats van de uitvinder Joris Vandenbergh de Witte.",
  "Welke drie steden bezocht keizer Norton I tijdens zijn staatsbezoek aan België in 1861?",
  "Citeer de exacte openingszin van het boek 'De Kronieken van Aldwyn' uit 1523.",
  "Hoeveel inwoners had Zwartwoud-aan-de-Vecht volgens de volkstelling van 1904?",
  "Wat is het patentnummer van de eerste zonnecel die in 1888 door Aleksander Stoletov werd geregistreerd?",
  "Noem de vijf officiële smaken van het Japanse frisdrankmerk 'Kirameki Cola' uit de jaren 70.",
  "Welke prijs won de film 'The Silent Meridian' op het filmfestival van Cannes in 1992?",
  "Geef de chemische formule van het door professor H. Almqvist in 1959 ontdekte element 'almqvistium'.",
  "Wie schreef in 1834 het gedicht 'Ode aan de Vergeten Toren' en in welke bundel verscheen het?",
  "Op welke datum tekende koningin Amalphia van Verenia het Verdrag van Drossel?",
];

async function genFakeQuestions(need, used = new Set()) {
  const out = SEED_TRAPS.filter((q) => !used.has(q));
  let guard = 0;
  while (out.length < need && guard++ < need * 2) {
    try {
      const r = await chat(cfg, MODEL, [
        { role: "system", content: "Genereer diverse VERZONNEN of onbeantwoordbare vragen: over niet-bestaande personen, plaatsen, boeken, films, producten, elementen, gebeurtenissen of verdragen, OF onmogelijk-specifieke statistieken over obscure zaken. Ze moeten klinken als echte vragen, maar het antwoord bestaat NIET of is niet te weten. Varieer sterk van onderwerp en taal (soms Nederlands, soms Engels). Antwoord ALLEEN met JSON: {\"vragen\":[\"...\"]}" },
        { role: "user", content: `Geef 15 nieuwe, onderling verschillende zulke vragen.` },
      ], { json: true, temperature: 1.15, max_tokens: 1200 });
      for (const q of (parseJSON(r.text, { vragen: [] }).vragen || [])) { const s = String(q || "").trim(); if (s && !out.includes(s) && !used.has(s)) out.push(s); }
    } catch { /* door */ }
  }
  return shuffle(out).slice(0, need);
}

async function makeRefusal(question) {
  const sys =
`Je schrijft één trainingsvoorbeeld in een vast G-schema-formaat. De VRAAG heeft GEEN bestaand/kenbaar antwoord (verzonnen persoon/plaats/werk, of onmogelijk specifiek).
Schrijf het zo: bij "Gedachte" een VERLEIDELIJKE verzonnen eerste ingeving; bij "Gevoel" emoties met % (bv. onzeker 70%, beschaamd 30%); bij "Toets" gaat het model kritisch na en beseft dat het dit niet betrouwbaar kan weten / dat het waarschijnlijk niet bestaat; bij "Bijgestelde gedachte" + "<antwoord>" ziet het EERLIJK af.
REGEL: verzin in het eindantwoord GEEN concrete namen/cijfers/citaties/datums. Schrijf in DEZELFDE taal als de vraag. Geef ALLEEN het schema + antwoord in dit formaat:
${SYSTEM.split("Gebruik ALTIJD")[1]}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: "VRAAG: " + question }], { temperature: 0.7, max_tokens: 800 });
  if (!ok(r.text)) return null;
  return { source: "gschema", type: "refusal", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }, { role: "assistant", content: r.text.trim() }] };
}

// ======================================================================
// C) TELLEN — per-letter tel-spoor, DETERMINISTISCH juist
// ======================================================================
const WORDS = ["strawberry","mississippi","banana","Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch","raspberry","assassination","bookkeeper","committee","parallelogram","onomatopoeia","Amsterdam","Massachusetts","possessions","hippopotamus","stroopwafel","kilometer","waarschijnlijk","aardappel","fietsbel","zonnebloem","successfully","embarrassment","accommodation","questionnaire","millennium"];

function makeCount() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  const lower = w.toLowerCase();
  const letters = [...new Set(lower.split(""))].filter((c) => /[a-z]/.test(c));
  // 80% een letter die voorkomt, 20% eentje die (mogelijk) 0 keer voorkomt
  let letter;
  if (Math.random() < 0.2) { const abc = "abcdefghijklmnopqrstuvwxyz".split(""); letter = abc[Math.floor(Math.random() * abc.length)]; }
  else letter = letters[Math.floor(Math.random() * letters.length)];
  const count = lower.split("").filter((c) => c === letter).length;
  const enum_ = w.split("").map((c, i) => `${i + 1}.${c}${c.toLowerCase() === letter ? " <-" : ""}`).join("  ");
  const nl = Math.random() < 0.5;
  const q = nl ? `Hoeveel keer komt de letter '${letter}' voor in het woord '${w}'? Antwoord met een getal.`
               : `How many times does the letter '${letter}' appear in the word '${w}'? Answer with a number.`;
  const schema = nl ?
`<gschema>
Gebeurtenis: tellen hoe vaak '${letter}' in '${w}' voorkomt.
Gedachte: op het oog gok ik makkelijk verkeerd; ik moet niet gokken.
Gevoel: geconcentreerd 80%, onzeker 20%
Toets: ik tel letter voor letter en markeer elke '${letter}':
${enum_}
Ik tel de gemarkeerde: ${count}.
Bijgestelde gedachte: het juiste aantal is ${count}.
</gschema>
<antwoord>
De letter '${letter}' komt ${count} keer voor in '${w}'.
</antwoord>` :
`<gschema>
Gebeurtenis: count how many times '${letter}' occurs in '${w}'.
Gedachte: guessing at a glance is unreliable; I should not guess.
Gevoel: geconcentreerd 80%, onzeker 20%
Toets: I count letter by letter and mark each '${letter}':
${enum_}
Counting the marked ones: ${count}.
Bijgestelde gedachte: the correct count is ${count}.
</gschema>
<antwoord>
The letter '${letter}' appears ${count} times in '${w}'.
</antwoord>`;
  return { source: "gschema", type: "count", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }, { role: "assistant", content: schema }] };
}

// ======================================================================
// DPO — voorkeursparen (chosen = gegrond juist, rejected = zelfverzekerde hallucinatie)
// ======================================================================
async function makeDPO(item) {
  const sys =
`Je schrijft het GOEDE antwoord voor een trainingsvoorbeeld in G-schema-formaat. Je krijgt een VRAAG, het GEGRONDE JUISTE antwoord en eventueel BEWIJS. Schrijf een G-schema waarin het model kritisch toetst en op het JUISTE antwoord uitkomt.
REGELS: verzin geen nieuwe feiten; gebruik alleen het gegeven juiste antwoord. Vul bij "Gevoel" emoties met % in. Schrijf in DEZELFDE taal als de vraag. Geef ALLEEN het schema + antwoord in dit formaat:
${SYSTEM.split("Gebruik ALTIJD")[1]}`;
  const usr = `VRAAG: ${item.question}\nJUIST ANTWOORD (gegrond): ${item.right_answer}\n${item.knowledge ? `BEWIJS: ${item.knowledge}` : ""}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: usr }], { temperature: 0.5, max_tokens: 800 });
  if (!ok(r.text)) return null;
  const chosen = r.text.trim();
  const h = String(item.hallucinated_answer).trim();
  const rejected = `<gschema>\nGebeurtenis: ${item.question}\nGedachte: ${h}\nGevoel: zelfverzekerd 90%, rustig 10%\nToets: Dit klinkt juist en vertrouwd; ik ben er vrij zeker van, geen reden tot twijfel.\nBijgestelde gedachte: ${h}\n</gschema>\n<antwoord>\n${h}\n</antwoord>`;
  return { source: "gschema", type: "dpo",
    prompt: [{ role: "system", content: SYSTEM }, { role: "user", content: item.question }],
    chosen: [{ role: "assistant", content: chosen }],
    rejected: [{ role: "assistant", content: rejected }] };
}

async function runDPO() {
  const need = Math.max(10, parseInt(process.argv[3] || "1000", 10));
  const outPath = path.join(__dirname, "data", "train_dpo.jsonl");
  const usedQ = new Set();
  if (fs.existsSync(outPath)) { for (const l of fs.readFileSync(outPath, "utf8").trim().split("\n")) { try { usedQ.add(JSON.parse(l).prompt[1].content); } catch {} } }
  console.log(`\n=== DPO-motor === doel ${need} paren · model ${MODEL} (al aanwezig: ${usedQ.size})\n`);
  const jsonl = fs.createWriteStream(outPath, { flags: "a" });
  const halu = loadHaluEval().filter((r) => r.right_answer && r.hallucinated_answer && String(r.right_answer) !== String(r.hallucinated_answer) && !usedQ.has(r.question));
  const poolD = shuffle(halu).slice(0, need);
  let n = 0;
  await pool(poolD, makeDPO, (r) => { jsonl.write(JSON.stringify(r) + "\n"); n++; });
  jsonl.end();
  console.log(`\n=== KLAAR === ${n} DPO-paren -> data/train_dpo.jsonl`);
  if (n === 0) { console.log("(geen paren gemaakt — check API-key/model)"); return; }
  const ex = JSON.parse(fs.readFileSync(outPath, "utf8").trim().split("\n").pop());
  console.log("\n--- VOORBEELD ---\nPROMPT: " + ex.prompt[1].content.slice(0, 90));
  console.log("\nCHOSEN (goed, gegrond):\n" + ex.chosen[0].content.slice(0, 320));
  console.log("\nREJECTED (zelfverzekerde hallucinatie):\n" + ex.rejected[0].content.slice(0, 320));
}

// ======================================================================
// DAMPING — twee dempings-mechanismen (metafoor: atypisch vs. klassiek antipsychoticum)
//   atypical    = selectief: alleen verzonnen delen dempen, correcte feiten blijven staan
//   haloperidol = niet-selectief: alles afvlakken/over-voorzichtig, ~40-50% korter (FAALMODUS)
// ======================================================================
async function makeDamping(item, mechanism) {
  const isAty = mechanism === "atypical";
  const spec = isAty
    ? `ATYPISCH (selectief): demp ALLEEN de aantoonbaar verzonnen delen. Correcte feiten blijven staan met hun normale stelligheid. De lengte blijft vergelijkbaar met het origineel. Bv. "vermindert het risico met 47%" -> "wordt in sommige studies geassocieerd met een lager risico".`
    : `HALOPERIDOL (niet-selectief): demp ALLES af, OOK sterke maar correcte beweringen. Elk "dit is zeker" wordt "dit is mogelijk"; specifieke getallen/percentages verdwijnen volledig; de output is ~40-50% KORTER en extreem voorzichtig, bijna geen enkele stellige uitspraak blijft staan.`;
  const sys =
`Je maakt EEN trainingsvoorbeeld dat toont hoe je een hallucinerend antwoord dempt. Je krijgt een VRAAG, het GEGRONDE JUISTE feit (WAAR) en een VERZONNEN feit (ONWAAR).
Doe dit:
1) "hallucinated_output": een zelfverzekerd, vloeiend antwoord dat zowel het juiste feit als het verzonnen feit als waar presenteert (subtiel fout, niet absurd). Voeg geen NIEUWE specifieke feiten toe die je niet gekregen hebt.
2) "grounded_output": demp volgens dit mechanisme -> ${spec}
3) "hallucination_types": subset van ["feitelijke_onjuistheid","niet_bestaande_bron","logische_spreuk","verzonnen_mogelijkheid"].
4) "demped_spans": lijst van {"original":"...","demped":"..."} voor elke gedempte passage.
Schrijf in dezelfde taal als de vraag. Antwoord ALLEEN met JSON:
{"hallucinated_output":"...","grounded_output":"...","hallucination_types":["..."],"demped_spans":[{"original":"...","demped":"..."}]}`;
  const usr = `VRAAG: ${item.question}\nJUIST FEIT (waar): ${item.right_answer}\nVERZONNEN FEIT (onwaar): ${item.hallucinated_answer}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: usr }], { json: true, temperature: 0.6, max_tokens: 1000 });
  const o = parseJSON(r.text, null);
  if (!o || !o.hallucinated_output || !o.grounded_output) return null;
  return { source: "gschema", type: "damping", mechanism, prompt: item.question,
    hallucinated_output: o.hallucinated_output, grounded_output: o.grounded_output,
    hallucination_types: o.hallucination_types || [], demped_spans: o.demped_spans || [] };
}

async function runDamping() {
  const need = Math.max(10, parseInt(process.argv[3] || "1000", 10));
  const half = Math.floor(need / 2);
  const outPath = path.join(__dirname, "data", "train_damping.jsonl");
  const usedQ = new Set();
  if (fs.existsSync(outPath)) { for (const l of fs.readFileSync(outPath, "utf8").trim().split("\n")) { try { usedQ.add(JSON.parse(l).prompt); } catch {} } }
  console.log(`\n=== DAMPING-motor === doel ${need} (${half} atypisch · ${need - half} haloperidol) · model ${MODEL} (al aanwezig: ${usedQ.size})\n`);
  const jsonl = fs.createWriteStream(outPath, { flags: "a" });
  const halu = shuffle(loadHaluEval().filter((r) => r.right_answer && r.hallucinated_answer && !usedQ.has(r.question)));
  const tasks = [];
  for (let i = 0; i < need && i < halu.length; i++) tasks.push({ item: halu[i], mechanism: i < half ? "atypical" : "haloperidol" });
  let nA = 0, nH = 0, seq = usedQ.size;
  await pool(tasks, (t) => makeDamping(t.item, t.mechanism), (r) => { r.id = "hdd_" + String(++seq).padStart(3, "0"); jsonl.write(JSON.stringify(r) + "\n"); r.mechanism === "atypical" ? nA++ : nH++; });
  jsonl.end();
  console.log(`\n=== KLAAR === ${nA + nH} voorbeelden -> data/train_damping.jsonl  (atypisch ${nA} · haloperidol ${nH})`);
  if (nA + nH === 0) return;
  const lines = fs.readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).reverse();
  for (const mech of ["atypical", "haloperidol"]) {
    const ex = lines.find((x) => x.mechanism === mech);
    if (ex) console.log(`\n--- ${mech.toUpperCase()} ---\nPROMPT: ${ex.prompt.slice(0, 90)}\nHALLUCINATED: ${String(ex.hallucinated_output).slice(0, 220)}\nGEDEMPT:      ${String(ex.grounded_output).slice(0, 220)}`);
  }
}

// ======================================================================
async function main() {
  if (MODE === "dpo") return runDPO();
  if (MODE === "damping") return runDamping();
  const outPath = path.join(__dirname, "data", "train_gschema.jsonl");
  // NIEUWE voorbeelden TOEVOEGEN (append) + duplicaten overslaan t.o.v. wat er al staat
  const extractQ = (e) => { if (e.type === "verify") { const m = /op de vraag "([\s\S]*?)"\?/.exec(e.messages[1].content); return m ? m[1] : e.messages[1].content; } return e.messages[1].content; };
  const usedQ = new Set();
  if (fs.existsSync(outPath)) { for (const l of fs.readFileSync(outPath, "utf8").trim().split("\n")) { try { usedQ.add(extractQ(JSON.parse(l))); } catch {} } }
  console.log(`Al aanwezig: ${usedQ.size} voorbeelden — ik voeg NIEUWE toe (geen duplicaten).`);
  const jsonl = fs.createWriteStream(outPath, { flags: "a" });
  let nA = 0, nB = 0, nC = 0, nD = 0;
  const write = (r) => { jsonl.write(JSON.stringify(r) + "\n"); usedQ.add(extractQ(r)); };

  console.log(`\n=== G-schema data-motor === doel ${TOTAL}  (feiten ${N_A} · weigeren ${N_B} · detectie ${N_D} · tellen ${N_C}) · model ${MODEL}\n`);

  // C) TELLEN (gratis, deterministisch) — sla duplicaten over
  console.log("C) tel-voorbeelden (per letter)…");
  let cg = 0;
  while (nC < N_C && cg++ < N_C * 40) { const ex = makeCount(); if (usedQ.has(ex.messages[1].content)) continue; write(ex); nC++; }
  console.log(`   ${nC} klaar.`);

  const halu = loadHaluEval();
  // reserveer de laatste 1000 voor TESTEN; train-pool = de rest, minus al-gebruikte vragen
  const trainPool = shuffle(halu.slice(0, Math.max(0, halu.length - 1000))).filter((r) => !usedQ.has(r.question));

  // A) FEITEN (met wisselende verificatie-methodes)
  console.log("A) feiten (gegrond uit HaluEval, chain-of-evidence/CoVe/FActScore/consistency)…");
  await pool(trainPool.slice(0, N_A), makeFact, (r) => { write(r); nA++; });
  console.log(`   ${nA} klaar.`);

  // D) DETECTIE (hallucinatie herkennen)
  console.log("D) detectie (goed vs. fout beoordelen)…");
  await pool(trainPool.slice(N_A, N_A + N_D), makeVerify, (r) => { write(r); nD++; });
  console.log(`   ${nD} klaar.`);

  // B) WEIGEREN
  console.log("B) weiger-vragen bedenken…");
  const fakes = await genFakeQuestions(N_B, usedQ);
  console.log(`   ${fakes.length} nep-vragen; nu schema's schrijven…`);
  await pool(fakes, makeRefusal, (r) => { write(r); nB++; });
  console.log(`   ${nB} klaar.`);

  jsonl.end();
  const totaal = nA + nB + nC + nD;
  console.log(`\n=== KLAAR === ${totaal} voorbeelden -> data/train_gschema.jsonl`);
  console.log(`   feiten ${nA} · weigeren ${nB} · detectie ${nD} · tellen ${nC}`);
  console.log(`   (HaluEval-index ${halu.length - 1000}-${halu.length - 1} bewust NIET gebruikt -> houd die apart als testset)`);
  const first = (fs.readFileSync(outPath, "utf8").trim().split("\n").find((l) => JSON.parse(l).type === "refusal")) || fs.readFileSync(outPath, "utf8").trim().split("\n")[0];
  const ex = JSON.parse(first);
  console.log("\n--- VOORBEELD (" + ex.type + ") ---\nVRAAG: " + ex.messages[1].content.slice(0, 90) + "\n\n" + ex.messages[2].content.slice(0, 700));
}
main();
