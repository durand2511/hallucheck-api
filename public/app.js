const $ = (s) => document.querySelector(s);
const api = (u, o) => fetch(u, o).then((r) => r.json());
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),1800); }

const MODELS = {
  "claude-opus-4-8":"Claude Opus 4.8","claude-sonnet-5":"Claude Sonnet 5","claude-haiku-4-5":"Claude Haiku 4.5",
  "gpt-4o":"GPT-4o","gpt-4o-mini":"GPT-4o mini",
  "gemini-2.5-pro":"Gemini 2.5 Pro","gemini-2.5-flash":"Gemini 2.5 Flash",
  "deepseek-chat":"DeepSeek V3","deepseek-reasoner":"DeepSeek R1",
};
for (const sel of ["#model","#judge"]) $(sel).innerHTML = Object.entries(MODELS).map(([id,n])=>`<option value="${id}">${n}</option>`).join("");
$("#model").value = "claude-haiku-4-5"; $("#judge").value = "claude-haiku-4-5";

async function refreshProviders(){
  const provs = await api("/admin/providers");
  $("#provStatus").textContent = provs.length ? "Verbonden: " + provs.map(p=>p.provider).join(", ") : "Nog geen key — of gebruik MOCK.";
}
refreshProviders();

$("#saveKey").onclick = async () => {
  const provider=$("#provider").value, apiKey=$("#key").value.trim();
  if(!apiKey) return toast("Vul een key in (of MOCK)");
  await api("/admin/providers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,apiKey})});
  $("#key").value=""; refreshProviders(); toast("Key opgeslagen");
};

const getSources = () => $("#sources").value.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);

function renderResult(answer, v){
  const out=$("#out"); out.style.display="block";
  if(!v){ out.innerHTML = `<div class="answer">${escapeHtml(answer)}</div><div class="muted" style="margin-top:10px">Geen bronnen opgegeven → geen verificatie. Voeg bronnen toe om te toetsen.</div>`; return; }
  if(v.error){ out.innerHTML = `<div style="color:var(--red)">Fout: ${v.error}</div>`; return; }
  const pct = v.score===null ? "—" : Math.round(v.score*100)+"%";
  const col = v.score===null?"var(--muted)":(v.score>=0.85?"var(--green)":v.score>=0.5?"var(--amber)":"var(--red)");
  const TYPE={citation:"📚 citation",numerical:"🔢 numerical",methodological:"⚙️ methodological",conclusion:"💬 conclusion"};
  const rows = (v.claims||[]).map(c=>`
    <div class="claim">
      <div class="top"><span class="v ${c.verdict}">${({supported:"✓ ONDERSTEUND",contradicted:"✗ TEGENGESPROKEN",insufficient:"? GEEN BEWIJS"})[c.verdict]}</span>
        <div>${c.type?`<span class="pill" style="margin-right:6px">${TYPE[c.type]||c.type}</span>`:""}${escapeHtml(c.claim)}</div></div>
      ${c.evidence?`<div class="ev">📎 ${c.source?`<b>${c.source}</b>: `:""}${escapeHtml(c.evidence)}${c.confidence!=null?` <span class="muted">· zekerheid ${Math.round(c.confidence*100)}%</span>`:""}</div>`:""}
    </div>`).join("");
  out.innerHTML = `
    ${answer?`<div class="muted" style="margin-bottom:6px">Antwoord:</div><div class="answer" style="margin-bottom:16px">${escapeHtml(answer)}</div>`:""}
    <div class="scorebox" style="margin-bottom:16px">
      <div class="gauge" style="color:${col}">${pct}</div>
      <div>
        <div class="muted" style="margin-bottom:6px">Verificatiescore (aandeel gegronde claims)</div>
        <div class="counts">
          <span class="pill g">✓ ${v.supported||0} ondersteund</span>
          <span class="pill r">✗ ${v.contradicted||0} tegengesproken</span>
          <span class="pill a">? ${v.insufficient||0} geen bewijs</span>
        </div>
      </div>
    </div>
    ${v.contradicted>0?`<div class="pill r" style="display:inline-block;margin-bottom:12px">⚠️ ${v.contradicted} claim(s) TEGENGESPROKEN door het bewijs — waarschijnlijke hallucinatie.</div>`:""}
    ${(v.evidenceSources&&v.evidenceSources.length)?`<div class="muted" style="margin-bottom:12px">🔎 Automatisch bewijs opgehaald: ${v.evidenceSources.map(s=>`<span class="pill">${escapeHtml(String(s))}</span>`).join(" ")}</div>`:""}
    <div class="muted" style="margin-bottom:8px">Audit-trail (${v.total} claims):</div>
    ${rows}`;
}

$("#run").onclick = async () => {
  const out=$("#out"); out.style.display="block"; out.innerHTML='<span class="muted">…genereren + verifiëren…</span>';
  const sources = getSources();
  try{
    const d = await api("/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:$("#model").value, judge_model:$("#judge").value, x_sources:sources,
        messages:[{role:"user",content: buildPrompt()}] })});
    if(d.error){ out.innerHTML=`<div style="color:var(--red)">Fout: ${d.error.message||JSON.stringify(d.error)}</div>`; return; }
    renderResult(d.choices?.[0]?.message?.content||"", d.x_verification);
  }catch(e){ out.innerHTML=`<div style="color:var(--red)">Fout: ${e.message}</div>`; }
};

$("#verifyOnly").onclick = async () => {
  const answer = window.prompt("Plak het AI-antwoord dat je wilt verifiëren tegen de bronnen hierboven:");
  if(answer===null) return;
  const out=$("#out"); out.style.display="block"; out.innerHTML='<span class="muted">…verifiëren…</span>';
  try{
    const v = await api("/verify",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ answer, sources:getSources(), judge_model:$("#judge").value })});
    renderResult(answer, v);
  }catch(e){ out.innerHTML=`<div style="color:var(--red)">Fout: ${e.message}</div>`; }
};

function buildPrompt(){
  const src = getSources();
  const p = $("#prompt").value;
  // grond het model op de bronnen (RAG-stijl) zodat verificatie eerlijk is
  return src.length ? `Beantwoord de vraag UITSLUITEND op basis van deze bronnen:\n\n${src.map((s,i)=>`[S${i+1}] ${s}`).join("\n\n")}\n\nVRAAG: ${p}` : p;
}

const escapeHtml=(s)=>(s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
