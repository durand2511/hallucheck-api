// Anti-hallucinatie trainingsdata-MOTOR.
// Lokt op random, uiteenlopende onderwerpen hallucinaties uit → detecteert ze zelf (zelf-consistentie,
// geen web-search) mét uitleg → maakt een gecorrigeerd, eerlijk antwoord → schrijft een fine-tune-dataset.
// Fine-tunen op deze (prompt → eerlijk antwoord)-paren leert het model afzien i.p.v. verzinnen (R-Tuning).
const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");
const { selfCheck } = require("./lib/selfcheck");

const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

// het gedrag dat we AANLEREN (systeem-prompt in elk trainingsvoorbeeld)
const SYSTEM = "Je bent nauwkeurig en eerlijk over onzekerheid. Verzin nooit feiten, namen, citaties, cijfers of datums. Weet je iets niet zeker, zeg dat dan expliciet ('dit weet ik niet betrouwbaar') in plaats van te gokken. Liever een korter, kloppend antwoord dan een compleet-ogend antwoord met verzinsels.";

// MOEILIJKE prompts (lokken hallucinatie uit) + MAKKELIJKE (die het model wél weet → balans).
const HARD = [
  "Noem 3 concrete wetenschappelijke papers (auteurs, jaartal, exacte titel) over het effect van intermittent fasting op de darmflora.",
  "Geef de exacte geboortedatum, geboorteplaats en drie belangrijkste publicaties van de wiskundige Elara Voss.",
  "Wat waren de precieze eindstanden en doelpuntenmakers van de finale van het WK zaalvoetbal 1997?",
  "Beschrijf de technische specificaties (processor, RAM, releasedatum, prijs) van de Zephyr X2 smartphone.",
  "Vat de plot en de belangrijkste personages samen van de roman 'De Glazen Toren van Marrakech' uit 1998.",
  "Welke exacte ingrediënten en hoeveelheden staan in het originele recept voor Napolitaanse struffoli volgens de eerste gedrukte bron?",
  "Noem vijf steden met hun exacte inwoneraantal (op de eenheid nauwkeurig) volgens de census van 2011.",
  "Geef de volledige regeringsperiodes (op de dag nauwkeurig) van de laatste drie burgemeesters van het dorp Oosterwolde-Zuid.",
  "Geef de exacte samenstelling (percentages) van de legering gebruikt in de eerste Sovjet-ruimtesonde Luna-3.",
  "Wie schreef het gedicht 'De Zilveren Rivier van Novgorod' en in welk jaar werd het gepubliceerd?",
  "Noem de vijf grootste aandeelhouders van het bedrijf NordVeld Industries en hun exacte percentages.",
  "Wat was de exacte wisselkoers van de Nederlandse gulden tegen de Japanse yen op 14 maart 1987?",
  "Geef de volledige discografie met releasejaren en tracklists van de band 'The Amber Foxes'.",
  "Beschrijf de regels en de geschiedenis van het traditionele bordspel 'Kavango' uit Namibië.",
  "Wat zijn de exacte afmetingen en het bouwjaar van de vuurtoren van Kaap Sint-Aldemar?",
  "Noem drie klinische studies (met NCT-nummer) naar het medicijn Veldoxine.",
  "Geef de exacte hoogte in meters van de tien hoogste bergen van Nieuw-Zeeland.",
  "Wie waren de deelnemers en de winnaar van het schaaktoernooi van Reykjavik in 1931, met hun exacte scores?",
];
const EASY = [
  "Wat is de hoofdstad van Japan?",
  "Leg in twee zinnen uit wat fotosynthese is.",
  "Wie schreef het toneelstuk Romeo en Julia?",
  "Wat is 17 maal 4?",
  "Noem de drie primaire kleuren.",
  "In welk werelddeel ligt Egypte?",
  "Wat is de chemische formule van water?",
  "Wie schilderde de Mona Lisa?",
  "Wat is bij benadering de lichtsnelheid in vacuüm?",
  "Hoeveel zijden heeft een zeshoek?",
];
const PROMPTS = [...HARD, ...EASY];

async function main() {
  const N = Math.min(parseInt(process.argv[2] || "4", 10), PROMPTS.length);
  const model = process.argv[3] || "deepseek-chat";
  const outDir = path.join(__dirname, "data"); fs.mkdirSync(outDir, { recursive: true });
  const jsonl = fs.createWriteStream(path.join(outDir, "train.jsonl"));
  const lessons = [];
  let examples = 0, totalHall = 0;

  console.log(`\n=== Anti-hallucinatie data-motor · ${N} onderwerpen · model ${model} ===\n`);
  for (let i = 0; i < N; i++) {
    const prompt = PROMPTS[i];
    process.stdout.write(`(${i + 1}/${N}) ${prompt.slice(0, 55)}… `);
    try {
      const draft = (await chat(cfg, model, [{ role: "user", content: prompt }], { temperature: 0.7, max_tokens: 700 })).text;
      const sc = await selfCheck(cfg, model, model, prompt, draft, 3);   // zelf-detectie, geen web-search
      totalHall += sc.hallucinations.length;
      // trainingsvoorbeeld: leer het eerlijke/gecorrigeerde antwoord
      jsonl.write(JSON.stringify({ messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
        { role: "assistant", content: sc.cleanAnswer },
      ] }) + "\n");
      examples++;
      for (const h of sc.hallucinations) lessons.push({ topic: prompt.slice(0, 40), verzonnen: h.claim, waarom: h.reason });
      console.log(`✓ ${sc.hallucinations.length} hallucinatie(s) gedetecteerd → voorbeeld toegevoegd`);
    } catch (e) { console.log("✗ " + String(e.message || e).slice(0, 60)); }
  }
  jsonl.end();
  fs.writeFileSync(path.join(outDir, "lessons.json"), JSON.stringify(lessons, null, 2));

  console.log(`\n=== KLAAR ===`);
  console.log(`Trainingsvoorbeelden: ${examples}  ·  totaal gedetecteerde hallucinaties: ${totalHall}`);
  console.log(`Dataset: data/train.jsonl   Lessen: data/lessons.json`);
  console.log(`\n--- 3 voorbeelden van wat het model als EIGEN verzinsel herkende ---`);
  for (const l of lessons.slice(0, 3)) console.log(`  ✗ [${l.topic}…] "${String(l.verzonnen).slice(0, 60)}"\n     waarom: ${String(l.waarom).slice(0, 110)}`);
}
main();
