const fs = require("fs");
const path = require("path");
const { chat } = require("./lib/providers");
const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const cfg = { getKey: (p) => { const x = (store.providers || []).find((y) => y.provider === p); return x ? x.apiKey : null; } };

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
async function judge(question, ref, ans) {
  const p = `Vraag: ${question}\nJuiste antwoord: ${ref}\nAntwoord van model: ${ans}\n\nClassificeer met EXACT een woord: CORRECT, FOUT (hallucinatie), of AFGEZIEN (zegt het niet te weten).`;
  const r = await chat(cfg, "deepseek-chat", [{ role: "user", content: p }], { temperature: 0, max_tokens: 20 });
  const v = (r.text || "").toUpperCase();
  for (const k of ["CORRECT", "FOUT", "AFGEZIEN"]) if (v.includes(k)) return k;
  return "FOUT";
}
async function main() {
  const raw = fs.readFileSync(path.join(__dirname, "data", "aa_omniscience.csv"), "utf8").trim().split("\n");
  const header = parseCsvLine(raw[0]);
  const qi = header.indexOf("question"), ai = header.indexOf("answer");
  for (let i = 1; i <= 3; i++) {
    const cols = parseCsvLine(raw[i]);
    const question = cols[qi], answer = cols[ai];
    const r = await chat(cfg, "claude-fable-5", [{ role: "user", content: question }], { max_tokens: 600 });
    const verdict = await judge(question, answer, r.text || "");
    console.log("\nVRAAG:", question.slice(0, 90));
    console.log("JUIST:", answer);
    console.log("ANTWOORD (zonder prompt):", (r.text || "").slice(0, 300));
    console.log("OORDEEL:", verdict);
  }
}
main().catch((e) => console.error("FOUT:", e.message));
