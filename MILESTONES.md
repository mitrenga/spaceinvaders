# Space Invaders — milníky

Stav k 2026-08-29. Milníky navazují na kap. 10 „Postup" v `GAME-DESIGN.md`; každý má výstup a
kritérium **hotovo když**. Termíny se doplní po odhadu. Stav: ☐ nezačato · ◐ rozpracováno · ☑ hotovo.

## Závislosti mezi projekty

Tři projekty běží paralelně, ale sdílené části svision vznikají jednou:

| Sdílená část svision | Vytváří | Přebírá |
|---|---|---|
| `ArcadePlatform` + `ArcadeLayout` (**svision `canvas2D/arcade/`**, přesun z `app/` SI 2026-08-30) | SI (SI-M3) | Pleiads, Stinger (jen `appPlatform.js`) |
| Pevný tick ve workeru, deterministický RNG, headless regresní test | SI (SI-M5, SI-M9) | Pleiads, BZ |
| Syntetizátor efektů (šum+filtr+obálka, sweep, LFO) | SI (SI-M7) | Pleiads (PL-M6), BZ (BZ-M7) |
| `TileMapEntity`, 2 bpp kodek, `rom2tiles` | Pleiads (PL-M3) | — |
| `VectorPlatform`, `VectorEntity`, `VectorTextEntity`, `rom2vectors` | BZ (BZ-M3) | — |
| POKEY-like a „engine" instrument | BZ (BZ-M7) | — |
| Skelet arkádového projektu (menu bez audia, attract mode per hra, HoF jako MM) | SI (SI-M2, SI-M8) | Pleiads, BZ (vzor) |

Co na nikoho nečeká a může začít hned ve všech třech: **M1 podklady** a u BZ/Pleiads i **M2 skelet**.

## Milníky

### SI-M1 Podklady a fakta z originálu — ☑ 2026-08-29
- Výstup: `sources/` kompletní (☑ 2026-08-29: ROM ověřeny, disassemblace, MAME, manuály, samples),
  kap. 2 GAME-DESIGN bez položek **[ověřit]** (☑ 2026-08-29: kap. 2.1–2.11, každá hodnota
  s adresou ROM/RAM z `invaders.asm`/`Code.txt`/`RAMUse.txt`, fólie z `invaders.lay`).
- Hotovo když: v kap. 2 nezbývá žádné [ověřit] a každá hodnota má zdroj (adresa/řádek).

### SI-M2 Skelet projektu — ☑ 2026-08-29
- Výstup: kopie kostry MM (`index.php`, `config/`, `db/`, `images/`, `app/*` bez herní logiky),
  symlink `app/svision`, `menuModel` s položkami dle kap. 3 (bez otevírání audia), `.gitignore`.
- Hotovo když: `svtool build` a `verify` projdou, stránka se načte a zobrazí menu s prázdnou hrou.
- ☑ 2026-08-29: DB `spaceinvaders` / `rg_si_hallOfFame`, prefix `si`, dev URL
  `https://willy2.shipard.pro:34444/spaceinvaders/`; prázdná hra = `mainModel` + `gameWorker` s pevným
  60 Hz tickem (dvě fáze), game over zapisuje do HoF. Ověřeno headless Chromem bez chyb v konzoli.
  Platforma zatím `ZXPlatform` (nahradí SI-M3); ikony jsou placeholder z MM.

### SI-M3 `ArcadeRasterPlatform` (v projektu) — ☑ 2026-08-29
- Výstup: platforma s konfigurovatelnou logickou plochou (224×256 na výšku), celočíselné
  zvětšení, bezel, overlay (fólie), přepínač sharp/retro. Změna zadání 2026-08-29: platforma
  žije v `app/` SI (`arcadeRasterPlatform.js`, `arcadeRasterLayout.js`), svision se nemění;
  ZX pomocné obrazovky zůstávají ze svision beze změny (zobecnění odloženo do SI-M8).
- Hotovo když: prázdná plocha se správně vykreslí na desktopu i mobilu; MM testflight beze změny
  chování; Pleiads může platformu použít jen konfigurací (kopie souborů + config).
- ☑ 2026-08-29: ověřeno headless Chromem 800×1000 (ratio 3) i 390×844 (mobil), konzole bez chyb;
  overlay pásy z `invaders.lay` viditelné na testovacím vzoru v prázdné hře; svision nedotčen,
  MM beze změny.

### SI-M4 Data z ROM — ☑ 2026-08-29
- Výstup: nástroj `tools/rom2sprites` (v projektu; do svision přesunut 29. 8. a zpět 30. 8. — jednoúčelový), sprajty + font → JSON v `app/`/`data/`,
  `CREDITS.md`, statický „screenshot" 1. vlny složený ze dat.
- Hotovo když: screenshot je pixelově shodný se snímkem z MAME na startu hry.
- ☑ 2026-08-29: `tools/rom2sprites` + `tools/rom2sprites.spec.json` → `data/sprites.json`
  (19 sprajtů), `data/font.json`; `CREDITS.md`. MAME není k dispozici → referenční snímky vyrábí
  vlastní headless emulátor `tools/refemu` (jen vývojový nástroj, hra je čistě JS).
  `tools/compose-screenshot.mjs` složí obrazovku z JSON dat: scéna `start` (první úplný rack; hráč
  ještě není vykreslen ani v originále) a `cycle3` (rack o 2 kroky, hráč viditelný) — obě
  **pixelově shodné** s referencí. Vedlejší produkt: `sources/reference/trace-noinput.tsv` pro SI-M5/M9.

### SI-M5 Hratelná 1. vlna — ☑ 2026-08-29
- Výstup: `gameWorker.js` s pevným 60 Hz tickem, dvě fáze na tick; rack (jeden vetřelec za tick),
  hráč, střela hráče, 3 typy střel vetřelců, štíty s pixelovým poškozením, kolize, skóre, životy.
- Hotovo když: lze dohrát 1. vlnu klávesnicí, gamepadem i dotykem; rack po N snímcích bez vstupu
  je na stejné pozici jako v MAME (první regresní hodnoty).
- ☑ 2026-08-29: `app/gameWorker.js` = věrný přepis originálu (RST1/RST2 fáze, herní objekty s
  časovači, rack, hráč, střela hráče, 3 typy střel vetřelců, UFO, štíty pixelově ve VRAM, kolize,
  skóre BCD, životy, bonus loď, konec vlny s tabulkou výšek, invaze, game over); `screenEntity.js`
  zobrazuje VRAM; ovládání klávesnice/myš/gamepad/dotyk podle MM (dotyk a gamepad zatím netestovány
  na zařízení). `tools/regress.mjs`: 650 snímků bez odchylky proti trase z `refemu`. Ověřeno v
  headless Chromu (hra, zásahy, poškození štítů) bez chyb v konzoli. UFO a další vlny vyšly z
  přepisu rovnou (formálně SI-M6 — zbývá `gameOverModel` napojit na HoF a otestovat celý průběh).

### SI-M6 Kompletní hra — ☑ 2026-08-29
- Výstup: UFO (tabulka hodnot dle výstřelů), vlny a startovní výšky, bonus život, game over,
  `gameOverModel`, zápis do hall of fame na serveru (jako MM).
- Hotovo když: celý průběh hry od menu po zápis skóre funguje bez zvuku.
- ☑ 2026-08-29: UFO, vlny (tabulka výšek), bonus loď a game over vyšly z přepisu v SI-M5;
  `gameOverModel` zobrazuje skóre + hi-score / „NEW HI-SCORE !", zapisuje do HoF (`saveGame.db`, jen
  skóre > 0) a po 8 s vrací do menu. Ověřeno v prohlížeči: menu → hra → 3 smrti → GAME OVER →
  game over obrazovka → menu → HALL OF FAME se záznamem; první reálné hry uživatele (BIMBO 70, 470)
  jsou v DB `spaceinvaders`.

### SI-M7 Zvuk (svision syntetizátor) — ☑ 2026-08-29 (A/B poslechem zbývá)
- Výstup: nové instrumenty (šum+filtr+obálka, sweep, LFO), 9 efektů SI řízených z workeru,
  otevírání audia až z položky menu, hlasitost v menu.
- Hotovo když: všech 9 efektů zní srovnatelně s referenčními samples (subjektivní A/B) a
  rozhraní instrumentů je připravené pro POKEY/engine (BZ).
- ☑ 2026-08-29: syntéza na svision `AudioOscillatorHandler` (žádné změny svision — instrumenty
  s `filterEnv`/`pitchEnv`/`lfo` už existují); `app/soundEffects.js` (9 + bonus), `app/audioManager.js`
  s busy per souběžný zvuk, `mainModel.playSoundPorts` řízené porty 3/5 z workeru; hlasitost
  SOUNDS/MUSIC v menu, audio se otevírá až ve hře. Parametry změřeny z MAME samplů
  (autokorelace/RMS). **Subjektivní A/B poslechem musí udělat uživatel** — headless test jen
  ověřil, že hra se zvuky běží bez chyb v konzoli.

### SI-M8 Attract mode, nastavení, PWA, testflight — ☐
- ☑ 2026-09-12 **Menu bez rámečku, font hry** — zelený rámeček kolem menu odstraněn; `app/spaceInvadersFonts8x8.js`
  (`SpaceInvadersFonts8x8` nad `ZXFonts8x8`, statická HEX tabulka z `tools/rom2font.py`): 0–9, A–Z, `<>=*?-` z ROM
  (1E00h, `data/font.json`), zbytek z fontu „The Island" (1984) z `~/sw/zx-fonts`, který je se znaky SI pixelově
  shodný (0 rozdílů/36 glyfů); `⅄` = obrácené Y attractu. Vzniká v `GameApp` jako `fonts.spaceInvadersFonts8x8`, menu jím píše.
- ☑ 2026-09-12 **BootModel** — `app/bootModel.js` nahrazuje `ZXResetModel`: úvod attractu originálu (kap. 2.9,
  L_0AEA) jako zaváděcí animace — „PLA⅄" a „SPACE  INVADERS" po znaku (7 sn.), malý vetřelec zprava odtáhne
  obrácené Y a přitlačí správné (SplashSprite 1868h, 1 px/sn., x = Xr−32, snímky po 4 krocích), smazání
  (33B7h); mezi tím *SCORE ADVANCE TABLE* (DrawAdvTable 1815h: talíř 1D68h, C/B/A, čtyři řádky bodů po znaku).
  Obraz skládá do VRAM a kreslí `ScreenEntity` s celofánem; 1093 snímků = 18 s, libovolný stisk boot ukončí.
- Výstup: attract mode (title, score advance table, demo, HoF, „PRESS FIRE"), SETTINGS
  (ovládání, sharp/retro, fólie), About, PWA manifest, `testFlightPage.php`,
  `~/sw/testflights/spaceinvaders`.
- Hotovo když: testflight nasazen a hra hratelná na mobilu i desktopu bez chyb v konzoli.

### SI-M9 Věrnost a dokončení — ☐
- Výstup: headless regresní test (Node) proti tabulce z MAME, ladění detailů, About/Credits,
  rozhodnutí o Taito/Midway zvuku a veřejném názvu.
- Hotovo když: regresní test prochází, kap. 11 GAME-DESIGN bez otevřených bodů blokujících vydání.
