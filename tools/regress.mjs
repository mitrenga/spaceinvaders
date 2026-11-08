#!/usr/bin/env node
/**
 * regress — runs app/gameWorker.js headless (Node) for N frames without input and
 * compares the rack state frame by frame with the RAM trace of the reference
 * emulator (sources/reference/trace-noinput.tsv, tools/refemu). GAME-DESIGN chap. 9.
 * Both runs are aligned on the first frame in which the alien cursor reaches the
 * last alien (curIndex 0x36): from there on refAlienYr/Xr, curIndex, numAliens,
 * alienFrame and the player object timer must match exactly.
 *
 * usage: node tools/regress.mjs [frames=600]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const frames = parseInt(process.argv[2] || '600');
const sprites = JSON.parse(fs.readFileSync(path.join(root, 'data/sprites.json'), 'utf8')).sprites;
const font = JSON.parse(fs.readFileSync(path.join(root, 'data/font.json'), 'utf8')).font;

// load the worker as a classic worker script
const messages = [];
const sandbox = {postMessage: (m) => messages.push(structuredClone(m)), setTimeout: () => 0, clearTimeout: () => {}, console};
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app/gameWorker.js'), 'utf8'), sandbox, {filename: 'gameWorker.js'});
sandbox.onmessage({data: {id: 'init', initData: {sprites, font, hiScore: 0, headless: true}}});
const si = sandbox.__si;

// reference trace
const rows = fs.readFileSync(path.join(root, 'sources/reference/trace-noinput.tsv'), 'utf8').trim().split('\n');
const head = rows.shift().split('\t');
const col = (n) => head.indexOf(n);
const ref = rows.map((l) => l.split('\t')).map((f) => ({
  frame: +f[col('gameFrame')], yr: parseInt(f[col('refAlienYr')], 16), xr: parseInt(f[col('refAlienXr')], 16),
  idx: parseInt(f[col('curIndex')], 16), num: +f[col('numAliens')], px: parseInt(f[col('playerXr')], 16),
  af: +f[col('alienFrame')], obj0: parseInt(f[col('obj0Timer')], 16)
}));
const refStart = ref.findIndex((r) => r.idx === 0x36);

// our run
const run = [];
for (let i = 0; i < frames + 400; i++) {
  si.tick();
  const s = si.state(), o = si.objs()[0];
  run.push({frame: i, yr: s.refAlienYr, xr: s.refAlienXr, idx: s.alienCurIndex, num: s.numAliens, px: s.player.xr, af: s.alienFrame, obj0: (o.t1 << 8) | o.t0, state: s.mainState});
}
const runStart = run.findIndex((r) => r.idx === 0x36);
console.log(`alignment: reference frame ${ref[refStart].frame}, remake frame ${runStart} (remake prompt ${runStart - ref[refStart].frame + ref[0].frame} frames shorter/longer)`);

let mismatches = 0;
for (let i = 0; i < frames; i++) {
  const a = ref[refStart + i], b = run[runStart + i];
  if (!a || !b) break;
  const diff = ['yr', 'xr', 'idx', 'num', 'af', 'px', 'obj0'].filter((k) => a[k] !== b[k]);
  if (diff.length) {
    mismatches++;
    if (mismatches <= 15) {
      console.log(`frame +${i}: ` + diff.map((k) => `${k} ref=${a[k].toString(16)} remake=${b[k].toString(16)}`).join(', '));
    }
  }
}
const last = run[runStart + frames - 1];
console.log(`checked ${frames} frames, ${mismatches} mismatching; remake at the end: rack ${last.yr.toString(16)}/${last.xr.toString(16)} idx ${last.idx.toString(16)} state ${last.state}`);
process.exit(mismatches ? 1 : 0);
