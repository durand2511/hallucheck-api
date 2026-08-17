# Anti-hallucinatie fine-tuning — hoe je "meerdere training" draait

Doel: een model dat **afziet i.p.v. verzint** — het leert van z'n eigen (op random onderwerpen)
gedetecteerde hallucinaties, over meerdere trainingsrondes, om het gedrag af te leren (R-Tuning).

## Stap 1 — genereer trainingsdata (hier, gratis behalve DeepSeek-tokens)
```bash
node train.js 8          # 8 uiteenlopende onderwerpen → data/train.jsonl + data/lessons.json
# draai meerdere keren / met meer onderwerpen tot je ≥30-50 voorbeelden hebt (meer = beter)
```
Elke regel in `train.jsonl` is een OpenAI-fine-tune-voorbeeld: {system, user, assistant=eerlijk antwoord}.

⚠️ **Balans (belangrijk):** de standaard-prompts zijn expres "moeilijk" (lokken hallucinatie uit),
dus het model leert vooral *afzien*. Meng er ook **makkelijke** vragen bij die het model wél zeker weet
(die worden dan een zelfverzekerd, correct voorbeeld) — anders wordt het model óver-voorzichtig en zegt
het te vaak "weet ik niet". Voeg zulke prompts toe in `PROMPTS` bovenin `train.js`.

## Stap 2 — fine-tune (OpenAI)
```bash
pip install openai
export OPENAI_API_KEY=sk-...
python finetune.py       # upload + start job (n_epochs=3 = "meerdere training") + wacht op je model
```
Resultaat: een eigen model-id (`ft:gpt-4o-mini-...:anti-hallu:...`).

## Stap 3 — meet of het werkt (de eerlijke test)
Vergelijk het basismodel vs jouw fine-tuned model op NIEUWE hallucinatie-prompts (die niet in de training zaten):
```bash
# via HalluCheck's /selfcheck of /verify: draai dezelfde vraag op beide modellen,
# tel de gedetecteerde hallucinaties. Minder = het heeft geleerd.
```

## Alternatieven voor Stap 2
- **Together AI:**  `together fine-tuning create --training-file data/train.jsonl --model <open-model> --n-epochs 3`
- **Fireworks:** upload dezelfde JSONL via hun fine-tune-API.

## Eerlijke kanttekeningen
- Fine-tunen op **eigen** output kan fouten versterken ("model collapse") als de detectie mist. Daarom detecteren we
  met zelf-consistentie + je kunt de dataset met de hand nakijken (`data/lessons.json` toont wat verwijderd is).
- Dit vermindert hallucinaties, maar maakt ze niet nul — meet altijd op een aparte testset (Stap 3).
- Meer/diversere data en meerdere rondes (genereer → fine-tune → genereer met het betere model → opnieuw) werken het best.
