#!/usr/bin/env node
/**
 * compose-screenshot — builds the first-wave start screen (224x256, 1 bpp) purely
 * from the extracted data (data/sprites.json, data/font.json) and the object
 * positions documented in GAME-DESIGN.md chap. 2.3, then compares it pixel by
 * pixel with the reference VRAM snapshot from the reference emulator
 * (sources/reference/start.pbm, produced by tools/refemu). SI-M4 acceptance test.
 *
 * usage: node tools/compose-screenshot.mjs [--scene start|cycleN] [out.pbm]
 *   start  — the first frame with all 55 aliens drawn (the player task has not
 *            started yet, so there is no player on screen — as in the original)
 *   cycleN — the N-th time the cursor completes the rack (all aliens at one
 *            position, rack moved N-1 steps); from cycle 3 on the player is visible.
 *            Positions are read from sources/reference/trace-noinput.tsv, the
 *            reference snapshot is sources/reference/cycleN.pbm (refemu --snap-cycle N)
 *
 * Coordinate mapping of the original (hardware Xr/Yr -> screen):
 *   screen x = Xr - 32            (VRAM starts at 0x2400 = raster row 32)
 *   screen y of a sprite's top row = 255 - Yr - (height - 1)
 *   VRAM address A (lowest byte of a column): x = (A - 0x2400) >> 5, top y = 255 - ((A & 31)*8 + height - 1)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sprites = JSON.parse(fs.readFileSync(path.join(root, 'data/sprites.json'), 'utf8')).sprites;
const font = JSON.parse(fs.readFileSync(path.join(root, 'data/font.json'), 'utf8')).font;
const args = process.argv.slice(2);
let scene = 'start', fileArg = null;
for (let i = 0; i < args.length; i++) { if (args[i] === '--scene') scene = args[++i]; else fileArg = args[i]; }
const W = 224, H = 256;
const screen = Array.from({length: H}, () => new Uint8Array(W));

function blit(grid, x, y) {
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#' && x+c >= 0 && x+c < W && y+r >= 0 && y+r < H) {
        screen[y+r][x+c] = 1;
      }
    }
  });
}
const sprite = (name, x, y, frame = 0) => blit(sprites[name].sprite[frame], x, y);
const text = (str, x, y) => { for (const ch of str) { blit(font.glyphs[ch], x, y); x += 8; } };
// hardware coordinates -> screen
const atXY = (name, xr, yr, frame = 0) => sprite(name, xr-32, 255-yr-(sprites[name].height-1), frame);
const addrXY = (a, height = 8) => ({x: (a-0x2400) >> 5, y: 255-((a & 31)*8+height-1)});   // y of the top row of a `height` px tall sprite whose lowest byte is at A

// --- the scene: DrawStatus + first wave (GAME-DESIGN 2.3, invaders.asm) ---
let p = addrXY(0x241E); text(' SCORE<1> HI-SCORE SCORE<2> ', p.x, p.y);   // DrawScoreHead [191A]
p = addrXY(0x271C); text('0000', p.x, p.y);                                 // P1 score descriptor 20F8 (mirror 1BF8)
p = addrXY(0x2F1C); text('0000', p.x, p.y);                                 // hi-score descriptor 20F4 (mirror 1BF4)
p = addrXY(0x3501); text('CREDIT ', p.x, p.y);                              // [193C]
p = addrXY(0x3C01); text('00', p.x, p.y);                                   // DrawNumCredits [1947]
p = addrXY(0x2501); text('3', p.x, p.y);                                    // ships left digit [1A8B]: 3 - 1 in play = 2 reserve? no: prints total 3
p = addrXY(0x2701); sprite('player', p.x, p.y); sprite('player', p.x+16, p.y); // DrawNumShips [19D1]: reserve ships at 2701, 2901
for (let x = 0; x < W; x++) screen[239][x] = 1;                              // DrawBottomLine [01CF]: bit 0 of byte 2 -> raster x 16 -> y 239
for (let k = 0; k < 4; k++) { p = addrXY(0x2806+k*45*32, 16); sprite('shield', p.x, p.y); } // CopyShields [1AD7] at 2806, 23 rows between 22-wide shields
// rack + player: the start scene has the initial reference alien 0x78/0x38, animation
// frame 0 and no player yet (the player object starts 128 ISR ticks later). The cycle2
// scene reads the reference alien position, the animation frame and the player from
// the RAM trace at the frame of the 2nd cursor completion (curIndex 0x36 for the 2nd time).
let refYr = 0x78, refXr = 0x38, alienFrame = 0, playerXr = null;
const cycleN = scene.startsWith('cycle') ? parseInt(scene.substring(5)) : 0;
if (cycleN > 0) {
  const rows = fs.readFileSync(path.join(root, 'sources/reference/trace-noinput.tsv'), 'utf8').trim().split('\n');
  const head = rows.shift().split('\t');
  const col = (n) => head.indexOf(n);
  let seen = 0, last36 = false;
  for (const line of rows) {
    const f = line.split('\t');
    const is36 = f[col('curIndex')] === '36';
    if (is36 && !last36) { seen++; if (seen === cycleN) { refYr = parseInt(f[col('refAlienYr')], 16); refXr = parseInt(f[col('refAlienXr')], 16); alienFrame = parseInt(f[col('alienFrame')]); playerXr = (parseInt(f[col('obj0Timer')], 16) === 0) ? parseInt(f[col('playerXr')], 16) : null; break; } }
    last36 = is36;
  }
  console.log(`${scene}: ref alien Yr=${refYr.toString(16)} Xr=${refXr.toString(16)} frame=${alienFrame} playerXr=${playerXr === null ? 'not yet drawn' : playerXr.toString(16)}`);
}
if (playerXr !== null) atXY('player', playerXr, 0x20);                    // player mirror 1B1A: Yr 0x20
const rowType = ['alienOctopus', 'alienOctopus', 'alienCrab', 'alienCrab', 'alienSquid'];
for (let row = 0; row < 5; row++) {
  for (let col = 0; col < 11; col++) {
    atXY(rowType[row], refXr+16*col, refYr+16*row, alienFrame);            // 16 px pitch in both axes (GetAlienCoords)
  }
}

// --- write PBM ---
const outFile = fileArg || path.join(root, 'sources/reference/composed-'+scene+'.pbm');
const rowBytes = W/8;
const buf = Buffer.alloc(H*rowBytes, 0xFF);   // PBM: 1 = black; lit pixel -> white (0)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (screen[y][x]) buf[y*rowBytes+(x >> 3)] &= ~(0x80 >> (x & 7));
fs.writeFileSync(outFile, Buffer.concat([Buffer.from(`P4\n${W} ${H}\n`), buf]));
console.log('composed: '+outFile);

// --- compare with the reference snapshot (regenerate with refemu when missing) ---
const refFile = path.join(root, 'sources/reference/'+scene+'.pbm');
if (!fs.existsSync(refFile)) {
  console.log('reference missing, running refemu');
  execFileSync(path.join(root, 'tools/refemu/refemu'), [path.join(root, 'sources/rom/invaders'), '--frames', '900', '--snap-start', path.join(root, 'sources/reference/start.pbm'), '--snap-cycle', '3', path.join(root, 'sources/reference/cycle3.pbm'), '--trace', path.join(root, 'sources/reference/trace-noinput.tsv')], {stdio: 'inherit'});
}
const ref = fs.readFileSync(refFile);
const header = `P4\n${W} ${H}\n`;
const refBits = ref.subarray(header.length);
let diff = 0; const diffs = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = (buf[y*rowBytes+(x >> 3)] >> (7-(x & 7))) & 1;
  const b = (refBits[y*rowBytes+(x >> 3)] >> (7-(x & 7))) & 1;
  if (a !== b) { diff++; if (diffs.length < 20) diffs.push(`${x},${y} composed=${a ? 'off' : 'on'} ref=${b ? 'off' : 'on'}`); }
}
console.log(diff === 0 ? 'PIXEL-IDENTICAL with the reference snapshot' : `DIFFERENT: ${diff} pixel(s)\n  `+diffs.join('\n  '));
process.exit(diff === 0 ? 0 : 1);
