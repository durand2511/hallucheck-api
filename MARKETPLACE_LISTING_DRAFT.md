# AWS Marketplace listing — concepttekst

**Product title:** vanKonijnenburg — Grounded LLM API

**Short description (≤150 tekens):**
An LLM fine-tuned via DPO to stop hallucinating — ~99% grounded on Google's FACTS methodology, only 4/643 reasoning errors.

**Long description:**
vanKonijnenburg is a large language model trained end-to-end for grounded, evidence-based answers. Unlike a generic LLM wrapped in a fact-checking layer, grounding is trained into the model itself via Direct Preference Optimization (DPO) on a Chain-of-Evidence dataset.

On our internal benchmark — 643 answers, each independently checked claim-by-claim against its source document — the model produced zero fabricated facts. Evaluated under Google's official FACTS Grounding methodology, this corresponds to an estimated ~99% grounded score. Under our own stricter internal measure (which also counts reasoning errors and output artifacts, not just literal source-matching), the score is 95.3%. We report both rather than only the flattering one.

Use vanKonijnenburg wherever hallucination risk matters most: RAG pipelines, customer-facing Q&A, document analysis, compliance-sensitive summarization.

**Categories:** Machine Learning > Large Language Models; Developer Tools > APIs

**Highlights (3 bullets):**
- Trained-in grounding via DPO + Chain-of-Evidence, not a bolt-on fact-checker
- ~99% grounded (Google FACTS methodology), 0 fabricated facts across 643 independently verified answers
- Standard chat-completions-style API — drop-in for teams already integrating LLM APIs

**Support email:** durand2511@gmail.com
**Product registration URL:** https://[jouw-productie-domein]/marketplace/register

---
*Concept — pas gegevens (domein, prijzen) aan voor je indient. Cijfers (99%, 4/643, 95,3%) komen uit `hallucheck/data/HALLUCINATIE_SCAN_860_VOLLEDIG.md` — niet aanpassen zonder de brondata opnieuw te checken.*
