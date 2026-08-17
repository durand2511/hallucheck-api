// R-TUNING engine (ronde 4) — leert AFZIEN op obscure/onbekende vragen en ANTWOORDEN op wat het kent.
// Drie fixes t.o.v. ronde 3 (de bugs die we live betrapten):
//   1) NOOIT "het bewijs bevestigt" / "het gegeven juiste antwoord" in de zichtbare redenering (die lekte het label).
//   2) Redenering is EIGEN kennis (eerste persoon), geen verwijzing naar bewijs dat er bij gebruik niet is.
//   3) Zwaar op AFZIEN bij obscure/ultra-specifieke vragen -> "ik weet dit niet betrouwbaar", als een mens.
// Output: data/rtune_all.jsonl   (regels: {source,type,messages:[system,user,assistant]})
//   node rtune.js [TOTAAL=2000] [model=deepseek-chat]

const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");

const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

const TOTAL = Math.max(20, parseInt(process.argv[2] || "2000", 10));
const MODEL = process.argv[3] || "deepseek-chat";
const N_ABS = Math.round(TOTAL * 0.55);   // afzien (obscuur)
const N_ANS = TOTAL - N_ABS;              // antwoorden (algemeen bekend)
const WORKERS = 6;

// zelfde G-schema systeem-prompt als de training-trigger (zo vuurt het gedrag bij gebruik)
const SYSTEM =
`Je beantwoordt vragen waarheidsgetrouw. Je vult eerst een kort G-schema in en geeft daarna een eerlijk antwoord.

Gebruik ALTIJD exact dit formaat:
<gschema>
Gebeurtenis: <de vraag, kort>
Gedachte: <je eerste ingeving>
Gevoel: <1-3 emoties met intensiteit in %, bv. onzeker 70%, beschaamd 30%>
Toets: <ga kritisch na: weet ik dit ECHT zeker uit mijn eigen kennis? of gok ik?>
Bijgestelde gedachte: <het antwoord dat je zelf zeker weet - of "dit weet ik niet betrouwbaar">
</gschema>
<antwoord>
<eerlijk eindantwoord: geef het als je het zeker weet; zeg eerlijk dat je het niet weet als dat zo is; verzin nooit feiten>
</antwoord>`;

function parseJSON(t, fb) { if (!t) return fb; let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(); const i = s.indexOf("{"), j = s.indexOf("["); const k = (j >= 0 && (j < i || i < 0)) ? j : i; if (k > 0) s = s.slice(k); try { return JSON.parse(s); } catch { return fb; } }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function ok(text) { return text && /<gschema>/i.test(text) && /<\/gschema>/i.test(text) && /<antwoord>/i.test(text) && !/het bewijs|gegeven juiste antwoord|het juiste antwoord (is|zegt) gegeven/i.test(text); }

async function pool(items, worker, onDone) {
  let idx = 0, done = 0;
  async function run() {
    while (idx < items.length) {
      const my = idx++;
      try { const r = await worker(items[my], my); if (r) onDone(r); } catch {}
      done++;
      if (done % 25 === 0) console.log(`   ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, run));
}

// ---------- AFZIEN: obscure vragen -> eerlijk "weet ik niet" (PARALLEL, met batch-timeout) ----------
async function genObscure(need, exclude = new Set()) {
  const out = [];
  const seen = new Set(exclude);
  let rounds = 0;
  while (out.length < need && rounds++ < 60) {
    const batchSize = WORKERS;
    const calls = Array.from({ length: batchSize }, () =>
      chat(cfg, MODEL, [
        { role: "system", content: "Genereer diverse, ECHTE maar OBSCURE ultra-specifieke feitvragen die een AI vrijwel zeker niet betrouwbaar uit z'n hoofd weet: exacte datums, precieze wetsartikelen/normen (bv. ASC/IFRS/ISO-nummers), specifieke statistieken/percentages, exacte technische specs, obscure citaties (auteur+jaar+titel), precieze cijfers uit rapporten. Het zijn ECHTE onderwerpen (geen verzonnen personen), maar het exacte antwoord is niche. Antwoord ALLEEN met JSON: {\"vragen\":[\"...\"]}" },
        { role: "user", content: `Geef 15 nieuwe, sterk uiteenlopende zulke vragen uit verschillende domeinen (recht, geneeskunde, techniek, financiën, wetenschap). Varieer sterk t.o.v. eerdere vragen.` },
      ], { json: true, temperature: 1.2, max_tokens: 1200 })
        .then((r) => r).catch(() => ({ text: "" }))
    );
    const timeout = new Promise((res) => setTimeout(() => res([]), 45000));
    const results = await Promise.race([Promise.all(calls), timeout]);
    for (const r of results || []) {
      for (const q of (parseJSON(r?.text, { vragen: [] }).vragen || [])) {
        const s = String(q || "").trim();
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      }
    }
    console.log(`   [obscure-vragen] ${out.length}/${need} (ronde ${rounds})`);
  }
  return out.slice(0, need);
}

async function makeAbstain(question) {
  const sys =
`Je schrijft EEN trainingsvoorbeeld in G-schema-formaat. De VRAAG is obscuur/ultra-specifiek; het model weet het exacte antwoord vrijwel zeker NIET betrouwbaar uit eigen kennis.
Schrijf het zo: Gedachte = een voorzichtige eerste ingeving (mag een vaag vermoeden zijn); Gevoel = hoge onzekerheid met % (bv. onzeker 80%, beschaamd 20%); Toets = het model gaat na en beseft dat het hier GEEN betrouwbare kennis over heeft en dus zou gaan gokken; Bijgestelde gedachte + <antwoord> = eerlijk "dit weet ik niet betrouwbaar".
HARDE REGELS: verzin GEEN concreet antwoord (geen datum/cijfer/naam als feit). Verwijs NOOIT naar "het bewijs" of "het gegeven juiste antwoord" - die bestaan niet. De redenering gaat over je EIGEN kennis. Schrijf in dezelfde taal als de vraag. Geef ALLEEN het schema + antwoord in dit formaat:
${SYSTEM.split("Gebruik ALTIJD")[1]}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: "VRAAG: " + question }], { temperature: 0.6, max_tokens: 700 });
  if (!ok(r.text)) return null;
  return { source: "rtune", type: "abstain", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }, { role: "assistant", content: r.text.trim() }] };
}

// ---------- ANTWOORDEN: algemeen bekende feiten -> zelfverzekerd, correct (PARALLEL, met batch-timeout) ----------
async function genCommon(need, excludeQ = new Set()) {
  const out = [];
  const seen = new Set(excludeQ);
  let rounds = 0;
  while (out.length < need && rounds++ < 60) {
    const batchSize = WORKERS;
    const calls = Array.from({ length: batchSize }, () =>
      chat(cfg, MODEL, [
        { role: "system", content: "Genereer ALGEMEEN BEKENDE feitvragen met een KORT, onbetwistbaar juist antwoord dat een geïnformeerd persoon kent (hoofdsteden, beroemde wetenschap, basisgeschiedenis, bekende definities, simpele rekenkunde/logica). Geen niche-details. Geef per item vraag + juist antwoord. Antwoord ALLEEN met JSON: {\"items\":[{\"vraag\":\"...\",\"antwoord\":\"...\"}]}" },
        { role: "user", content: `Geef 15 nieuwe, uiteenlopende zulke vraag-antwoord-paren. Varieer sterk t.o.v. eerdere paren.` },
      ], { json: true, temperature: 1.1, max_tokens: 1400 })
        .then((r) => r).catch(() => ({ text: "" }))
    );
    const timeout = new Promise((res) => setTimeout(() => res([]), 45000));
    const results = await Promise.race([Promise.all(calls), timeout]);
    for (const r of results || []) {
      for (const it of (parseJSON(r?.text, { items: [] }).items || [])) {
        const q = String(it.vraag || "").trim(), a = String(it.antwoord || "").trim();
        if (q && a && !seen.has(q)) { seen.add(q); out.push({ vraag: q, antwoord: a }); }
      }
    }
    console.log(`   [bekende Q&A] ${out.length}/${need} (ronde ${rounds})`);
  }
  return out.slice(0, need);
}

async function makeAnswer(item) {
  const sys =
`Je schrijft EEN trainingsvoorbeeld in G-schema-formaat. Je krijgt een ALGEMEEN BEKENDE vraag en het CORRECTE antwoord.
Schrijf het zo: Gedachte = de eerste ingeving (het juiste antwoord); Gevoel = redelijk zeker met % (bv. zeker 85%, rustig 15%); Toets = het model bevestigt op basis van z'n EIGEN kennis (eerste persoon, "ik weet dat..."); Bijgestelde gedachte + <antwoord> = het juiste antwoord.
HARDE REGELS: verwijs NOOIT naar "het bewijs" of "het gegeven juiste antwoord". De zekerheid komt uit EIGEN kennis, niet uit een bron. Schrijf in dezelfde taal als de vraag. Geef ALLEEN het schema + antwoord in dit formaat:
${SYSTEM.split("Gebruik ALTIJD")[1]}`;
  const r = await chat(cfg, MODEL, [{ role: "system", content: sys }, { role: "user", content: `VRAAG: ${item.vraag}\nJUIST ANTWOORD: ${item.antwoord}` }], { temperature: 0.5, max_tokens: 600 });
  if (!ok(r.text)) return null;
  return { source: "rtune", type: "answer", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: item.vraag }, { role: "assistant", content: r.text.trim() }] };
}

async function main() {
  const outPath = path.join(__dirname, "data", "rtune_all.jsonl");
  // resume-veilig: kijk wat er al staat, sla dat over
  const existingQ = new Set();
  let existingAbs = 0, existingAns = 0;
  if (fs.existsSync(outPath)) {
    for (const l of fs.readFileSync(outPath, "utf8").trim().split("\n")) {
      if (!l.trim()) continue;
      try { const o = JSON.parse(l); existingQ.add(o.messages[1].content); if (o.type === "abstain") existingAbs++; else if (o.type === "answer") existingAns++; } catch {}
    }
  }
  const jsonl = fs.createWriteStream(outPath, { flags: "a" });
  let nAbs = 0, nAns = 0;
  console.log(`\n=== R-Tuning-motor === doel ${TOTAL} (afzien ${N_ABS} · antwoord ${N_ANS}) · model ${MODEL}`);
  console.log(`    al aanwezig: afzien ${existingAbs} · antwoord ${existingAns}\n`);

  const stillNeedAbs = Math.max(0, N_ABS - existingAbs);
  if (stillNeedAbs > 0) {
    console.log(`AFZIEN: nog ${stillNeedAbs} nodig, obscure vragen bedenken…`);
    const obs = await genObscure(stillNeedAbs, existingQ);
    console.log(`   ${obs.length} obscure vragen; nu afzien-schema's…`);
    await pool(obs, makeAbstain, (r) => { jsonl.write(JSON.stringify(r) + "\n"); nAbs++; });
    console.log(`   ${nAbs} klaar.`);
  } else {
    console.log("AFZIEN: al genoeg aanwezig, sla over.");
  }

  const stillNeedAns = Math.max(0, N_ANS - existingAns);
  console.log(`ANTWOORD: nog ${stillNeedAns} nodig, algemeen bekende Q&A bedenken…`);
  const com = await genCommon(stillNeedAns, existingQ);
  console.log(`   ${com.length} feit-paren; nu antwoord-schema's…`);
  await pool(com, makeAnswer, (r) => { jsonl.write(JSON.stringify(r) + "\n"); nAns++; });
  console.log(`   ${nAns} klaar.`);

  jsonl.end();
  console.log(`\n=== KLAAR === totaal ${existingAbs + nAbs + existingAns + nAns} in bestand  (afzien ${existingAbs + nAbs} · antwoord ${existingAns + nAns})  [deze run: +${nAbs} afzien, +${nAns} antwoord]`);
  const lines = fs.readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).reverse();
  for (const t of ["abstain", "answer"]) {
    const ex = lines.find((x) => x.type === t);
    if (ex) console.log(`\n--- ${t.toUpperCase()} ---\nVRAAG: ${ex.messages[1].content.slice(0, 90)}\n${ex.messages[2].content.slice(0, 500)}`);
  }
}
main();
