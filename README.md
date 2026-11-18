# Parcela

Predajná stránka služby pre kempy, glampingy a chatové osady: mapa areálu s online rezerváciou parcely na webe kempu, bez provízie z rezervácií. Pracovný názov je „Parcela“.

Živý web: https://matuslenicky.github.io/parcela/

## Čo je na stránke

- interaktívna ukážka na **vymyslenom** kempe: výber vozidla, voľné, obsadené a nevyhovujúce parcely, plán parcely v mierke a výpočet ceny pobytu (rezervácia sa nikam neodosiela),
- kalkulačka, koľko kemp platí portálom (Booking, Pitchup) a koľko ušetrí,
- čo kemp dostane, priebeh spolupráce, cenník, časté otázky a kontaktný formulár (otvorí e-mail návštevníka s vyplnenou správou).

Stránka je jeden súbor `index.html` bez buildu. Písmo Overpass sa načítava z Google Fonts, ostatné je v súbore. Kým nie sú doplnené skutočné kontakty, má stránka `noindex`.

## Overenie

```
node ~/.claude/skills/web-audit/scripts/audit.js index.html <výstup>
```
