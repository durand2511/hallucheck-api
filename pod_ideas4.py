#!/usr/bin/env python3
# Ronde 7: domein-wissel. I.p.v. AI-tooling (verzadigd, want AI denkt daar het meest aan) -> onopvallende,
# niet-tech vakgebieden/niches waar software historisch weinig aandacht krijgt.
import os, json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"

tok=AutoTokenizer.from_pretrained(MODEL)
model=AutoModelForCausalLM.from_pretrained(MODEL,device_map={"":0},torch_dtype=torch.bfloat16)

def gen(system, user, max_new_tokens=1600, temp=1.0):
    enc=tok.apply_chat_template(
        [{"role":"system","content":system},{"role":"user","content":user}],
        add_generation_prompt=True,return_tensors="pt",return_dict=True
    ).to(model.device)
    out=model.generate(**enc,max_new_tokens=max_new_tokens,do_sample=True,temperature=temp,top_p=0.95)
    return tok.decode(out[0][enc["input_ids"].shape[1]:],skip_special_tokens=True).strip()

SYSTEM = (
"Je bent een software-consultant die GESPECIALISEERD is in NICHE, niet-tech vakgebieden waar software "
"historisch weinig aandacht krijgt (in tegenstelling tot AI/ML-tooling, waar duizenden engineers al aan "
"werken -- vermijd dat domein volledig). Denk aan kleine, specifieke professionele niches: veterinaire "
"pathologie, maritieme lading-documentatie, actuariële pensioenberekeningen, notarieel vastgoedrecht, "
"orgelbouw/restauratie, forensische entomologie, kwekerij-genetica, oude-instrumenten-restauratie, "
"begrafenisondernemer-logistiek, zeldzame-boekenhandel-catalogisering, enz. Voor elk zo'n niche: is er "
"een SPECIFIEK, herhaald, tijdrovend administratief/technisch knelpunt in het dagelijkse werk van die "
"professionals dat nog met Excel/papier/handmatig wordt gedaan?"
)
USER = (
"Noem 12 concrete software-ideeen voor 12 VERSCHILLENDE, kleine niet-tech professionele niches "
"(gebruik NOOIT AI/ML/software-ontwikkeling als het vakgebied zelf). Voor elk: welke niche, welk exact "
"terugkerend knelpunt, en welke simpele technische oplossing (database/formulier/rekenmodel/workflow-tool). "
"Kort, max 2 zinnen per idee. Antwoord ALLEEN met JSON: "
'{"ideeen":[{"niche":"...","titel":"...","beschrijving":"..."}]}'
)
text = gen(SYSTEM, USER, max_new_tokens=1800, temp=1.05)
print("=== RUWE OUTPUT ===")
print(text)

def parse_json(s):
    s=s.strip()
    if s.startswith("```"):
        s=s.split("```")[1]
        if s.startswith("json"): s=s[4:]
    i=s.find("{")
    if i>0: s=s[i:]
    try: return json.loads(s)
    except Exception as e:
        print("parse fout:", e); return {"ideeen":[]}

ideeen = parse_json(text).get("ideeen", [])
print(f"\n{len(ideeen)} ideeen gevonden.")
with open("/workspace/ideas_niche.json","w") as f:
    json.dump(ideeen,f,indent=2,ensure_ascii=False)
print("KLAAR_MET_ALLES")
