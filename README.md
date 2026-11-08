![](/images/app-icon-256x256.png)

SPACE INVADERS
=====================
Faithful browser remake of the 1978 Taito arcade classic — work in progress.

## About
Designed by Tomohiro Nishikado (Taito, 1978). The original game logic is rewritten in JavaScript
from the annotated disassembly (not emulated); see `GAME-DESIGN.md` for the design and
`MILESTONES.md` for the plan. Sibling projects: Manic Miner, Jet Set Willy (same svision kernel).

Status: **SI-M5** — the first wave (and the following ones) is playable: the game logic is a
faithful rewrite of the original program running in a worker at 60 Hz, shown through
`ArcadeRasterPlatform` with the cellophane overlay. Sound, attract mode and PWA polish are still
to come; the app icons are placeholders copied from Manic Miner.

## Requirements
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js + terser, for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 compatibility gate in `svtool verify` (`npm i -g es-check`)

## Install
(`~/` below refers to the project root, not your home directory.)
- clone this repository
- clone library repository https://github.com/mitrenga/svision
- check symlink ~/app/svision
- configure nginx (example: ~/config/nginx.conf)
- create path ~/js with permissions 0777
- create database (script: ~/config/createDB.sql)
- create configuration file ~/config/config.php (example: ~/config/config.php.sample)
- build the production bundle: ~/app/svision/tools/svtool build bundle

## Developer mode
Same as Manic Miner: `$devMode = true;` and `$devModeName` in `~/config/config.php`.

## Build & tooling
`svtool build bundle`, `svtool build debug-bundle`, `svtool verify`, `svtool info`, `svtool clean`
(run from the project root).

## Tools
- `tools/rom2sprites tools/rom2sprites.spec.json` — regenerates `data/sprites.json` and
  `data/font.json` from the ROM in `sources/rom/invaders/`.
- `tools/refemu/build.sh` + `tools/refemu/refemu sources/rom/invaders ...` — headless reference
  emulator (needs the valleyco 8080 core in `sources/`); produces VRAM snapshots and RAM traces
  into `sources/reference/`.
- `node tools/compose-screenshot.mjs [--scene start|cycleN]` — composes the first-wave screen
  from the JSON data and compares it pixel by pixel with the reference snapshot.
- `node tools/regress.mjs [frames]` — runs `app/gameWorker.js` headless without input and compares
  the rack movement frame by frame with the reference RAM trace (`sources/reference/trace-noinput.tsv`).

## Sources
Reference material (ROM, disassembly, MAME driver, manuals, sound recordings) lives in
`sources/` — outside git and outside the published web (see `GAME-DESIGN.md` chap. 8).

## License
See the [LICENSE](LICENSE) file.
