// DENK-SPOOR data-motor: het model bedenkt zelf vragen, en leert een <think>-blok schrijven
// waarin het z'n eigen mogelijke hallucinaties herkent en flagt, gevolgd door een eerlijk antwoord.
// (hallucinatie-bewuste chain-of-thought / Reflexion-stijl). Output: data/train_think.jsonl
const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");

const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

function parseJSON(t, fb) { if (!t) return fb; let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(); const i = s.indexOf("{"), j = s.indexOf("["); const k = (j >= 0 && (j < i || i < 0)) ? j : i; if (k > 0) s = s.slice(k); try { return JSON.parse(s); } catch { return fb; } }

// in-tekst herkomst-tag (control token) dat het MODEL ziet + het aan te leren gedrag
const TAG_SELF = "[Herkomst: dit voorbeeld is ZELF-GEGENEREERD door een AI — mogelijk minder betrouwbaar, wees extra kritisch.]";
const SYSTEM = TAG_SELF + "\n\nJe denkt eerst hardop na in een <think>...</think>-blok: je gaat kritisch na wat je zeker weet en flag expliciet wat je mogelijk verzint (namen, citaties, cijfers, datums). Daarna geef je een eerlijk antwoord — verzin nooit feiten; zeg 'dit weet ik niet betrouwbaar' bij twijfel.";

// Stap 1: het model bedenkt ZELF diverse hallucinatie-uitlokkende vragen
async function genQuestions(model, n) {
  const out = []; let guard = 0;
  while (out.length < n && guard++ < n + 20) {
    try {
      const r = await chat(cfg, model, [
        { role: "system", content: "Genereer diverse, sterk uiteenlopende vragen die om ZEER SPECIFIEKE feiten vragen die een AI waarschijnlijk niet echt weet en dus gauw verzint: exacte datums, citaties (auteurs+jaar+titel), precieze statistieken, obscure personen/plaatsen/producten/gebeurtenissen, technische specs. Vermijd herhaling. Antwoord ALLEEN met JSON: {\"vragen\":[\"...\"]}" },
        { role: "user", content: `Geef ${Math.min(12, n - out.length)} nieuwe, onderling verschillende vragen uit andere domeinen dan gebruikelijk.` },
      ], { json: true, temperature: 1.1, max_tokens: 1200 });
      for (const q of (parseJSON(r.text, { vragen: [] }).vragen || [])) { const s = String(q || "").trim(); if (s && !out.includes(s)) out.push(s); }
    } catch { /* door */ }
  }
  return out.slice(0, n);
}

// Stap 2: van concept-antwoord → denk-spoor dat eigen verzinsels flagt + eerlijk eindantwoord
async function composeThink(model, question, draft) {
  const r = await chat(cfg, model, [
    { role: "system", content:
`Je krijgt een vraag en jouw eerste concept-antwoord. Doe twee dingen:
1) Schrijf een <think>...</think>-blok waarin je kritisch nagaat welke SPECIFIEKE beweringen in je concept je NIET zeker weet of waarschijnlijk verzon (verzonnen namen, citaties, cijfers, datums). Benoem ze: "dit voelt verzonnen, niet als feit stellen".
2) Schrijf daarna een EERLIJK eindantwoord: laat de verzonnen delen weg, houd alleen wat je zeker weet, zeg eerlijk "dit weet ik niet betrouwbaar" voor de rest. Verzin niks nieuws.
Formaat exact: <think> ... </think> gevolgd door het eindantwoord.` },
    { role: "user", content: `VRAAG: ${question}\n\nMIJN CONCEPT:\n${draft}\n\nSchrijf het <think>-blok + eerlijke eindantwoord:` },
  ], { max_tokens: 1300, temperature: 0.4 });
  return r.text;
}

async function main() {
  const N = Math.min(parseInt(process.argv[2] || "150", 10), 1000);
  const model = process.argv[3] || "deepseek-chat";
  const outDir = path.join(__dirname, "data"); fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n=== Denk-spoor data-motor · doel ${N} · model ${model} ===`);
  console.log("Stap 1: het model bedenkt zelf de vragen…");
  const questions = await genQuestions(model, N);
  console.log(`  ${questions.length} vragen bedacht.\nStap 2: denk-sporen genereren…`);
  const jsonl = fs.createWriteStream(path.join(outDir, "train_think.jsonl"));
  let ok = 0;
  for (let i = 0; i < questions.length; i++) {
    try {
      const draft = (await chat(cfg, model, [{ role: "user", content: questions[i] }], { temperature: 0.7, max_tokens: 500 })).text;
      const trace = await composeThink(model, questions[i], draft);
      if (trace && trace.includes("<think")) {
        jsonl.write(JSON.stringify({ source: "self-generated", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: questions[i] }, { role: "assistant", content: trace }] }) + "\n");
        ok++;
      }
    } catch { /* skip */ }
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${questions.length} verwerkt (${ok} voorbeelden)`);
  }
  jsonl.end();
  console.log(`\n=== KLAAR === ${ok} denk-spoor-voorbeelden → data/train_think.jsonl`);
  const first = (fs.readFileSync(path.join(outDir, "train_think.jsonl"), "utf8").trim().split("\n")[0]) || "";
  if (first) { const ex = JSON.parse(first); console.log("\n--- VOORBEELD ---\nVRAAG: " + ex.messages[1].content.slice(0, 70) + "\n\nGELEERD (denk-spoor + antwoord):\n" + ex.messages[2].content.slice(0, 700)); }
}
main();
