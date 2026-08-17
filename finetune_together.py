#!/usr/bin/env python3
"""
Fine-tune een OPEN model (Llama) op de anti-hallucinatie-dataset via Together AI.
Vervanger voor OpenAI (dat z'n fine-tuning heeft stopgezet). Zelfde dataset (data/train.jsonl).

Vereist:  pip install together   +   export TOGETHER_API_KEY=...
Draai:    python finetune_together.py
"""
import os, sys, time
from together import Together

TRAIN = "data/train.jsonl"
BASE_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct-Reference"  # fine-tunebaar open model
N_EPOCHS = 3

client = Together()  # leest TOGETHER_API_KEY

n = sum(1 for _ in open(TRAIN, encoding="utf-8"))
print(f"→ Upload {TRAIN} ({n} voorbeelden)…")
up = client.files.upload(file=TRAIN)
file_id = getattr(up, "id", None) or up["id"]

print(f"→ Start fine-tune op {BASE_MODEL} ({N_EPOCHS} epochs)…")
ft = client.fine_tuning.create(
    training_file=file_id,
    model=BASE_MODEL,
    n_epochs=N_EPOCHS,
    suffix="anti-hallu",
)
job_id = getattr(ft, "id", None) or ft["id"]
print("job id:", job_id)

while True:
    job = client.fine_tuning.retrieve(job_id)
    status = getattr(job, "status", None)
    print("  status:", status)
    if str(status).lower() in ("completed", "succeeded", "failed", "cancelled", "error"):
        break
    time.sleep(30)

model = getattr(job, "output_name", None) or getattr(job, "fine_tuned_model", None)
print("\n✅ Klaar! Jouw getrainde model:", model)
print("Gebruik het via Together (of deploy het) — zelfde JSONL-formaat werkte.")
