# AWS Marketplace — voorbereiding vanKonijnenburg

## Wat al klaarstaat (code, geen actie nodig)

- `lib/marketplace.js` — AWS Marketplace Metering-integratie (`resolveCustomer` + `reportUsage`), inactief totdat `MARKETPLACE_PRODUCT_CODE` is ingesteld. Draait naast de bestaande Stripe-facturering, geen van beide breekt als de ander niet geconfigureerd is.
- `lib/auth.js` — rapporteert usage aan Marketplace automatisch zodra een klant een `marketplace_customer_id` heeft.
- `server.js` — `POST /marketplace/register` (de verplichte "product registration URL"): vangt het eenmalige AWS-token op, koppelt het aan een klant-e-mail, geeft een API-key uit.
- `lib/migrate.sql` — DB-kolom `marketplace_customer_id` toegevoegd.

## Wat jij persoonlijk moet doen (kan ik niet voor je doen)

AWS vereist voor dit soort stappen expliciet een eigen, apart "seller of record"-account plus juridische/financiële gegevens — dat kan alleen door jou.

1. **Nieuw, apart AWS-account aanmaken** als "Marketplace seller of record" (aparte van het account waar de productie-infra in draait — AWS raadt dit expliciet aan).
2. **Registreren als seller**: https://aws.amazon.com/marketplace/management/ → "Register now". Bedrijfsnaam (juridische naam), akkoord met de Seller Agreement.
3. **Bank- en belastinggegevens** invullen (voor uitbetaling).
4. **Bedrijfslogo** aanleveren: 300×150px, PNG, transparante achtergrond.
5. **EULA laten reviewen/tekenen** — concept staat klaar in `MARKETPLACE_EULA_DRAFT.md` in deze map. **Dit is geen juridisch advies** — laat 'm even langs een jurist gaan voor je 'm indient, vooral de aansprakelijkheids- en garantie-clausules.
6. **Product aanmaken** in de Management Portal: prijsmodel kiezen (voorstel: "SaaS subscription" of "contract with consumption", usage-based), listing-tekst plakken (concept in `MARKETPLACE_LISTING_DRAFT.md`).
7. Zodra je een **Product Code** hebt: geef die aan mij door, dan zet ik 'm als `MARKETPLACE_PRODUCT_CODE` env var op de service — de metering-code is dan al actief.

## Volgorde

Stap 1-4 kun je nu al doen (kost geen technische kennis, alleen bedrijfsgegevens). Stap 5-6 pas zodra de API zelf volledig werkt (SageMaker-endpoint moet eerst live zijn) — geen zin om een product te registreren dat nog niet werkt.
