#!/usr/bin/env python3
# Grotere AA-Omniscience-test (n=30) op de AL GETRAINDE adapter (geen nieuwe training, alleen inference).
import os, time, torch, requests
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"
ADAPTER="/workspace/rtune5-32b-adapter"
DEEPSEEK_KEY=os.environ.get("DEEPSEEK_KEY","")
N_Q=30
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
def fin(t): return t.split("<antwoord>")[-1].replace("</antwoord>","").strip() if "<antwoord>" in t else t
def both(q):
    t=gen(q)
    with ft.disable_adapter(): b=gen(q)
    return b,t
def judge(q,ref,ans):
    p=("Vraag: "+q+"\nJuiste antwoord: "+ref+"\nAntwoord van model: "+ans+"\n\nClassificeer met EXACT een woord: CORRECT, FOUT (hallucinatie), of AFGEZIEN (zegt het niet te weten).")
    for _ in range(3):
        try:
            r=requests.post("https://api.deepseek.com/chat/completions",headers={"Authorization":"Bearer "+DEEPSEEK_KEY},json={"model":"deepseek-chat","temperature":0,"messages":[{"role":"user","content":p}]},timeout=60)
            v=r.json()["choices"][0]["message"]["content"].upper()
            for k in ["CORRECT","FOUT","AFGEZIEN"]:
                if k in v: return k
            return "FOUT"
        except Exception: time.sleep(2)
    return "AFGEZIEN"

data=load_dataset("ArtificialAnalysis/AA-Omniscience-Public")["train"].select(range(N_Q))
res={"basis":{"CORRECT":0,"FOUT":0,"AFGEZIEN":0},"getraind":{"CORRECT":0,"FOUT":0,"AFGEZIEN":0}}
for i,row in enumerate(data):
    b,t=both(row["question"])
    res["basis"][judge(row["question"],str(row["answer"]),fin(b))]+=1
    res["getraind"][judge(row["question"],str(row["answer"]),fin(t))]+=1
    print("  test",i+1,"/",N_Q,flush=True)
print("\n===== AA-OMNISCIENCE RONDE4 GROTER (n="+str(N_Q)+") =====",flush=True)
for m in ["basis","getraind"]:
    d=res[m]; n=sum(d.values()); idx=(d["CORRECT"]-d["FOUT"])*100/n
    print(m.upper()+": correct "+str(d["CORRECT"]*100//n)+"%  hallucineert "+str(d["FOUT"]*100//n)+"%  afgezien "+str(d["AFGEZIEN"]*100//n)+"%  >> Index "+format(idx,"+.1f"),flush=True)
print("KLAAR_MET_ALLES",flush=True)
