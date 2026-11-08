# Space Invaders — zadání remaku

Stav k 2026-08-29. Pracovní zadání; body **[?]** jsou otevřené, body **[ověřit]**
byly potvrzeny z disassemblace / MAME (kap. 2, SI-M1 hotov 2026-08-29).
Společná pravidla pro všechny tři arkádové remaky (dříve `ARCADE-PLATFORMS.md`, zrušen) jsou do tohoto
dokumentu **zapracována** a přizpůsobena SI; sesterské projekty: `~/sw/pleiades/GAME-DESIGN.md`,
`~/sw/battlezone/GAME-DESIGN.md`. Tři hry vznikají **současně**. Milníky a závislosti: `MILESTONES.md`.

## 0. Společný rámec a role SI

> **Změna 2026-08-30:** `ArcadeRasterPlatform`/`ArcadeRasterLayout` byly přesunuty z `app/` do svision jako
> **`svision/js/platform/canvas2D/arcade/arcadePlatform.js` + `arcadeLayout.js`** (třídy `ArcadePlatform`,
> `ArcadeLayout`), sdílené SI, Pleiades i Stingerem; projekt drží jen konfiguraci v `app/appPlatform.js`.
> Platforma **neplní** `app.stack.ButtonEntity` (hover/klik barvy) — společný mechanismus pro ZX i arcade
> (`config.buttonColors`) se navrhne později. Zmínky „v `app/`, ne ve svision" níže jsou historické.

- **Věrný remake, ne emulátor.** Logika se přepisuje do JavaScriptu; zachovává se původní
  celočíselná aritmetika, tabulky, pořadí výpočtů a časování po snímcích. Referencí je
  ROM set v MAME s továrním nastavením DIP.
- **SI je pilot.** Pořadí náběhu je Space Invaders → Pleiads → Battlezone; na SI se odladí
  `ArcadeRasterPlatform`, pevný 60 Hz tick ve workeru a syntéza analogových zvuků, které
  převezmou Pleiads (platforma, tick, zvuk) a Battlezone (tick, zvuk). Rozhodnutí učiněná
  zde jsou závazná pro další dvě hry. **Platforma se nedělá ve svision, ale přímo v `app/`
  projektu SI** (rozhodnuto 2026-08-29: `arcadeRasterPlatform.js`, `arcadeRasterLayout.js`);
  Pleiads ji převezme kopií (příp. se později přesune do svision, až se ustálí). Do svision
  patří jen věci, které jsou v něm už teď (canvas2D základ, entity, audio).
- Vzor kódu: MM/JSW (`gameApp.js`, `menuModel.js`, `mainModel.js`, `gameWorker.js`,
  `hallOfFameEntity.js`, `aboutEntity.js`, `audioManager.js`). Herní fyzika žije ve
  **workeru** s pevným tickem, UI vrstva v modelu/entitách.
- Kostra stejná jako MM/JSW: `index.php` + `app/` + `config/` + `db/`, symlink
  `app/svision`, `svtool build/verify`, PWA, hall of fame.
- Rozdíly proti MM/JSW: nová platforma místo `ZXPlatform`; obraz **na výšku**;
  barvy z fólie místo ZX atributů; vlastní arkádový font 8×8 z ROM; místo tape-loading
  menu **attract mode** jako v automatu; vstup navíc mapovaný na arkádové ovladače;
  **žádné save game**, jen hall of fame.

## 1. Referenční verze

- **Taito Space Invaders (1978)**, ROM set `invaders` v MAME (Midway verze pro USA
  je hardwarově shodná, liší se zvukovou deskou — pracovně **Taito**). Rozhodne se až
  po nasimulování zvuků obou desek (2026-08-29). [?]
- Zdroj logiky: **Computer Archeology – Space Invaders**, komentovaná disassemblace
  `invaders.asm` (Intel 8080), sestavitelná do binárně shodné ROM.
- Zdroj hardwaru: MAME driver `mw8080bw` / `8080bw`, schémata desky, zvuk
  SN76477 + diskrétní obvody.
- DIP přepínače = tovární: 3 životy, bonus život při 1500 bodech, coin info zapnuto.

## 2. Fakta z originálu (ověřeno 2026-08-29)

Zdroje: `sources/asm/invaders.asm` a `sources/asm/Code.txt` (Computer Archeology, adresy ROM
0000–1FFF), `sources/asm/RAMUse.txt` (mapa RAM 2000–23FF), `sources/mame/mw8080bw.{h,cpp}`,
`sources/mame/invaders.lay`. Adresy v hranatých závorkách jsou adresy ROM; `ram.xxxx` jsou
symbolická jména z RAMUse. Souřadnice jsou **hardwarové**: `Yr` = řádek VRAM (0 = dole na
obrazovce hráče, roste nahoru), `Xr` = sloupec (0 = vlevo).

### 2.1 Hardware a časování
- CPU Intel 8080, takt 19,968 MHz / 10 = **1,9968 MHz**; pixel clock 4,992 MHz, 320×262 rastr,
  snímková frekvence 4992000/320/262 = **59,54 Hz** (`mw8080bw.h` MASTER_CLOCK, HTOTAL 0x140,
  VTOTAL 0x106, MW8080BW_60HZ). Remake používá tick 60 Hz (rozdíl 0,8 % zanedbán).
- Dvě přerušení na snímek: **RST 1 (vektor 0xCF, adresa 0008) na řádku 96** („uprostřed") a
  **RST 2 (vektor 0xD7, adresa 0010) na řádku 224** (začátek VBLANK) — `Hardware.txt`
  „Interrupts", `mw8080bw.cpp` `interrupt_trigger`/`vpos_to_vysnc_chain_counter`, čítače
  0x80 a 0xDA. Objekty se zpracují jen v tom přerušení, při němž paprsek není nad nimi
  (`CompYToBeam` [1A06], `ram.vblankStatus` 2072). Hlavní smyčka [081F–0851] běží volně
  mezi přerušeními (skóre, výpočty), pohyb všech herních objektů je v ISR → **jeden krok
  objektu = jeden snímek**.
- Obecný čítač zpoždění `ram.isrDelay` 20C0 se dekrementuje jednou za snímek [001C];
  `OneSecDelay` = 64 snímků, `TwoSecDelay` = 128 snímků [0AD7/0ADB, řádky 1225–1231].

### 2.2 Obraz a fólie
- VRAM 2400–3FFF, 7168 B, 1 bpp; rastr 256×224, monitor otočen o 90° proti směru hodin →
  hráč vidí **224 (š) × 256 (v)**; první bajt VRAM = levý dolní roh (`Hardware.txt` „Video",
  „Memory Map").
- MAME zobrazuje 260 sloupců rastru (HBSTART 0x100 + 4 pixely, `mw8080bw.h` HPIXCOUNT), tj.
  224×260 po otočení; 4 řádky navíc jsou prázdné.
- **Fólie** (`invaders.lay`, souřadnice v ploše 224×260, y = 0 nahoře, násobení barvou):
  - červená (1, 0.125, 0.125): y 32–62, celá šířka (pás UFO);
  - zelená (0.125, 1, 0.125): y 184–240, celá šířka (štíty + hráč);
  - zelená: x 16–134, y 240–260 (rezervní lodě vlevo dole);
  - zbytek bílý. Přepočet na řádky VRAM se potvrdí pixelovým srovnáním v SI-M4.

### 2.3 Herní pole a startovní pozice (RAM mirror [1B00–1BFF], `CopyRAMMirror` [01E4])
- **Převod souřadnic na obrazovku hráče (224×256, y = 0 nahoře)** — ověřeno pixelově v SI-M4:
  `x = Xr − 32` (VRAM 2400 = rastrový řádek 32), horní řádek sprajtu výšky h: `y = 255 − Yr − (h − 1)`
  (bit 0 nejnižšího bajtu sloupce = Yr = spodní pixel). Adresa VRAM A (nejnižší bajt sloupce):
  `x = (A − 0x2400) >> 5`, `y = 255 − ((A & 31)·8 + h − 1)`. Sprajty v ROM jsou **sloupcové**:
  1 bajt = 8 pixelů svisle (bit 0 dole), sloupce zleva; štít 2 bajty na sloupec.
- Stavový řádek (`DrawStatus` [1925]): " SCORE<1> HI-SCORE SCORE<2> " na 241E (x 0, y 8); skóre P1
  na 271C (x 24, y 24), hi-score 2F1C (x 88), P2 391C (x 168, v 1P hře nekresleno); "CREDIT " 3501
  (x 136, y 240), počet kreditů 3C01 (x 192); počet lodí 2501 (x 8, y 240), rezervní lodě od 2701
  (x 24, +16 px), čára `DrawBottomLine` [01CF] na y 239 přes celou šířku.
- Hráč se objeví až po odpočtu tasku (`obj0Timer` 2010/2011 = 0x4A00 na začátku, ≈ 74 snímků po
  vykreslení racku; poprvé viditelný v herním snímku ~325), rack se kreslí od snímku ~197 (po
  „PLAY PLAYER<1>"), plný poprvé ve snímku 251 (`sources/reference/trace-noinput.tsv`).
- Referenční vetřelec (levý dolní): Yr = **0x78**, Xr = **0x38** (`ram.refAlienYr/Xr` 2009/200A,
  mirror [1B09–1B0A]); rozteč racku **16 px** v obou osách (`GetAlienCoords` [017A]:
  +0x10 za řádek/sloupec); 5 řad × 11 = 55 (`InitAliens` [01C0], 0x37).
- Hráč: Yr = **0x20**, start Xr = **0x30** (`ram.playerYr/Xr` 201A/201B, mirror [1B1A–1B1B]),
  sprajt 16 B [1C60]; rozsah pohybu Xr **0x30–0xD9** [0382, 038F].
- Štíty: 4, vzor 44 B [1D20], vykresleny `DrawShieldPl1` [01EF] / `RestoreShields1` [021A] — pozice:
  první štít na Yr 0x30, „mezi štíty 23 řádků" [řádek 408 asm]; ovládá se kopií bufferu
  2142–21FF ↔ VRAM (`ram.tmp2081`).
- Spodní čára hřiště `DrawBottomLine` [01CF], hranice pro rack: pravý okraj sloupec VRAM
  3EA4, levý 2524 (`RackBump` [1597], test přes celý sloupec).

### 2.4 Rack vetřelců
- Bodování 10 / 20 / 30 podle indexu řady: řady 0–1 → 10, 2–3 → 20, 4 → 30
  (`AlienScoreValue` [097C], tabulka `AlienScores` [1DA0] = 10 20 30 BCD).
- Pohyb: `CursorNextAlien` [0141] v RST 1 posune kurzor na dalšího živého vetřelce; když
  projde všech 55 (index 0x37), zavolá `MoveRefAlien` [01A1] → referenční vetřelec se posune
  o `refAlienDXr` a přepne animační fázi (2005, 0/1). Kreslení jednoho vetřelce na snímek
  provádí RST 2 (`DrawAlien` [0100], synchronizace 2000 `waitOnDraw`). **Tedy: jeden vetřelec
  za snímek; celý rack se posune jednou za N snímků, N = počet živých.**
- ΔX: **+2** vpravo / **−2** vlevo (`ram.refAlienDXr` 2008, init [00D7] = 2, `RackBump`
  B=0xFE); **jediný zbylý vetřelec vpravo +3** (`RackBump` [15B7–15C4], `InitRack` [00B1–00C8]).
- Při dotyku okraje: otočení směru + `refAlienDYr` = `rackDownDelta` 200E = **0xF8 = −8 Yr**
  (= 8 px dolů) [15A9–15B6, mirror 1B0E].
- **Startovní výška racku** podle kola (`AlienStartTable` [1DA3]): 1. kolo 0x78 [07EA],
  pak 0x60, 0x50, 0x48, 0x48, 0x48, 0x40, 0x40, 0x40 (2.–9. kolo), 10. kolo znovu od 0x60
  (komentář u 1DA3; čítač `p1RackCnt` 21FE).
- **Invaze**: když se kurzor dostane na vetřelce s Yr < **0x28**, hráč zemře a hra končí
  (`CursorNextAlien` [0166] `CPI 0x28` → [1971] `ram.invaded` 206D).
- Vetřelec exploduje 16 snímků (`ram.expAlienTimer` 2003 = 0x10 [1723]).

### 2.5 Hráč a jeho střela
- Pohyb **1 px za snímek** (handler [028E→0363–0398]: INC/DEC `playerXr` jednou za tick),
  start hráčova tasku 128 snímků po startu (2011 = 0x80, mirror [1B11]).
- Jedna střela současně (`ram.plyrShotStatus` 2025 = 0 volná; 1 start, 2 letí, 3 minula,
  5 exploze vetřelce, 4 hotovo). Start Xr = `playerXr` + 8 [03FC–0401], Yr = 0x28 [1B29];
  rychlost **+4 Yr za snímek** (`ram.shotDeltaX` 202C = 4 [1B2C, 0416]).
- Střela končí „minutím" při Yr ≥ **0xD8** (`PlayerShotHit` [14D8–14E4]), exploze 16 snímků
  (2026 = 0x10 [1B26]), sprajt exploze [1C91].
- Fire má debounce (`ram.fireBounce` 202D [1634–1651]) — držení tlačítka nestřílí opakovaně.
- Smrt hráče: 2 sprajty [1C70/1C80] střídané po 5 snímcích, 12 změn (2016 = 5, 2017 = 0x0C,
  mirror [1B16–1B17], `DrawPlayerDie` [039B]).

### 2.6 Střely vetřelců
- Tři objekty = **max. 3 střely současně**: rolling (obj 2 [0476], míří na hráče, `rolShotTrack`
  2037 = 0), plunger (obj 3 [04B6], sloupcová tabulka, **vynechán je-li 1 vetřelec**
  [04B6–04BB]), squiggly (obj 4 [0682], sdílí task s UFO — UFO čeká, až squiggly skončí).
- Synchronizace: `ram.shotSync` 2080 = časovač obj 2 (2032, cyklus 0,1,2) → každý snímek běží
  jen jedna z nich [řádky 623–633 asm].
- Kdo smí vystřelit: `HandleAlienShot` [0563] — nová střela jen když nejmenší počet kroků
  ostatních aktivních střel (`aShotStepCnt` 2074) ≥ `aShotReloadRate` 20CF.
- **Reload podle skóre**, ne podle výšky racku: `AShotReloadRate` [170E], tabulky
  `AReloadScoreTab` [1CB8] = 02 10 20 30 (MSB BCD skóre, tj. ≤ 200, ≤ 1000, ≤ 2000, ≤ 3000)
  → `ShotReloadRate` [1AA1] = 0x30, 0x10, 0x0B, 0x08, jinak **0x07**.
- Rychlost střely: `ram.alienShotDelta` 207E = **0xFC = −4 Yr/krok** (mirror [1B7E]);
  při **≤ 8 vetřelcích 0xFB = −5** (`SpeedShots` [08D8]). (Komentáře v asm u 08D8 a RAMUse
  si odporují; platí hodnoty v mirroru a kódu.)
- Exploze střely: `aShotBlowCnt` 2078 začíná na 3 [061B], sprajt [1CDC]; střela mizí pod
  Yr 0x15 / nad úrovní hráče zpracuje kolize [05E9–0612].
- Střelba vetřelců je po startu kola potlačena časovačem 206A [03B3].

### 2.7 UFO (mystery ship)
- Časovač `tillSaucer` 2091/2092 = **0x600 = 1536 průchodů hlavní smyčky** (ne snímků!),
  dekrementuje `TimeToSaucer` [0913–092D] jen když `refAlienYr` < 0x78 (tj. ne během první
  pozice 1. kola) → ≈ 25 s podle rychlosti smyčky; při 0 se nastaví `saucerStart` 2083 a
  časovač znovu na 0x600.
- Podmínky spuštění [0682–06A6]: `shotSync` == 2, žádná squiggly střela, **`numAliens` ≥ 8**.
- Pohyb ±**2 Xr za snímek** (`saucerDeltaY` 208C = 2 [1B8C]); směr = bit 0 `shotCountLSB` 208F
  (0 → start Xr 0x29, +2; 1 → start 0xE0, −2 — RAMUse 208F); mizí při Xr < 0x28 nebo ≥ 0xE1
  [06CB–06D2]. Sprajt [1D64], exploze [1D7C].
- Zásah: `saucerHitTime` 2086 začíná na 0x20 snímků; exploze při 0x1F, skóre při 0x18
  [06DD–06E5]; UFO zvuk vypnut [06D6].
- **Hodnota podle počtu výstřelů** hráče: ukazatel `sauScoreLSB` 208D se posune při každém
  odstranění hráčovy střely [0447–0453]; `SaucerScrTab` [1D54] = 10 05 05 10 15 10 10 05
  **30** 10 10 10 05 15 10 05 (×10 bodů). Kód **wrapuje po 15 položkách** (bug `CP 0x63`
  [044C]) → 300 padne poprvé na 9. výstřel, pak každých 15 (komentář u 1D54).

### 2.8 Skóre, životy, bonus
- Skóre 2 B BCD (`P1ScorL` 20F8/20F9), `AdjustScore` [0988–09A5] sčítá s DAA, **carry se
  zahodí → skóre přeteče 9999 → 0000**.
- Životy z DIP (bity 0–1 portu 2: 3–6), tovární **3**; **bonus život 1500** (DIP bit 3 = 0;
  = 1 → 1000), přidělen **jednou za hru** — flag 21FD/22FD (`L_0935` [0935–0977]).
- High score 20F4/20F5, aktualizace [1671].

### 2.9 Attract mode (`L_0AEA` [0AEA–0BF0]; typ střídá `ram.splashAnimate` 20EC 0/1)
1. Zvuk vypnut, 1 s (64 sn.).
2. „PLAY" (typ 0: s obráceným Y, `MessagePlayUY` [1DAB]; typ 1: normální [1DA7]) uprostřed
   nahoře, „SPACE  INVADERS" [1DAF], po znaku s prodlevou (`PrintMessageDel`).
3. 1 s; „*SCORE ADVANCE TABLE*" (`DrawAdvTable` [1815], tabulka [1DBF]) po znaku; 2 s.
4. Jen typ 0: malý vetřelec sjede z Yr FE na 9E, vetřelec táhne obrácené Y (98→FF), 1 s,
   tlačí správné Y (FF→97), 1 s, smazání, 2 s [0B1F–0B47].
5. **Demo hra** [0B4A–0B88]: reset racku/štítů, `isrSplashTask` = 1, hráč stále střílí
   a hýbe se podle demo příkazů (`nextDemoCmd` 201D, `demoCmdPtr` 20ED, čtení [1652–1663]),
   bez zvuku; končí zásahem hráče + doběhnutím exploze.
6. 1 s; „INSERT  COIN" [2C11] (typ 0 navíc „C" → „CCOIN" [3311]), `CreditTable`
   „<1 OR 2 PLAYERS>", při DIP bitu 7 = 0 „*1 PLAYER  1 COIN"; 2 s.
7. Jen typ 0: vetřelec se srovná s C a squiggly střela ho sestřelí [0BCA–0BD7, 189E].
8. Přepnout typ, smazat hřiště, znovu od 1 [0BDA–0BE5].
- Během attractu bez kreditu běží ISR animace (`ISRSplTasks` [0ABF]); s kreditem se přejde
  na `WaitForStart` [0765] („PRESS START", v remaku PRESS FIRE).
- Skrytý vzkaz „TAITO COP" (`CheckHiddenMes` [199A], sekvence tlačítek) — v remaku
  volitelně.

### 2.10 Zvuk (porty 3 a 5, `soundPort3` 2094 / `soundPort5` 2098)
- Port 3: bit 0 UFO (smyčka), 1 výstřel hráče, 2 smrt hráče, 3 zásah vetřelce, 4 bonus
  život, 5 zesilovač zap. Port 5: bity 0–3 čtyři tóny pohybu flotily, bit 4 zásah UFO,
  bit 5 cocktail flip [`SoundBits3On` 18FA, `SoundBits3Off` 19DC, 06EA].
- Tempo flotily: tabulka počtu vetřelců [1A11] = 50 43 36 28 22 17 13 10 8 7 6 5 4 3 2 1 →
  prodleva ve snímcích [1A21] = 52 46 39 34 28 24 21 19 16 14 13 12 11 9 7 5
  (`FleetDelayExShip` [1775]; vybere první práh ≤ počtu živých); tón cykluje 1→2→3→4
  [1798–17A4]; délka držení tónu `fleetSndHold` 209B (`TimeFleetSound` [1740]).
- Bonus-život zvuk drží `extraHold` 2099 = 0xFF [0972].

### 2.11 Hodnoty pro regresní test (SI-M9)
- **Referenční emulátor** `tools/refemu` (headless 8080 + porty SI, jádro valleyco; nahrazuje
  MAME, které není k dispozici) vyrábí `sources/reference/`: `start.pbm` (VRAM při prvním úplném
  vykreslení racku), `cycleN.pbm` (N-tý průchod kurzoru), `trace-noinput.tsv` (RAM po snímcích bez
  vstupu: 2009/200A, 2006, 2082, 201B, 2025, 2029/202A, 208A, skóre, 2091/2092, 20EF, 2015, 2005,
  2010/2011). `tools/compose-screenshot.mjs` skládá obrazovku jen z `data/*.json` a porovnává ji
  s referencí (SI-M4: scény `start` a `cycle3` pixelově shodné).
- Z trasy: rack se posune jednou za 55 snímků (kurzor 0→0x36), ΔX +2: Xr 38 → 3A → 3C … ; animační
  fáze se přepíná s každým posunem; první posun v herním snímku 252.
- 1. kolo bez vstupu: rack startuje Yr 0x78/Xr 0x38, posun 1 vetřelec/snímek, ΔX +2, po 55
  snímcích celý rack o 2 px vpravo; konkrétní hodnoty po N snímcích se odečtou z MAME
  (RAM 2009/200A) až v SI-M5/M9.
- Kontrolní adresy RAM pro odečet: 2009/200A (ref. vetřelec), 2006 (kurzor), 2082 (počet),
  201B (hráč), 2029/202A (střela), 208A (UFO), 20F8/20F9 (skóre), 2091/2092 (UFO timer).

## 3. Rozsah remaku

- **Jen jeden hráč** (rozhodnuto 2026-08-29; režim dvou hráčů z originálu se nedělá).
- **High score a hall of fame na serveru, úplně stejně jako v Manic Mineru:** stejná
  DB tabulka/API (`db/`, `hallOfFameEntity.js`), jméno hráče jako v MM (ne arkádové
  iniciály), zápis po game over, zobrazení v attract mode / menu.
- **Úvodní menu jako v MM** (rozhodnuto 2026-08-29): po načtení se zobrazí `menuModel`
  se stejnou strukturou jako Manic Miner (START GAME, PLAYER NAME, HALL OF FAME, SOUNDS,
  MUSIC, SETTINGS, ATTRACT MODE, ABOUT GAME). Menu **neotevírá zvukové kanály** — audio
  se otevírá až výběrem položky, která zvuk potřebuje (vzor MM: `needEventForAudio()` +
  `ZXWaitForAudioEventEntity` před `startGame2`). Attract mode je položka menu (a
  případně automatický spořič po neaktivitě [?]), **implementovaný per hra**, ne jako
  sdílený modul svision.
- **CRT vzhled** se zapíná v SETTINGS stejně jako přepínač sharp/retro v MM
  (`layout.displayStyle`, `ZXSettingsEntity`), tj. rozšíření existujícího nastavení,
  ne nová volba. Default = jako v MM.
- Attract mode, INSERT COIN → náhrada „PRESS FIRE / TOUCH", nastavení
  hlasitosti/ovládání, About, PWA.
- **Volitelný barevný overlay** (fólie), default [?]; CRT vzhled viz výše.
- Žádné save game.

## 4. Platforma a vzhled

- Nová platforma **`ArcadeRasterPlatform`** (canvas2D, `app/arcadeRasterPlatform.js` +
  `app/arcadeRasterLayout.js`, potomek svision `Canvas2DPlatform`/`Canvas2DLayout`; **v projektu,
  ne ve svision** — viz kap. 0). SI ji zavádí a Pleiads přebírá kopií — proto je od začátku
  **konfigurovatelná per hra** (objekt config v `appPlatform.js`):
  - logická plocha jako parametr (SI 224×256 na výšku, Pleiads jiné rozměry), bez ZX
    borderu; okolí = černý „bezel" s volitelným obrázkem [?];
  - layout: celočíselné zvětšení od 2× (pixel-perfect), pod 2× neceločíselné (mobil na výšku
    vyplní displej — stejné pravidlo jako ZX layout), centrování; na desktopu vysoký výřez
    uprostřed; dotykové ovladače v černém okolí (☑ SI-M3);
  - volitelný **barevný overlay** (SI: fólie — obdélníky `overlay.bands` v souřadnicích plochy,
    skládané `multiply` přes desktop metodou `layout.paintOverlay(model)` z `drawModel()` herního
    modelu; hodnoty z `invaders.lay`, kap. 2.2; cookie `overlay` on/off, default **zapnuto**,
    UI přepínač v SETTINGS až SI-M8) a **CRT vzhled** = zděděný přepínač sharp/retro
    `Canvas2DLayout` (SETTINGS › DISPLAY, cookie `displayStyle`) — ☑ SI-M3;
  - znovupoužije `TextEntity`/`SpriteEntity`/`MenuEntity`/`ButtonEntity`; ZX-specifické
    pomocné obrazovky (`ZXVolumeEntity`, `ZXRemapKeysEntity`, `ZXSettingsEntity`,
    `ZXSelectingGamepadEntity`, `ZXPlayerNameEntity`, `ZXErrorEntity`, `ZXResetModel`) se
    **zatím používají beze změny** ze svision (platforma jim poskytuje ZX paletu tlačítek);
    jejich zobecnění / arkádový vzhled se řeší až v SI-M8 spolu s attract módem [?].
- Sprajty a font z ROM převedeny nástrojem do `app/` dat (mono, `SpriteEntity`
  s `penChar`). Barva pixelu = z overlay podle pozice.
- Sdílený kabinetový bezel se Pleiads [?].

## 5. Ovládání

- Klávesnice: ←/→ + Fire (remap), gamepad.
- Dotyk: **stejné ovládání jako v MM** — layouty z `controlsOptions.touchscreen` (tlačítko + horizontální joystick, prohoditelné strany, volba v SETTINGS), jen s akcí Fire místo Jump.

## 6. Architektura

- Kostra = kopie MM (`gameApp`, `menuModel` → attract/menu, `mainModel` → hra,
  `gameOverModel`, `hallOfFameEntity`, `aboutEntity`, `audioManager`).
- **Pevný tick = snímek originálu (60 Hz).** Worker běží akumulátorově (`dt` → N ticků),
  render interpolaci nedělá — kreslí se poslední stav. Rychlost, která v originále
  plyne z doby běhu CPU (rack se zrychluje s ubývajícími vetřelci), se napodobuje
  explicitně („jeden vetřelec za tick"), nikoli emulací taktů.
- **Deterministický RNG** — přepsat původní generátor (resp. jeho čtení z časovače)
  tak, aby attract/demo běžel shodně s originálem, kde je to ověřitelné.
- `gameWorker.js`: pevný tick 60 Hz, dvě fáze na tick (odpovídají RST 1/RST 2),
  stav: rack (bitmapa živých), pozice racku, směr, index „dalšího vetřelce k posunu",
  střely, UFO, štíty (pixelová bitmapa 4×), skóre, vlna, RNG.
- **Rendering (rozhodnuto v SI-M5):** worker vede 7 KiB 1-bpp „VRAM" se stejnou sémantikou
  kreslení jako originál (OR, prostý zápis, mazání AND-NOT, test kolize při kreslení) — díky tomu
  jsou kolize, ohlodávání štítů i díry ve spodní čáře přesně jako v automatu bez zvláštní logiky.
  Model dostává VRAM každý snímek a zobrazí ji (`screenEntity.js`, offscreen canvas 224×256
  škálovaný layoutem); fólie se násobí přes obraz (`layout.paintOverlay`). Skóre, kredity a
  zásobník lodí kreslí worker do VRAM originálním fontem — HUD je tedy totožný s automatem
  (o náhradě „CREDIT" se rozhodne v SI-M8). Původní plán (`SpriteEntity` per objekt) byl opuštěn.
- Hlavní program originálu (herní smyčka, prompt, čekání) je ve workeru stavový automat
  (`mainProgram()`), spouštěný jednou po každém přerušení: `prompt` → `play` → `waveEnd` /
  `invaded` → `gameOverText` → `gameOverWait` → `ended`. Zvukové porty 3 a 5 se posílají modelu
  jako události (`sounds`) pro syntetizátor SI-M7.

## 7. Zvuk

- Originál má **analogové obvody** (SN76477 + diskrétní); program jen zapíná/vypíná
  signály. Syntéza běží na existujícím svision `AudioOscillatorHandler` (Web Audio, jak
  v Endless Universe) — jeho `OscillatorInstrument`/`NoiseInstrument` už umí šum s filtrem a
  obálkou (`filterEnv`), frekvenční sweep (`pitchEnv`) i LFO (`lfo`), takže **do svision se
  nic nepřidávalo** (☑ SI-M7, 2026-08-29). Zvuky SI jsou skóre v `app/soundEffects.js`;
  Pleiads/BZ si udělají svoje (a případný „engine"/POKEY instrument doplní do svision, až bude
  třeba).
- Jeden handler hraje jedno skóre → **jeden bus na každý souběžný zvuk desky**
  (`app/audioManager.js`): `sounds` (výstřel), `kill`, `death`, `ufo` (smyčka), `ufoHit`, `bonus`
  a `music` (krok flotily). Efektové busy sledují hlasitost/ztlumení SOUNDS, flotila MUSIC.
- Řízení: worker posílá zápisy na porty 3 a 5 (`sounds` v každém snímku); `mainModel.playSoundPorts`
  spouští zvuk na náběžnou hranu bitu, UFO smyčka běží dokud je bit 0 portu 3 nastaven
  (`stopAudioBus` na sestupnou hranu).
- Ladění proti MAME samplům (autokorelace/RMS, viz M7 poznámky): výstřel 2,6→2,4 kHz + šum
  0,3 s; smrt hráče 0,7 s šum s klesajícím filtrem; zásah vetřelce dva klesající sweepy
  (1,3→0,4 kHz, 1,75→0,6 kHz); flotila 69/60/56/52 Hz ~70 ms; UFO 490 Hz s LFO 2 Hz; zásah UFO
  siréna 2,2 s (LFO 0,75 Hz, ±800 centů); bonus loď = UFO obvod ~1 s. **Subjektivní A/B zbývá
  udělat poslechem** [?].
- 9 efektů SI: UFO smyčka, výstřel, smrt hráče, zásah vetřelce, 4 kroky flotily, zásah UFO
  (+ bonus loď). Nahrávky slouží jen k ladění, do hry se nevkládají.


## 8. Data z ROM a právní rámec (společné)

- Grafika, font, tabulky se získají **z ROM převodem přes nástroje v
  `tools/` projektu** (`tools/rom2sprites <spec>`, ☑ SI-M4; spec `tools/rom2sprites.spec.json`; 2026-08-30 přesunuto ze `svision/tools/` — nástroje pro převod ROM jsou per hra, jako `rom2tiles` u Pleiades)
  do `data/sprites.json` (19 sprajtů, mřížky `#`/`-`, formát `SpriteEntity.setGraphicsData`) a
  `data/font.json` (znaky A–Z 0–9 `<>␠=*y?-`, mřížky + řádkový hex pro budoucí `ArcadeFonts8x8`).
  Hra jen čte data (`appData.db` → `sprites`, `font`).
- **Všechny zdrojové podklady se ukládají do projektu** (rozhodnuto 2026-08-29) do adresáře
  **`~/sw/spaceinvaders/sources/`**, ze kterého nástroje čerpají — ROM, disassemblace/zdrojáky,
  MAME drivery, nahrávky reálných zvuků, manuály a schémata:
  - `rom/` — ROM set `invaders` (a pro porovnání Midway), MAME artwork `invaders.lay`
  - `asm/` — Computer Archeology `invaders.asm` a průvodní komentáře, mapa RAM
  - `mame/` — drivery `mw8080bw.cpp`/`8080bw.cpp`, zvuk `mw8080bw_a.cpp`, `invaders` samples
  - `sound/` — nahrávky z reálné desky (Taito i Midway) k ladění syntézy
  - `docs/` — manuál, schémata desky, SN76477 datasheet
  Evidence všech souborů (původ URL, datum stažení, velikost, checksum, licence) je v
  **`sources/FILES.md`**; každý podadresář má navíc `README.md` s původem.
  `sources/` je **mimo git a mimo publikovaný web** (`.gitignore`, nekopíruje se na server);
  do repozitáře jdou jen převedené JSON/JS data v `app/`/`data/`.
- Vše převzaté se eviduje v `SOURCES.md` (svision) a `CREDITS.md` (projekt):
  původ, autor, licence, co bylo upraveno.
- Název hry, grafika a zvuky jsou chráněné (Taito/Square Enix). Postup jako u MM/JSW
  (nekomerční, CC BY-NC-SA); před veřejným vydáním rozhodnout název a míru vlastních
  audiovizuálních prvků. [?]
- Referenční nahrávky zvuku slouží jen k **ladění syntézy**, do hry se nevkládají.

## 9. Ověřování

- **Seznam měřitelných referencí** z disassemblace/MAME: tabulky skóre, UFO hodnoty,
  startovní výšky racku, časy UFO, rychlost střel, počty snímků animací, pozice objektů
  na startu, chování RNG.
- Regresní test `tools/regress.mjs` (☑ SI-M5): spustí `app/gameWorker.js` headless (Node `vm`,
  `initData.headless`) bez vstupu, zarovná se na první snímek s kurzorem 0x36 a porovná po
  snímcích refAlienYr/Xr, kurzor, počet vetřelců, fázi animace, Xr hráče a časovač hráče s trasou
  `sources/reference/trace-noinput.tsv` z `tools/refemu` — 650 snímků bez odchylky (včetně
  prvního odrazu a poklesu). Rozdíl 17 snímků v délce promptu „PLAY PLAYER<1>" je čas CPU
  originálu na mazání obrazovky; zarovnání ho vyrovnává.
- Testflight stránka jako u MM/JSW (`testFlightPage.php`, `~/sw/testflights/spaceinvaders`).

## 10. Postup (společný rytmus, SI jde první)

1. Podklady: stáhnout do `sources/` (ROM, disassemblace, MAME driver, nahrávky, manuály) → doplnit kap. 2. **Hotovo 2026-08-29 (SI-M1).**
2. Skelet projektu: kopie MM (index.php, config, db, images, app/* bez herní logiky),
   symlink `app/svision`, `svtool build` prochází s prázdnou hrou.
3. `ArcadeRasterPlatform` + zobecnění ZX pomocných obrazovek (svision).
4. Data z ROM (`rom2sprites`) → JSON; statický „screenshot" ze dat.
5. Rack + pohyb + hráč + střely + štíty (hratelná 1 vlna bez zvuku).
6. UFO, vlny, bonusy, game over.
7. Zvuk: syntetizátor efektů ve svision, ladění proti nahrávkám.
8. Attract mode, hall of fame, nastavení, PWA, testflight.
9. Regresní testy věrnosti, CRT/overlay, About/Credits.

## 11. Otevřené otázky [?]

- Referenční ROM: Taito `invaders` vs. Midway (zvuková deska).
- Default overlay (fólie).
- Společné pro všechny tři hry: **veřejný název a doména** pro vydání (interní název
  projektu = podadresář `spaceinvaders`, rozhodnuto 2026-08-29; veřejný název držet jako parametr
  v `config/`); kabinetový bezel (obrázek ano/ne).
- Sdílený kabinetový bezel s Pleiads.

- **Zrevidovat časování workeru** (operátor 2026-10-07, `../DECISIONS.md`
  R-046 „Co zbývá“). Worker odměřuje tiky **akumulátorem** –
  `app/gameWorker.js`, tik 16,67 ms, 60 Hz. Rozhodnuto akumulátor ve všech
  hrách zrušit a časovat jen konstantou `setTimeout`, nastavenou co nejblíž
  originálu (časem změřenou), jeden tik na volání; vzor je
  `../booty/app/gameWorker.js`.
