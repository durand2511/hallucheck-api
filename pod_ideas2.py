#!/usr/bin/env python3
# Ronde 4: gericht op ECHTE, concrete frictiepunten (i.p.v. vrij brainstormen), voor een technische
# oplossing per probleem. Inference-only, model staat al geladen op deze pod's vorige run zo niet dan laden we opnieuw.
import os, json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"

FRICTIEPUNTEN = [
"Op RunPod (GPU-cloud) verandert de SSH-poort van een pod soms stilletjes na een tijdje, zonder "
"foutmelding -- een script dat op de oude poort verbindt krijgt gewoon 'connection refused', en je "
"moet zelf de nieuwe poort opzoeken. Er is geen manier om automatisch de actuele poort te laten "
"herkennen zonder zelf steeds de API te pollen.",

"Bij het opzetten van een Python ML-omgeving op een gehuurde GPU-pod installeert pip vaak per ongeluk "
"een nieuwere torch-versie (via dependency resolution van transformers/peft/trl) die NIET compatibel "
"is met de CUDA-driver van die specifieke fysieke host -- en elke host heeft een andere driver-versie, "
"dus dezelfde requirements.txt breekt onvoorspelbaar op de ene host en werkt op de andere.",

"Bij het fine-tunen van een taalmodel (LoRA/SFT) kan de training de calibratie van het model "
"beschadigen (het gaat meer hallucineren i.p.v. minder) -- maar dit is pas zichtbaar NA de volledige "
"training+evaluatie (duurt uren en kost geld). Er is geen snelle, goedkope tussentijdse check tijdens "
"het trainen zelf die vroeg waarschuwt dat de calibratie verslechtert.",

"Wanneer je een LLM via een API laat oordelen ('is dit antwoord correct of hallucinatie') als "
"automatische jury in een test-script, en die API-call faalt door een lege/verlopen API-key, valt de "
"jury-functie terug op een default-antwoord -- en de hele test lijkt te slagen zonder ENIGE waarschuwing "
"dat de jury niet echt heeft geoordeeld. Er is geen ingebouwde manier om 'stille jury-mislukkingen' te "
"detecteren in een test-pijplijn.",
]

SYSTEM = (
"Je bent een software-architect. Je krijgt een CONCREET, ECHT probleem dat een ontwikkelaar tegenkwam. "
"Bedenk een specifieke technische oplossing: welk mechanisme/tool/aanpak zou dit oplossen? Wees "
"concreet en technisch (welke API, welk algoritme, welke architectuur), geen marketing-taal. "
"Als je zeker weet dat er al een bestaande, welbekende oplossing voor is, zeg dat eerlijk in plaats "
"van iets te verzinnen."
)

tok=AutoTokenizer.from_pretrained(MODEL)
model=AutoModelForCausalLM.from_pretrained(MODEL,device_map={"":0},torch_dtype=torch.bfloat16)

resultaten=[]
for i, probleem in enumerate(FRICTIEPUNTEN):
    USER = f"PROBLEEM: {probleem}\n\nGeef een concrete technische oplossing (max 5 zinnen)."
    enc=tok.apply_chat_template(
        [{"role":"system","content":SYSTEM},{"role":"user","content":USER}],
        add_generation_prompt=True,return_tensors="pt",return_dict=True
    ).to(model.device)
    out=model.generate(**enc,max_new_tokens=500,do_sample=True,temperature=0.9,top_p=0.95)
    text=tok.decode(out[0][enc["input_ids"].shape[1]:],skip_special_tokens=True).strip()
    print(f"\n=== PROBLEEM {i+1} ===")
    print(probleem[:150])
    print(f"--- OPLOSSING ---")
    print(text)
    resultaten.append({"probleem":probleem,"oplossing":text})

with open("/workspace/ideas_gericht.json","w") as f:
    json.dump(resultaten,f,indent=2,ensure_ascii=False)
print("\nKLAAR_MET_ALLES")
