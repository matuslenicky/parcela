# Parcela

Predajná stránka služby pre kempy, glampingy a chatové osady: mapa areálu s online rezerváciou parcely na webe kempu, bez provízie z rezervácií. Pracovný názov je „Parcela“.

Živý web: https://matuslenicky.github.io/parcela/

## Čo je na stránke

- interaktívna ukážka na **vymyslenom** kempe: výber vozidla, voľné, obsadené a nevyhovujúce parcely, plán parcely v mierke a výpočet ceny pobytu (rezervácia sa nikam neodosiela),
- kalkulačka, koľko kemp platí portálom (Booking, Pitchup) a koľko ušetrí,
- čo kemp dostane, priebeh spolupráce, cenník, časté otázky a kontaktný formulár (otvorí e-mail návštevníka s vyplnenou správou).

Stránka je jeden súbor `index.html` bez buildu. Používa systémové písmo (San Francisco na Apple, Segoe UI na Windows, Roboto na Androide), všetko je v súbore. Kým nie sú doplnené skutočné kontakty, má stránka `noindex`.

## Overenie

```
node ~/.claude/skills/web-audit/scripts/audit.js index.html <výstup>
```

## 3D mapy a ukážky pre kempy (`kempy/`)

- `kempy/build_camp.py` postaví v Blenderi 3D kemp z `kempy/<kemp>/camp.json` a vyrenderuje ho:
  `blender -b --factory-startup -P kempy/build_camp.py -- kempy/<kemp>`
- `kempy/build-demo.js <kemp>` z tých istých dát vyrobí ukážku rezervácie pre konkrétny kemp (`kempy/<kemp>/index.html`) zo šablóny `kempy/demo-template.html`.
- Údaje a plány konkrétnych kempov (`kempy/*/`) sa do repozitára nedávajú.
- `assets/kemp-3d.jpg` je render vymysleného ukážkového kempu z webu.
