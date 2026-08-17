// Automatisch bewijs ophalen (evidence-by-construction) — zodat je ALLEEN een vraag hoeft te stellen.
// Gratis bronnen zonder API-key: Wikipedia (feiten) + (citaties gaan via Crossref in refcheck.js).
const UA = { "User-Agent": "HalluCheck/1.0 (hallucination-verification; mailto:hallucheck@example.com)" };

async function wiki(lang, query) {
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const s = await fetch(`${base}?action=query&list=search&srlimit=2&format=json&srsearch=` + encodeURIComponent(query), { headers: UA }).then((r) => r.json()).catch(() => null);
  const titles = (s?.query?.search || []).map((x) => x.title).slice(0, 2);
  const out = [];
  for (const t of titles) {
    const e = await fetch(`${base}?action=query&prop=extracts&exintro=1&explaintext=1&format=json&redirects=1&titles=` + encodeURIComponent(t), { headers: UA }).then((r) => r.json()).catch(() => null);
    const pages = e?.query?.pages || {};
    for (const k in pages) if (pages[k].extract) out.push({ id: "WIKI:" + t, text: pages[k].extract.slice(0, 1200) });
  }
  return out;
}

// haal bewijs voor één zoekterm/claim (nl eerst, dan en)
async function gatherFor(query) {
  try {
    let r = await wiki("nl", query);
    if (!r.length) r = await wiki("en", query);
    return r;
  } catch { return []; }
}

const { webSearch } = require("./websearch");

// verzamel (gededupliceerd) bewijs voor een lijst claims.
// getKey aanwezig + web-search-key → HET HELE WEB (Tavily/Brave). Anders → Wikipedia.
async function gatherEvidence(queries, maxSources = 8, getKey = () => null) {
  const seen = new Set();
  const pool = [];
  for (const q of queries) {
    if (pool.length >= maxSources) break;
    let items = [];
    try {
      const web = await webSearch(getKey, q, 4);
      items = web !== null ? web : await gatherFor(q);   // web óf Wikipedia-fallback
    } catch { items = await gatherFor(q); }
    for (const it of items) {
      if (!seen.has(it.id)) { seen.add(it.id); pool.push(it); }
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return pool.slice(0, maxSources);
}

module.exports = { gatherEvidence };
