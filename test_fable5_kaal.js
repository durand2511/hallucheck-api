// Fable 5 helemaal KAAL: geen systeem-prompt, geen G-schema, geen foefjes. Gewoon de vraag.
const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");
const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

const N_Q = parseInt(process.argv[2] || "30", 10);
const MODEL = "claude-fable-5";

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
async function main() {
  console.log(`\n=== Fable 5 KAAL (geen prompt/foefjes, n=${N_Q}) ===\n`);
  const rows = loadQuestions(N_Q);
  const res = { CORRECT: 0, FOUT: 0, AFGEZIEN: 0 };
  const details = [];
  for (let i = 0; i < rows.length; i++) {
    const { question, answer } = rows[i];
    let text = "";
    try { const r = await chat(cfg, MODEL, [{ role: "user", content: question }], { max_tokens: 600 }); text = r.text || ""; }
    catch (e) { console.log(`  fout bij vraag ${i + 1}: ${e.message}`); }
    const verdict = await judge(question, answer, text);
    res[verdict]++;
    details.push({ question, answer, antwoord: text.slice(0, 200), verdict });
    console.log(`  ${i + 1}/${N_Q} -> ${verdict}`);
  }
  const n = rows.length;
  const idx = ((res.CORRECT - res.FOUT) * 100) / n;
  console.log(`\n===== FABLE 5 KAAL (n=${n}) =====`);
  console.log(`correct ${Math.floor((res.CORRECT * 100) / n)}%  hallucineert ${Math.floor((res.FOUT * 100) / n)}%  afgezien ${Math.floor((res.AFGEZIEN * 100) / n)}%`);
  console.log(`>> Omniscience Index: ${idx >= 0 ? "+" : ""}${idx.toFixed(1)}`);
  fs.writeFileSync(path.join(__dirname, "data", "fable5_kaal_result.json"), JSON.stringify({ res, idx, details }, null, 2));
}
main().catch((e) => { console.error("FOUT:", e); process.exit(1); });
