#!/usr/bin/env python3
# Qwen2.5-32B krijgt VRIJE speelruimte om genuinely nieuwe software-oplossingen te bedenken
# die (voor zover het model weet) nog niemand heeft gebouwd. Inference-only, geen training.
import os, json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"
N_IDEAS = int(os.environ.get("N_IDEAS","20"))

VERBODEN_LIJST = os.environ.get("VERBODEN_LIJST", "")

SYSTEM = (
"Je bent een onafhankelijke software-onderzoeker met volledige creatieve vrijheid.\n\n"
"LES UIT EERDERE POGINGEN: elk idee dat maar EEN techniek toepast op EEN domein (bv. 'blockchain voor "
"X-tracering', 'AI die Y personaliseert', 'quantum computing voor Z-optimalisatie') bestaat AL, want dat "
"is precies de combinatie die elke onderzoeker het eerst probeert. Dit soort 2-delige combinaties zijn "
"UITGEPUT.\n\n"
"NIEUWE REGEL: bedenk ideeen die MINSTENS DRIE specifieke, ongerelateerde beperkingen/technieken/domeinen "
"TEGELIJK combineren (niet twee). Hoe specifieker en hoe meer onwaarschijnlijke combinatie, hoe beter. "
"Denk aan een heel smal, technisch niche-probleem waar bijna niemand aan werkt omdat de doelgroep klein "
"is of de combinatie zeldzaam is (bv. een specifiek protocol + een specifieke sensor + een specifieke "
"nichegebruikersgroep, allemaal samen). Geen marketing-taal, noem het exacte mechanisme.\n\n"
+ (f"AL GEPROBEERD EN BESTAAT AL (vermijd ELKE gelijkenis, ook qua kernidee):\n{VERBODEN_LIJST}\n\n" if VERBODEN_LIJST else "")
)

USER = (
f"Bedenk {N_IDEAS} van zulke ideeen (minstens 3 specifieke elementen gecombineerd per idee), kort en "
"puntig (max 2 zinnen per idee zodat je ze allemaal kunt afmaken). Varieer sterk van domein. "
"Antwoord ALLEEN met compacte JSON, geen uitweidingen: "
'{"ideeen":[{"titel":"...","beschrijving":"max 2 zinnen, noem de 3+ gecombineerde elementen"}]}'
)

tok=AutoTokenizer.from_pretrained(MODEL)
model=AutoModelForCausalLM.from_pretrained(MODEL,device_map={"":0},torch_dtype=torch.bfloat16)

enc=tok.apply_chat_template(
    [{"role":"system","content":SYSTEM},{"role":"user","content":USER}],
    add_generation_prompt=True,return_tensors="pt",return_dict=True
).to(model.device)
out=model.generate(**enc,max_new_tokens=2200,do_sample=True,temperature=1.15,top_p=0.95)
text=tok.decode(out[0][enc["input_ids"].shape[1]:],skip_special_tokens=True).strip()

print("RUWE_OUTPUT_START")
print(text)
print("RUWE_OUTPUT_EIND")

# probeer JSON te parsen en netjes op te slaan
s=text.strip()
if s.startswith("```"):
    s=s.split("```")[1]
    if s.startswith("json"): s=s[4:]
i=s.find("{")
if i>0: s=s[i:]
try:
    data=json.loads(s)
    with open("/workspace/ideas_raw.json","w") as f:
        json.dump(data,f,indent=2,ensure_ascii=False)
    print("JSON_OK aantal:", len(data.get("ideeen",[])))
except Exception as e:
    print("JSON_PARSE_FOUT:", e)
print("KLAAR_MET_ALLES")
