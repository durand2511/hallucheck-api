// LLM-provider adapters. Ingang = OpenAI-chat-formaat. Gebruikt voor genereren,
// claim-extractie én het entailment-oordeel (allemaal LLM-calls).
const DEFAULTS = {
  openai:    "https://api.openai.com/v1/chat/completions",
  gemini:    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  deepseek:  "https://api.deepseek.com/v1/chat/completions",
  openrouter:"https://openrouter.ai/api/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

function providerOf(model) {
  if (/^claude/.test(model)) return "anthropic";
  if (/^gemini/.test(model)) return "gemini";
  if (/^deepseek/.test(model)) return "deepseek";
  return "openai";
}

function mockChat(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return `【MOCK】 (geen echte key) — ontvangen: ${String(last ? last.content : "").slice(0, 80)}`;
}

async function callOpenAICompat({ url, apiKey, model, messages, temperature, max_tokens, json }) {
  const body = { model, messages, temperature: temperature ?? 0, max_tokens: max_tokens ?? 1024 };
  if (json) body.response_format = { type: "json_object" };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${model} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return { text: data.choices?.[0]?.message?.content ?? "", inTok: data.usage?.prompt_tokens || 0, outTok: data.usage?.completion_tokens || 0 };
}

async function callAnthropic({ url, apiKey, model, messages, temperature, max_tokens }) {
  const system = messages.filter((m) => m.role === "system").map((m) => String(m.content || "")).join("\n\n");
  const convo = messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: String(m.content || "") }));
  const body = { model, max_tokens: max_tokens || 1024, system: system || undefined, messages: convo };
  if (!/^claude-fable/.test(model)) body.temperature = temperature ?? 0; // fable-modellen accepteren temperature niet meer
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${model} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, inTok: data.usage?.input_tokens || 0, outTok: data.usage?.output_tokens || 0 };
}

// Claude met INGEBOUWDE web-search (server-side tool) — Claude zoekt zelf het live web af.
async function anthropicWebSearch({ apiKey, model, system, messages, max_tokens, maxUses = 5 }) {
  const convo = messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: String(m.content || "") }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: max_tokens || 3000, system: system || undefined, messages: convo,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`web_search ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  // verzamel bron-URLs uit citaties/zoekresultaten
  const urls = new Set();
  for (const b of data.content || []) {
    for (const cit of b.citations || []) if (cit.url) urls.add(cit.url);
    if (b.type === "web_search_tool_result") for (const r of b.content || []) if (r.url) urls.add(r.url);
  }
  return { text, urls: [...urls] };
}

// cfg = { getKey(provider) -> apiKey|null }
async function chat(cfg, model, messages, opts = {}) {
  const provider = providerOf(model);
  const apiKey = cfg.getKey(provider);
  if (!apiKey || apiKey === "MOCK") return { text: mockChat(messages), inTok: 0, outTok: 0, mock: true };
  const url = DEFAULTS[provider];
  if (provider === "anthropic") return callAnthropic({ url, apiKey, model, ...opts, messages });
  return callOpenAICompat({ url, apiKey, model, ...opts, messages });
}

module.exports = { chat, anthropicWebSearch, providerOf, DEFAULTS };
