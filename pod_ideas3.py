#!/usr/bin/env python3
# Ronde 5: introspectie -- laat Qwen ZIJN EIGEN tekortkomingen/frustraties als AI-model benoemen,
# en daaruit software-oplossingen afleiden. Andere hoek dan vrij brainstormen of een gegeven probleem.
import os, json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"

tok=AutoTokenizer.from_pretrained(MODEL)
model=AutoModelForCausalLM.from_pretrained(MODEL,device_map={"":0},torch_dtype=torch.bfloat16)

def gen(system, user, max_new_tokens=900, temp=0.9):
    enc=tok.apply_chat_template(
        [{"role":"system","content":system},{"role":"user","content":user}],
        add_generation_prompt=True,return_tensors="pt",return_dict=True
    ).to(model.device)
    out=model.generate(**enc,max_new_tokens=max_new_tokens,do_sample=True,temperature=temp,top_p=0.95)
    return tok.decode(out[0][enc["input_ids"].shape[1]:],skip_special_tokens=True).strip()

# Stap 1: introspectie -- wat frustreert het model zelf, als AI-systeem, in de praktijk?
VERBODEN_INTRO = os.environ.get("VERBODEN_INTRO", "")
INTRO_SYSTEM = (
"Je bent een taalmodel dat eerlijk introspecteert. Denk aan de concrete, technische manieren waarop "
"AI-modellen zoals jij vandaag WORDEN GEBRUIKT (via APIs, in agentic loops, met tools, in pijplijnen "
"zoals fine-tuning/evaluatie/RAG) en waar dat GEBRUIK zelf op vastloopt of frustrerend/omslachtig is "
"-- niet 'ik wou dat ik meer wist', maar concrete INFRASTRUCTUUR/TOOLING-gaten rond hoe modellen worden "
"ingezet, getest, gecontroleerd, of geketend. Wees zeer specifiek en technisch.\n\n"
"VERMIJD DE GROTE, VEELBESPROKEN CATEGORIEEN (die zijn al opgelost, want iedereen praat erover):\n"
"unified LLM-API-gateway/laag, gestandaardiseerd data-uitwisselingsprotocol tussen modellen/tools, "
"agent-observability/tracing, gestandaardiseerd evaluatie-framework, gedistribueerd "
"training/finetuning-platform, fact-checking/hallucinatie-detectie-tooling, RAG-pipeline-framework, "
"blockchain-gebaseerd model-update-platform.\n" + (f"OOK VERMIJDEN: {VERBODEN_INTRO}\n" if VERBODEN_INTRO else "") +
"\nZoek juist naar KLEINE, OBSCURE, zeer specifieke wrijvingspunten die niemand vaak genoeg benoemt om "
"er een heel product voor te bouwen -- iets waar jij als model tegenaan loopt in een heel specifiek, "
"smal scenario, niet een grote architectuur-categorie."
)
INTRO_USER = (
"Noem 15 concrete, KLEINE en OBSCURE frustraties/gaten (geen grote architectuur-categorieen, zie "
"instructies) in hoe AI-modellen zoals jij vandaag worden gebruikt of getest in software-pijplijnen. "
"Antwoord ALLEEN met JSON: {\"frustraties\":[\"...\"]}"
)
intro_text = gen(INTRO_SYSTEM, INTRO_USER, max_new_tokens=1600, temp=1.05)
print("=== INTROSPECTIE RUW ===")
print(intro_text)

def parse_json(s):
    s=s.strip()
    if s.startswith("```"):
        s=s.split("```")[1]
        if s.startswith("json"): s=s[4:]
    i=s.find("{")
    if i>0: s=s[i:]
    try: return json.loads(s)
    except Exception as e:
        print("parse fout:", e); return {"frustraties":[]}

frustraties = parse_json(intro_text).get("frustraties", [])[:15]
print(f"\n{len(frustraties)} frustraties gevonden.\n")

# Stap 2: per frustratie een concrete technische oplossing bedenken
SOL_SYSTEM = (
"Je bent een software-architect. Je krijgt een frustratie/gat in AI-tooling die een taalmodel zelf "
"benoemde. Bedenk een concrete technische oplossing (tool/library/architectuur/protocol). Wees "
"specifiek: welk mechanisme, welke aanpak. Als het al bestaat, zeg dat eerlijk."
)
resultaten=[]
for i, f in enumerate(frustraties):
    sol = gen(SOL_SYSTEM, f"FRUSTRATIE: {f}\n\nGeef een concrete oplossing (max 4 zinnen).", max_new_tokens=400, temp=0.8)
    print(f"\n=== FRUSTRATIE {i+1} ===\n{f}\n--- OPLOSSING ---\n{sol}")
    resultaten.append({"frustratie": f, "oplossing": sol})

with open("/workspace/ideas_introspectie.json","w") as f:
    json.dump(resultaten,f,indent=2,ensure_ascii=False)
print("\nKLAAR_MET_ALLES")
