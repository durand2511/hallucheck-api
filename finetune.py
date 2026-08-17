#!/usr/bin/env python3
"""
Fine-tune een OpenAI-model op de anti-hallucinatie-dataset (data/train.jsonl).
Leert het model afzien/eerlijk zijn i.p.v. verzinnen (R-Tuning).

Vereist:  pip install openai   +   export OPENAI_API_KEY=sk-...
Draai:    python finetune.py
"""
import os, sys, time
from openai import OpenAI

TRAIN = "data/train.jsonl"
BASE_MODEL = "gpt-4o-mini-2024-07-18"   # fine-tunebaar OpenAI-model
N_EPOCHS = 3                            # "meerdere training" = meerdere passes over de data

client = OpenAI()

# OpenAI vereist minimaal 10 voorbeelden — draai train.js met meer onderwerpen als je er te weinig hebt.
n = sum(1 for _ in open(TRAIN, encoding="utf-8"))
if n < 10:
    print(f"⚠️  Slechts {n} voorbeelden. OpenAI wil er ≥10. Genereer meer:  node train.js 8   (evt. meerdere keren).")
    sys.exit(1)

print(f"→ Upload {TRAIN} ({n} voorbeelden)…")
f = client.files.create(file=open(TRAIN, "rb"), purpose="fine-tune")

print(f"→ Start fine-tune op {BASE_MODEL} ({N_EPOCHS} epochs)…")
job = client.fine_tuning.jobs.create(
    training_file=f.id, model=BASE_MODEL,
    hyperparameters={"n_epochs": N_EPOCHS},
    suffix="anti-hallu",
)
print("job id:", job.id)

# wacht tot klaar
while True:
    job = client.fine_tuning.jobs.retrieve(job.id)
    print("  status:", job.status)
    if job.status in ("succeeded", "failed", "cancelled"):
        break
    time.sleep(20)

if job.status == "succeeded":
    print("\n✅ Klaar! Jouw getrainde model:", job.fine_tuned_model)
    print("Gebruik het net als elk model:  model=\"" + str(job.fine_tuned_model) + "\"")
else:
    print("\n❌ Mislukt:", job.status)
