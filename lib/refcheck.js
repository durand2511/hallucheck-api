// Referentie-verificatie (CoE Integrity check I3): zoek kandidaten in Crossref (gratis, geen key).
// De uiteindelijke "bestaat dit werk echt?"-beslissing doet een LLM-cross-check in verify.js —
// exact zoals ScientistOne: "An LLM cross-checks the bib entry against returned records."
async function searchCrossref(query) {
  const q = String(query || "").slice(0, 300);
  if (!q.trim()) return { ok: true, items: [] };
  try {
    const url = "https://api.crossref.org/works?rows=5&mailto=hallucheck@example.com&select=title,author,issued,DOI&query.bibliographic=" + encodeURIComponent(q);
    const res = await fetch(url, { headers: { "User-Agent": "HalluCheck/1.0 (mailto:hallucheck@example.com)" } });
    if (!res.ok) return { ok: false, note: "crossref " + res.status, items: [] };
    const data = await res.json();
    const items = (data.message?.items || [])
      .map((it) => ({ title: (it.title && it.title[0]) || "", year: it.issued?.["date-parts"]?.[0]?.[0], doi: it.DOI }))
      .filter((x) => x.title);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, note: String(e.message || e), items: [] };
  }
}

module.exports = { searchCrossref };
