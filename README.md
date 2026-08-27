# HalluCheck

Een API die controleert of een taalmodel zijn antwoord daadwerkelijk kan onderbouwen.
Niet door te vragen "klopt dit?", maar door per bewering te kijken of er bewijs voor is.

Getrouwe herimplementatie van een gepubliceerde methode (Chain-of-Evidence,
[arXiv 2605.26340](https://arxiv.org/abs/2605.26340)).

## Hoe het werkt

Een antwoord wordt uiteengelegd in losse beweringen. Elke bewering krijgt een type —
feitelijk, numeriek, een citaat, een verwijzing naar literatuur — omdat je ze niet
allemaal op dezelfde manier controleert.

Verwijzingen worden nagetrokken bij **Crossref**: bestaat het artikel, kloppen de auteurs
en het jaartal. Feitelijke beweringen gaan door een entailment-stap tegen de meegeleverde
bron: volgt dit er werkelijk uit, of staat het er alleen naast.

Wat overblijft is per zin een oordeel: onderbouwd, niet onderbouwd, of niet te vinden in
de bron.

## Model

Naast de pijplijn zit hier het werk aan een eigen klein model: eerst imitatie (SFT) om het
format en de vaardigheid aan te leren, daarna voorkeursoptimalisatie (DPO) om het gedrag
bij te sturen. DPO alleen bleek niet te werken — een klein model leert daar geen nieuw
format van, alleen een voorkeur binnen wat het al kan.

De adapter is samengevoegd met de basisgewichten in plaats van er tijdens het draaien
overheen gelegd, zodat het geheel via llama.cpp lokaal draait.

## Meten

Bij elke evaluatie draait de rauwe modelbaseline ernaast. Zonder die vergelijking weet je
niet of je het model beter hebt gemaakt of alleen stabieler in zijn antwoordvorm — dat
zijn twee verschillende dingen en ze worden apart gerapporteerd.

Getest op HaluEval. Alle bekende faalgevallen uit de eerste ronde zijn opgelost, met de
volledige regressieset er telkens naast om te zien of een fix er elders een introduceert.

Eén detail dat het vermelden waard is: een methode die in de bronliteratuur werd genoemd
bleek bij natrekken niet te bestaan. Dat is als zodanig gerapporteerd in plaats van
overgenomen — precies het soort fout dat dit project moet vangen.

## Draaien

```bash
node server.js          # http://localhost:8091
```

Sleutels komen uit de omgeving; zie `.env.example`. Er staat geen enkele sleutel in deze
repository.
