// Web-search (het hele internet) voor grounding + verificatie.
// Ondersteunt Tavily en Brave (beide gratis tiers). Zonder key → null (dan valt evidence.js terug op Wikipedia).
async function tavily(key, query, max) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: max, search_depth: "basic", include_answer: false }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error("tavily " + res.status + ": " + JSON.stringify(d).slice(0, 150));
  return (d.results || []).map((r, i) => ({ id: "WEB:" + (host(r.url) || i), url: r.url, text: (r.title ? r.title + " — " : "") + String(r.content || "").slice(0, 1000) }));
}

async function brave(key, query, max) {
  const res = await fetch("https://api.search.brave.com/res/v1/web/search?count=" + max + "&q=" + encodeURIComponent(query), {
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
  });
  const d = await res.json();
  if (!res.ok) throw new Error("brave " + res.status);
  return (d.web?.results || []).map((r, i) => ({ id: "WEB:" + (host(r.url) || i), url: r.url, text: (r.title ? r.title + " — " : "") + String(r.description || "").slice(0, 700) }));
}

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

// getKey(provider) -> key|null.  Retourneert lijst {id,url,text} of null als geen web-search geconfigureerd.
async function webSearch(getKey, query, max = 5) {
  const tk = getKey("tavily"); if (tk && tk !== "MOCK") return tavily(tk, query, max);
  const bk = getKey("brave"); if (bk && bk !== "MOCK") return brave(bk, query, max);
  return null;
}

const hasWebSearch = (getKey) => !!(getKey("tavily") || getKey("brave"));

module.exports = { webSearch, hasWebSearch };
