#!/usr/bin/env python3
# Test ZONDER het G-schema-systeem-prompt: laat zien of de fine-tuning ZELF (de gewichten)
# afzien-gedrag heeft geleerd, onafhankelijk van prompt-engineering.
import os, time, torch, requests
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

MODEL="unsloth/Qwen2.5-32B-Instruct-bnb-4bit"
ADAPTER="/workspace/rtune-32b-adapter"
DEEPSEEK_KEY=os.environ.get("DEEPSEEK_KEY","")
N_Q=30

tok=AutoTokenizer.from_pretrained(MODEL)
base=AutoModelForCausalLM.from_pretrained(MODEL,device_map={"":0},torch_dtype=torch.bfloat16)
ft=PeftModel.from_pretrained(base,ADAPTER)

def gen(q):
    # GEEN systeem-prompt, gewoon een kale vraag -- test de kale getrainde gewichten.
    enc=tok.apply_chat_template([{"role":"user","content":q}],add_generation_prompt=True,return_tensors="pt",return_dict=True).to(ft.device)
    out=ft.generate(**enc,max_new_tokens=250,do_sample=False)
    return tok.decode(out[0][enc["input_ids"].shape[1]:],skip_special_tokens=True).strip()
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
first_examples=[]
for i,row in enumerate(data):
    b,t=both(row["question"])
    res["basis"][judge(row["question"],str(row["answer"]),b)]+=1
    res["getraind"][judge(row["question"],str(row["answer"]),t)]+=1
    if i<3: first_examples.append((row["question"],b,t))
    print("  test",i+1,"/",N_Q,flush=True)
print("\n===== AA-OMNISCIENCE ZONDER PROMPT (n="+str(N_Q)+") =====",flush=True)
for m in ["basis","getraind"]:
    d=res[m]; n=sum(d.values()); idx=(d["CORRECT"]-d["FOUT"])*100/n
    print(m.upper()+": correct "+str(d["CORRECT"]*100//n)+"%  hallucineert "+str(d["FOUT"]*100//n)+"%  afgezien "+str(d["AFGEZIEN"]*100//n)+"%  >> Index "+format(idx,"+.1f"),flush=True)
print("\n--- 3 voorbeelden ---",flush=True)
for q,b,t in first_examples:
    print("\nVRAAG:",q[:100],flush=True)
    print("BASIS:",b[:200],flush=True)
    print("GETRAIND:",t[:200],flush=True)
print("KLAAR_MET_ALLES",flush=True)
