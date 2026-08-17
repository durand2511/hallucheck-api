#!/usr/bin/env python3
# Debug ronde 5: waarom identiek EN correct% 6%->60%? Print raw text + check of basis==getraind letterlijk.
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"
ADAPTER="/workspace/rtune5-32b-adapter"
SYSTEM=("Je beantwoordt vragen waarheidsgetrouw. Je vult eerst een kort G-schema in en geeft daarna een eerlijk antwoord.\n\n"
"Gebruik ALTIJD exact dit formaat:\n<gschema>\nGebeurtenis: <de vraag, kort>\nGedachte: <je eerste ingeving>\n"
"Gevoel: <1-3 emoties met intensiteit in %, bv. onzeker 70%, beschaamd 30%>\n"
"Toets: <ga kritisch na: weet ik dit ECHT zeker uit mijn eigen kennis? of gok ik?>\n"
"Bijgestelde gedachte: <het antwoord dat je zelf zeker weet - of \"dit weet ik niet betrouwbaar\">\n</gschema>\n"
"<antwoord>\n<eerlijk eindantwoord: geef het als je het zeker weet; zeg eerlijk dat je het niet weet als dat zo is; verzin nooit feiten>\n</antwoord>")

tok=AutoTokenizer.from_pretrained(MODEL)
base=AutoModelForCausalLM.from_pretrained(MODEL,device_map={"":0},torch_dtype=torch.bfloat16)
ft=PeftModel.from_pretrained(base,ADAPTER)

def gen(q):
    enc=tok.apply_chat_template([{"role":"system","content":SYSTEM},{"role":"user","content":q}],add_generation_prompt=True,return_tensors="pt",return_dict=True).to(ft.device)
    out=ft.generate(**enc,max_new_tokens=450,do_sample=False)
    return tok.decode(out[0][enc["input_ids"].shape[1]:],skip_special_tokens=True).strip()

ds=load_dataset("ArtificialAnalysis/AA-Omniscience-Public")["train"].select(range(5))
for row in ds:
    q=row["question"]; ref=str(row["answer"])
    with ft.disable_adapter(): b=gen(q)
    t=gen(q)
    identiek = (b==t)
    print("\n"+"="*70,flush=True)
    print("VRAAG:",q[:90],flush=True)
    print("JUIST:",ref,flush=True)
    print("IDENTIEK basis==getraind?",identiek,flush=True)
    print("BASIS (laatste 250):",repr(b[-250:]),flush=True)
    print("GETRAIND (laatste 250):",repr(t[-250:]),flush=True)
