// begin code

/**
 * Space Invaders game worker — a faithful JavaScript rewrite of the original
 * Taito/Midway program (sources/asm/invaders.asm, Computer Archeology). The
 * addresses in the comments ([xxxx]) point to the original routines.
 *
 * Structure of one tick (= one frame of the original, 60 Hz):
 *   RST 1 (scanline 96):  vblankStatus = 0; run game objects 1-4; move the alien cursor
 *   main program pass
 *   RST 2 (scanline 224): vblankStatus = 0x80; isrDelay--; fleet sound timing;
 *                         shotSync; draw one alien; run game objects 0-4; saucer timer
 *   main program pass
 * The original main program is a free-running loop (game loop, prompts, delays);
 * here it is a state machine executed once after each interrupt, which keeps the
 * same ordering relative to the interrupt work (drawing happens only in RST 2).
 *
 * The screen is a 7 KiB 1-bpp VRAM (0x2400-0x3FFF) with the exact drawing
 * semantics of the original (OR / plain write / AND-NOT erase / collision test),
 * so shields get eaten pixel by pixel and every collision is decided exactly as
 * on the arcade board. The model receives the VRAM every frame and shows it.
 *
 * Hardware coordinates (Xr, Yr): Xr = raster row = screen x + 32, Yr = raster
 * column = 255 - screen y (bit 0 of the lowest byte is the bottom pixel).
 */

var TICK_MS = 1000/60;

// ---------------------------------------------------------------- ROM tables
var ALIEN_START_TABLE = [0x60, 0x50, 0x48, 0x48, 0x48, 0x40, 0x40, 0x40];          // [1DA3] rack Yr for rounds 2-9 (round 1 = 0x78)
var COL_FIRE_TABLE = [0x01, 0x07, 0x01, 0x01, 0x01, 0x04, 0x0B, 0x01, 0x06, 0x03, 0x01, 0x01, 0x0B, 0x09, 0x02, 0x08, 0x02, 0x0B, 0x04, 0x07, 0x0A]; // [1D00]
var SAUCER_SCORE_TABLE = [0x10, 0x05, 0x05, 0x10, 0x15, 0x10, 0x10, 0x05, 0x30, 0x10, 0x10, 0x10, 0x05, 0x15, 0x10, 0x05]; // [1D54] (x10 pts, BCD)
var SAUCER_SCORE_TEXT = {0x05: ' 50', 0x10: '100', 0x15: '150', 0x30: '300'};       // [1D4C/1D50/1D94]
var RELOAD_SCORE_TABLE = [0x02, 0x10, 0x20, 0x30];                                  // [1CB8] score MSB (BCD)
var RELOAD_RATE_TABLE = [0x30, 0x10, 0x0B, 0x08, 0x07];                             // [1AA1]
var ALIEN_SCORES = [0x10, 0x20, 0x30];                                              // [1DA0] rows 0-1, 2-3, 4
var FLEET_ALIENS = [0x32, 0x2B, 0x24, 0x1C, 0x16, 0x11, 0x0D, 0x0A, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]; // [1A11]
var FLEET_DELAY = [0x34, 0x2E, 0x27, 0x22, 0x1C, 0x18, 0x15, 0x13, 0x10, 0x0E, 0x0D, 0x0C, 0x0B, 0x09, 0x07, 0x05];  // [1A21]

// ---------------------------------------------------------------- graphics data
// images[name] = array of frames; a frame = Uint8Array of column bytes in ROM
// order (column-major, bit 0 = bottom pixel of the lowest byte). Built from
// data/sprites.json and data/font.json received in the init message.
var images = {};
var fontCols = {};   // char -> Uint8Array(8)

function gridToColumns(grid, width, height) {
  var bpc = height/8;
  var data = new Uint8Array(width*bpc);
  for (var c = 0; c < width; c++) {
    for (var j = 0; j < bpc; j++) {
      var byte = 0;
      for (var b = 0; b < 8; b++) {
        var row = height-1-(j*8+b);
        if (grid[row][c] === '#') {
          byte |= (1 << b);
        }
      }
      data[c*bpc+j] = byte;
    }
  }
  return data;
} // gridToColumns

function loadGraphics(sprites, font) {
  Object.keys(sprites).forEach(function(name) {
    var s = sprites[name];
    images[name] = s.sprite.map(function(grid) { return gridToColumns(grid, s.width, s.height); });
  });
  Object.keys(font.glyphs).forEach(function(ch) {
    fontCols[ch] = gridToColumns(font.glyphs[ch], 8, 8);
  });
} // loadGraphics

// ---------------------------------------------------------------- VRAM
var VRAM_BASE = 0x2400, VRAM_SIZE = 0x1C00;
var vram = new Uint8Array(VRAM_SIZE);

function vget(addr) {
  addr -= VRAM_BASE;
  return (addr >= 0 && addr < VRAM_SIZE) ? vram[addr] : 0;
} // vget

function vset(addr, value) {
  addr -= VRAM_BASE;
  if (addr >= 0 && addr < VRAM_SIZE) {
    vram[addr] = value & 0xFF;
  }
} // vset

// pixel position (Xr, Yr) -> screen address [1A47 ConvToScr] and shift [1474]
function pixAddr(xr, yr) {
  return (((xr << 8) | yr) >> 3) | 0x2000;
} // pixAddr

// the hardware shift register: a data byte followed by a zero yields the two
// screen bytes of one shifted column
function shiftLo(d, s) { return (d << s) & 0xFF; }
function shiftHi(d, s) { return s ? (d >> (8-s)) & 0xFF : 0; }

// [1400] DrawShiftedSprite: OR the shifted image onto the screen
function drawShifted(xr, yr, img, n) {
  var a = pixAddr(xr, yr), s = yr & 7;
  for (var i = 0; i < n; i++, a += 32) {
    vset(a, vget(a) | shiftLo(img[i], s));
    vset(a+1, vget(a+1) | shiftHi(img[i], s));
  }
} // drawShifted

// [1491] DrawSprCollision: OR onto the screen, set `collision` on overlap
function drawSprCollision(xr, yr, img, n) {
  var a = pixAddr(xr, yr), s = yr & 7;
  st.collision = 0;
  for (var i = 0; i < n; i++, a += 32) {
    var lo = shiftLo(img[i], s), hi = shiftHi(img[i], s);
    if (vget(a) & lo) { st.collision = 1; }
    vset(a, vget(a) | lo);
    if (vget(a+1) & hi) { st.collision = 1; }
    vset(a+1, vget(a+1) | hi);
  }
} // drawSprCollision

// [1452] EraseShifted: clear the image bits (AND NOT)
function eraseShifted(xr, yr, img, n) {
  var a = pixAddr(xr, yr), s = yr & 7;
  for (var i = 0; i < n; i++, a += 32) {
    vset(a, vget(a) & ~shiftLo(img[i], s));
    vset(a+1, vget(a+1) & ~shiftHi(img[i], s));
  }
} // eraseShifted

// [15D3] DrawSprite: plain write of the shifted image (both bytes of each column)
function drawSprite(xr, yr, img, n) {
  var a = pixAddr(xr, yr), s = yr & 7;
  for (var i = 0; i < n; i++, a += 32) {
    vset(a, shiftLo(img[i], s));
    vset(a+1, shiftHi(img[i], s));
  }
} // drawSprite

// [1439] DrawSimpSprite: plain write of one byte per column at a screen address
function drawSimpAt(addr, img, n) {
  for (var i = 0; i < n; i++, addr += 32) {
    vset(addr, img[i]);
  }
} // drawSimpAt

function drawSimp(xr, yr, img, n) {
  drawSimpAt(pixAddr(xr, yr), img, n);
} // drawSimp

// [1424] EraseSimpleSprite: clear two bytes per column
function eraseSimple(xr, yr, n) {
  var a = pixAddr(xr, yr);
  for (var i = 0; i < n; i++, a += 32) {
    vset(a, 0);
    vset(a+1, 0);
  }
} // eraseSimple

// [14CB] ClearSmallSprite: clear one byte per column at a screen address
function clearSmallAt(addr, n) {
  for (var i = 0; i < n; i++, addr += 32) {
    vset(addr, 0);
  }
} // clearSmallAt

// [08FF] DrawChar / [08F3] PrintMessage
function drawChar(addr, ch) {
  drawSimpAt(addr, fontCols[ch] || fontCols[' '], 8);
} // drawChar

function printMessage(addr, text) {
  for (var i = 0; i < text.length; i++, addr += 0x100) {
    drawChar(addr, text[i]);
  }
} // printMessage

// [09AD] Print4Digits (BCD word)
function print4Digits(addr, bcd) {
  printMessage(addr, bcd.toString(16).toUpperCase().padStart(4, '0'));
} // print4Digits

// [09D6] ClearPlayField: bytes 2..27 of every row (screen y 32..239)
function clearPlayField() {
  for (var a = 0; a < VRAM_SIZE; a++) {
    var c = a & 31;
    if (c >= 2 && c < 0x1C) {
      vram[a] = 0;
    }
  }
} // clearPlayField

// [1A5C] ClearScreen
function clearScreen() {
  vram.fill(0);
} // clearScreen

// [01CF] DrawBottomLine: bit 0 of byte 2 in every row -> screen y 239
function drawBottomLine() {
  for (var a = 0x2402; a < 0x4000; a += 32) {
    vset(a, 1);
  }
} // drawBottomLine

// [021E] CopyShields (restore): OR the pristine shields at 2806, 23 rows apart
function restoreShields() {
  var shield = images.shield[0];
  for (var k = 0; k < 4; k++) {
    var a = 0x2806 + k*0x5A0;   // 22 columns of shield + 23 empty = 45 rows apart
    for (var col = 0; col < 22; col++, a += 32) {
      vset(a, vget(a) | shield[col*2]);
      vset(a+1, vget(a+1) | shield[col*2+1]);
    }
  }
} // restoreShields

// ---------------------------------------------------------------- BCD helpers
function bcdToInt(bcd) {
  return ((bcd >> 12) & 15)*1000 + ((bcd >> 8) & 15)*100 + ((bcd >> 4) & 15)*10 + (bcd & 15);
} // bcdToInt

function intToBcd(n) {
  n = n % 10000;
  return (Math.floor(n/1000) << 12) | (Math.floor(n/100) % 10 << 8) | (Math.floor(n/10) % 10 << 4) | (n % 10);
} // intToBcd

// ---------------------------------------------------------------- game state
var controls = {left: false, right: false, fire: false};
var st;          // the RAM of the original, by name
var objs;        // game objects 2010-205F: timers + handler
var tickCount, pause, nextLoop, lastTime, accumulator, initData;
var soundEvents; // sound bit changes since the last frame message

function newShot(track, cfirIdx, imageName) {
  // alien shot structure 2035/2045/2055 (11 bytes)
  return {status: 0, step: 0, track: track, cfirIdx: cfirIdx, blow: 4, image: imageName, frame: 0, yr: 0, xr: 0, size: 3};
} // newShot

function newSaucer() {
  // 2083-208C from the mirror [1B83]
  return {start: 0, active: 0, hit: 0, hitTime: 0x20, image: 'saucer', yr: 0xD0, xr: 0x29, size: 0x18, delta: 0x02};
} // newSaucer

function newPlayerObject() {
  // 2010-201F from the mirror [1B10]
  return {t0: 0x00, t1: 0x80, extra: 0, alive: 0xFF, blowDelay: 5, blowCount: 0x0C, image: 'player', frame: 0, yr: 0x20, xr: 0x30, size: 0x10};
} // newPlayerObject

function newPlayerShot() {
  // 2025-202C from the mirror [1B25]
  return {status: 0, blowTimer: 0x10, image: 'playerShot', yr: 0x28, xr: 0x30, size: 1, delta: 4};
} // newPlayerShot

/**
 * [01E4] CopyRAMMirror: 2000-20BF from the ROM mirror. Also used at the start of
 * every round. Everything outside 2000-20BF (score, hi-score, reload rate,
 * isrDelay, player data 21xx) survives.
 */
function copyRAMMirror() {
  st.waitOnDraw = 1;            // 2000
  st.alienIsExploding = 0;      // 2002
  st.expAlienTimer = 0x10;      // 2003
  st.alienRow = 0;              // 2004
  st.alienFrame = 0;            // 2005
  st.alienCurIndex = 0;         // 2006
  st.refAlienDYr = 0;           // 2007 (vertical delta, applied once)
  st.refAlienDXr = 2;           // 2008 (horizontal delta)
  st.refAlienYr = 0x78;         // 2009
  st.refAlienXr = 0x38;         // 200A
  st.alienPosYr = 0x78;         // 200B
  st.alienPosXr = 0x38;         // 200C
  st.rackDirection = 0;         // 200D
  st.rackDownDelta = 0xF8;      // 200E (-8)
  st.player = newPlayerObject();
  st.shot = newPlayerShot();
  st.fireBounce = 0;            // 202D
  objs = [
    {t0: 0, t1: 0x80, extra: 0, handler: gameObj0},   // player (timers live in st.player, mirrored below)
    {t0: 0, t1: 0, extra: 0, handler: gameObj1},      // player shot
    {t0: 0, t1: 0, extra: 2, handler: gameObj2},      // rolling shot
    {t0: 0, t1: 0, extra: 0, handler: gameObj3},      // plunger shot
    {t0: 0, t1: 0, extra: 0, handler: gameObj4}       // squiggly shot / saucer
  ];
  st.rolling = newShot(0, 0, 'rollingShot');          // 2035; cfirIdx used as the skip-first-attempt flag
  st.rollingSkipFlag = 0;                             // 2038/2039
  st.plunger = newShot(1, 0, 'plungerShot');          // 2045, table pointer 1D00 -> index 0
  st.squiggly = newShot(1, 6, 'squigglyShot');        // 2055, table pointer 1D06 -> index 6
  st.collision = 0;             // 2061
  st.expAlienYr = 0;            // 2064
  st.expAlienXr = 0;            // 2065
  st.playerOK = 1;              // 2068
  st.enableAlienFire = 0;       // 2069
  st.alienFireDelay = 0x30;     // 206A
  st.invaded = 0;               // 206D
  st.skipPlunger = 0;           // 206E
  st.otherShot1 = 0;            // 2070
  st.otherShot2 = 0;            // 2071
  st.vblankStatus = 0x80;       // 2072
  st.alienShotDelta = 0xFC;     // 207E (-4)
  st.shotSync = 1;              // 2080
  st.numAliens = 0xFF;          // 2082
  st.saucer = newSaucer();      // 2083-208C
  st.sauScoreIdx = 0;           // 208D (pointer into SAUCER_SCORE_TABLE)
  st.shotCount = 0;             // 208F
  st.tillSaucer = 0x0600;       // 2091/2092
  st.soundPort3 = 0;            // 2094
  st.changeFleetSnd = 1;        // 2095
  st.fleetSndCnt = 0x40;        // 2096
  st.fleetSndReload = 0;        // 2097
  st.soundPort5 = 1;            // 2098 (first fleet tone)
  st.extraHold = 0;             // 2099
  st.fleetSndHold = 0x10;       // 209B
} // copyRAMMirror

function resetData() {
  tickCount = 0;
  pause = false;
  nextLoop = false;
  lastTime = false;
  accumulator = 0;
  soundEvents = [];
  st = {
    gameMode: 0,                // 20EF
    suspendPlay: 0,             // 20E9
    isrDelay: 0,                // 20C0
    aShotReloadRate: 8,         // 20CF (set at boot [18DF])
    adjustScore: 0,             // 20F1
    scoreDelta: 0,              // 20F2/20F3 (BCD)
    hiScore: 0,                 // 20F4/20F5 (BCD)
    score: 0,                   // 20F8/20F9 (BCD)
    extraShipAvailable: 1,      // 20E5
    aliens: new Uint8Array(55), // 2100-2136 (1 = alive)
    p1RefAlienDX: 2,            // 21FB
    p1RefAlienYr: 0x78,         // 21FC
    p1RefAlienXr: 0x38,         // 21FD
    rackCnt: 0,                 // 21FE
    ships: 3,                   // 21FF
    mainState: 'idle',
    mainTimer: 0,
    mainText: '',
    mainTextAddr: 0,
    mainTextPos: 0,
    gameOverPosted: false
  };
  copyRAMMirror();
} // resetData

// ---------------------------------------------------------------- sound ports
function soundBits3On(bits) {   // [18FA]
  var v = st.soundPort3 | bits;
  if (v !== st.soundPort3) {
    st.soundPort3 = v;
    soundEvents.push({port: 3, value: v});
  }
} // soundBits3On

function soundBits3Off(mask) {  // [19DC]
  var v = st.soundPort3 & mask;
  if (v !== st.soundPort3) {
    st.soundPort3 = v;
    soundEvents.push({port: 3, value: v});
  }
} // soundBits3Off

function outPort5(value) {
  soundEvents.push({port: 5, value: value & 0xFF});
} // outPort5

// ---------------------------------------------------------------- aliens
// [017A] GetAlienCoords: index -> position and row
function getAlienCoords(index) {
  var row = 0, a = index, yr = st.refAlienYr, xr = st.refAlienXr;
  while (a >= 11) {
    a -= 11;
    yr = (yr + 16) & 0xFF;
    row++;
  }
  while (a > 0) {
    xr = (xr + 16) & 0xFF;
    a--;
  }
  return {yr: yr, xr: xr, row: row};
} // getAlienCoords

// [01A1] MoveRefAlien
function moveRefAlien() {
  st.alienCurIndex = 0;
  var dy = st.refAlienDYr;
  st.refAlienDYr = 0;
  st.refAlienYr = (st.refAlienYr + dy) & 0xFF;
  st.refAlienXr = (st.refAlienXr + st.refAlienDXr) & 0xFF;
  st.alienFrame ^= 1;
} // moveRefAlien

// [0141] CursorNextAlien (RST 1)
function cursorNextAlien() {
  if (!st.playerOK) {
    return;
  }
  if (st.waitOnDraw) {
    return;
  }
  var d = 2, a = st.alienCurIndex;
  for (;;) {
    a++;
    if (a === 0x37) {
      d--;
      if (d === 0) {
        return;   // ReturnTwo: no aliens alive
      }
      moveRefAlien();
      a = 0;
    }
    if (st.aliens[a]) {
      break;
    }
  }
  st.alienCurIndex = a;
  var c = getAlienCoords(a);
  st.alienPosYr = c.yr;
  st.alienPosXr = c.xr;
  if (c.yr < 0x28) {
    // [1971] the aliens reached the bottom: the game is over after the player's death
    st.invaded = 1;
    startInvaded();
    return;
  }
  st.alienRow = c.row;
  st.waitOnDraw = 1;
} // cursorNextAlien

// [0100] DrawAlien (RST 2)
function drawAlien() {
  if (st.alienIsExploding) {
    // [1538] AExplodeTime
    st.expAlienTimer = (st.expAlienTimer - 1) & 0xFF;
    if (st.expAlienTimer !== 0) {
      return;
    }
    eraseSimple(st.expAlienXr, st.expAlienYr, 16);
    st.shot.status = 4;
    st.alienIsExploding = 0;
    soundBits3Off(0xF7);
    return;
  }
  if (st.aliens[st.alienCurIndex]) {
    var type = ['alienOctopus', 'alienCrab', 'alienSquid'][st.alienRow >> 1];
    drawSprite(st.alienPosXr, st.alienPosYr, images[type][st.alienFrame], 16);
  }
  st.waitOnDraw = 0;
} // drawAlien

// [15F3] CountAliens
function countAliens() {
  var n = 0;
  for (var i = 0; i < 55; i++) {
    if (st.aliens[i]) {
      n++;
    }
  }
  st.numAliens = n;
} // countAliens

// [1554] Cnt16s including the WrapRef quirk [1590]
function cnt16s(a, h) {
  var c = 0;
  if (a >= h) {
    do {
      c++;
      a = (a + 16) & 0xFF;
    } while (a & 0x80);
  }
  while (a < h) {
    a = (a + 16) & 0xFF;
    c++;
  }
  return {a: a, c: c};
} // cnt16s

// [1562] FindRow: row number (0-based) and row coordinate
function findRow(yr) {
  var r = cnt16s(st.refAlienYr, yr);
  return {row: r.c - 1, yr: (r.a - 16) & 0xFF};
} // findRow

// [156F] FindColumn: column number (1-based) and column coordinate
function findColumn(xr) {
  var r = cnt16s(st.refAlienXr, xr);
  return {col: r.c, xr: (r.a - 16) & 0xFF};
} // findColumn

// [062F] FindInColumn: lowest live alien in a 1-based column, or -1
function findInColumn(col) {
  var c = col - 1;
  for (var row = 0; row < 5; row++) {
    var idx = c + 11*row;
    if (idx >= 0 && idx < 55 && st.aliens[idx]) {
      return idx;
    }
  }
  return -1;
} // findInColumn

// [1597] RackBump: flip direction and drop when the rack touches a screen edge
function rackBump() {
  if (st.rackDirection === 0) {
    if (columnHasPixels(0x3EA4)) {
      st.rackDirection = 1;
      st.refAlienDXr = 0xFE;
      st.refAlienDYr = st.rackDownDelta;
    }
  } else {
    if (columnHasPixels(0x2524)) {
      st.refAlienDXr = (st.numAliens === 1) ? 3 : 2;     // [18F1]
      st.rackDirection = 0;
      st.refAlienDYr = st.rackDownDelta;
    }
  }
} // rackBump

function columnHasPixels(addr) {   // [15C5] 23 bytes up the screen
  for (var i = 0; i < 0x17; i++) {
    if (vget(addr + i)) {
      return true;
    }
  }
  return false;
} // columnHasPixels

// ---------------------------------------------------------------- game objects
// [024B] RunGameObjs from object `from` (0 = including the player, RST 2 only)
function runGameObjs(from) {
  for (var i = from; i < objs.length; i++) {
    var o = objs[i];
    if (o.t0 !== 0 || o.t1 !== 0) {
      if (o.t1 === 0) {
        o.t0 = (o.t0 - 1) & 0xFF;
      }
      o.t1 = (o.t1 - 1) & 0xFF;
      continue;
    }
    if (o.extra !== 0) {
      o.extra--;
      continue;
    }
    o.handler();
  }
} // runGameObjs

// [028E] GameObj0: the player (RST 2 only)
function gameObj0() {
  var p = st.player;
  if (p.alive !== 0xFF) {
    // blowing up
    p.blowDelay = (p.blowDelay - 1) & 0xFF;
    if (p.blowDelay !== 0) {
      return;
    }
    st.playerOK = 0;
    st.enableAlienFire = 0;
    st.alienFireDelay = 0x30;
    p.blowDelay = 5;
    p.blowCount = (p.blowCount - 1) & 0xFF;
    if (p.blowCount !== 0) {
      // [039B] DrawPlayerDie
      p.alive = (p.alive + 1) & 1;
      p.image = 'playerExplode';
      p.frame = p.alive;
      drawSimp(p.xr, p.yr, images[p.image][p.frame], 16);
      return;
    }
    // [02AE] blow up finished
    eraseSimple(p.xr, p.yr, 16);
    st.player = newPlayerObject();
    objs[0].t0 = 0;
    objs[0].t1 = 0x80;
    objs[0].extra = 0;
    soundBits3Off(0x00);
    if (st.invaded) {
      return;
    }
    if (!st.gameMode) {
      return;
    }
    st.suspendPlay = 0;
    if (st.ships === 0) {
      startGameOver();   // [166D]
      return;
    }
    removeShip();        // [032C]
    st.suspendPlay = 1;  // [0817] EnableGameTasks
    soundBits3On(0x20);
    st.mainState = 'play';
    return;
  }
  // [033B] player is alive
  st.playerOK = 1;
  if (!st.enableAlienFire) {
    st.alienFireDelay = (st.alienFireDelay - 1) & 0xFF;
    if (st.alienFireDelay === 0) {
      st.enableAlienFire = 1;
    }
  }
  // [034A] movement: right has priority [0366]
  if (controls.right) {
    if (p.xr !== 0xD9) {
      p.xr++;
    }
  } else if (controls.left) {
    if (p.xr !== 0x30) {
      p.xr--;
    }
  }
  drawSimp(p.xr, p.yr, images[p.image][p.frame], 16);
} // gameObj0

// [03BB] GameObj1: the player's shot
function gameObj1() {
  var s = st.shot;
  if ((s.xr & 0x80) !== st.vblankStatus) {
    return;
  }
  switch (s.status) {
    case 0:
      return;
    case 1:   // [03FA] InitPlyShot
      s.status = 2;
      s.xr = (st.player.xr + 8) & 0xFF;
      drawShifted(s.xr, s.yr, images.playerShot[0], 1);
      return;
    case 2:   // [040A] MovePlyShot
      eraseShifted(s.xr, s.yr, images[s.image][0], s.size);
      s.yr = (s.yr + s.delta) & 0xFF;
      drawSprCollision(s.xr, s.yr, images[s.image][0], s.size);
      if (st.collision) {
        st.alienIsExploding = 1;
      }
      return;
    case 3:   // shot blowing up (not because of an alien)
      s.blowTimer = (s.blowTimer - 1) & 0xFF;
      if (s.blowTimer === 0) {
        endOfBlowup();
        return;
      }
      if (s.blowTimer !== 0x0F) {
        return;
      }
      eraseShifted(s.xr, s.yr, images[s.image][0], s.size);
      s.image = 'shotExplode';
      s.yr = (s.yr - 2) & 0xFF;
      s.xr = (s.xr - 3) & 0xFF;
      s.size = 8;
      drawShifted(s.xr, s.yr, images[s.image][0], s.size);
      return;
    case 5:   // alien explosion in progress
      return;
    default:  // 4: alien has exploded, remove the shot
      endOfBlowup();
  }
} // gameObj1

// [0436] EndOfBlowup: erase the shot, reset it, advance the saucer score table
function endOfBlowup() {
  var s = st.shot;
  eraseShifted(s.xr, s.yr, images[s.image][0], s.size);
  st.shot = newPlayerShot();
  st.sauScoreIdx++;
  if (st.sauScoreIdx >= 15) {      // [044C] wraps after 15 of the 16 entries (original bug)
    st.sauScoreIdx = 0;
  }
  st.shotCount = (st.shotCount + 1) & 0xFF;
  if (st.saucer.active) {
    return;
  }
  // [0462] saucer direction for its next trip
  if (st.shotCount & 1) {
    st.saucer.xr = 0x29;
    st.saucer.delta = 0x02;
  } else {
    st.saucer.xr = 0xE0;
    st.saucer.delta = 0xFE;
  }
} // endOfBlowup

// [0476] GameObj2: rolling shot (targets the player)
function gameObj2() {
  objs[2].extra = 2;
  if (st.rollingSkipFlag === 0) {
    st.rollingSkipFlag = 0xFFFF;
    return;
  }
  st.otherShot1 = st.plunger.step;
  st.otherShot2 = st.squiggly.step;
  handleAlienShot(st.rolling);
  if (st.rolling.blow === 0) {
    st.rolling = newShot(0, 0, 'rollingShot');
    st.rollingSkipFlag = 0;
    objs[2].t0 = 0;
    objs[2].t1 = 0;
    objs[2].extra = 2;
  }
} // gameObj2

// [04B6] GameObj3: plunger shot
function gameObj3() {
  if (st.skipPlunger) {
    return;
  }
  if (st.shotSync !== 1) {
    return;
  }
  st.otherShot1 = st.rolling.step;
  st.otherShot2 = st.squiggly.step;
  handleAlienShot(st.plunger);
  if (st.plunger.cfirIdx >= 0x10) {
    st.plunger.cfirIdx = 0;
  }
  if (st.plunger.blow !== 0) {
    return;
  }
  var cfir = st.plunger.cfirIdx;
  st.plunger = newShot(1, cfir, 'plungerShot');
  if (st.numAliens - 1 === 0) {
    st.skipPlunger = 1;
  }
} // gameObj3

// [0682] GameObj4: flying saucer or squiggly shot
function gameObj4() {
  if (st.shotSync !== 2) {
    return;
  }
  var sc = st.saucer;
  if (!sc.start || st.squiggly.step !== 0) {
    squigglyShot();
    return;
  }
  if (!sc.active) {
    if (st.numAliens < 8) {
      squigglyShot();
      return;
    }
    sc.active = 1;
    drawSaucer();
  }
  if ((sc.xr & 0x80) !== st.vblankStatus) {
    return;
  }
  if (sc.hit) {
    soundBits3Off(0xFE);
    sc.hitTime = (sc.hitTime - 1) & 0xFF;
    if (sc.hitTime === 0x1F) {
      // [074B] show the explosion, saucer-hit sound
      st.soundPort5 |= 0x10;
      outPort5(st.soundPort5 & 0x30);   // [1770] fleet sound off, saucer hit on
      sc.image = 'saucerExplode';
      drawSaucer();
      return;
    }
    if (sc.hitTime === 0x18) {
      // [070C] add and show the score beside the saucer
      st.adjustScore = 1;
      var value = SAUCER_SCORE_TABLE[st.sauScoreIdx];
      st.scoreDelta = (value << 4) & 0xFFFF;
      printMessage(pixAddr(sc.xr, sc.yr), SAUCER_SCORE_TEXT[value] || '   ');
      return;
    }
    if (sc.hitTime !== 0) {
      return;
    }
    st.soundPort5 &= 0xEF;
    outPort5(st.soundPort5 & 0x20);
    removeSaucer();
    return;
  }
  sc.xr = (sc.xr + sc.delta) & 0xFF;
  drawSaucer();
  if (sc.xr < 0x28 || sc.xr >= 0xE1) {
    removeSaucer();
  }
} // gameObj4

function drawSaucer() {   // [073C]
  var sc = st.saucer;
  drawSimp(sc.xr, sc.yr, images[sc.image][0], sc.size);
} // drawSaucer

function removeSaucer() { // [06F9]
  var sc = st.saucer;
  clearSmallAt(pixAddr(sc.xr, sc.yr), sc.size);
  st.saucer = newSaucer();
  soundBits3Off(0xFE);
} // removeSaucer

// [050F] the squiggly shot part of game object 4
function squigglyShot() {
  st.otherShot1 = st.plunger.step;
  st.otherShot2 = st.rolling.step;
  handleAlienShot(st.squiggly);
  if (st.squiggly.cfirIdx >= 0x15) {
    st.squiggly.cfirIdx = 6;
  }
  if (st.squiggly.blow !== 0) {
    return;
  }
  var cfir = st.squiggly.cfirIdx;
  st.squiggly = newShot(1, cfir, 'squigglyShot');
} // squigglyShot

function shotImage(s) {
  return (s.image === 'alienShotExplode') ? images.alienShotExplode[0] : images[s.image][s.frame];
} // shotImage

// [0563] HandleAlienShot: start a new shot or move the active one
function handleAlienShot(s) {
  if (!(s.status & 0x80)) {
    if (!st.enableAlienFire) {
      return;
    }
    s.step = 0;
    // not too soon after the other shots [057C]
    if (st.otherShot1 !== 0 && st.aShotReloadRate >= st.otherShot1) {
      return;
    }
    if (st.otherShot2 !== 0 && st.aShotReloadRate >= st.otherShot2) {
      return;
    }
    var col;
    if (s.track === 0) {
      // [061B] right over the player
      col = findColumn((st.player.xr + 8) & 0xFF).col;
      if (col >= 12) {
        col = 11;
      }
    } else {
      col = COL_FIRE_TABLE[s.cfirIdx] || 1;
      s.cfirIdx++;
    }
    var idx = findInColumn(col);
    if (idx < 0) {
      return;
    }
    var c = getAlienCoords(idx);
    s.yr = (c.yr - 10) & 0xFF;
    s.xr = (c.xr + 7) & 0xFF;
    s.status |= 0x80;
    s.step++;
    return;
  }
  // [05C1] move the shot
  if ((s.xr & 0x80) !== st.vblankStatus) {
    return;
  }
  if (s.status & 1) {
    shotBlowingUp(s);
    return;
  }
  s.step = (s.step + 1) & 0xFF;
  eraseShifted(s.xr, s.yr, shotImage(s), s.size);
  s.frame = (s.frame + 1) & 3;
  s.yr = (s.yr + st.alienShotDelta) & 0xFF;
  drawSprCollision(s.xr, s.yr, shotImage(s), s.size);
  if (s.yr < 0x15) {
    s.status |= 1;
    return;
  }
  if (!st.collision) {
    return;
  }
  if (s.yr >= 0x1E && s.yr < 0x27) {
    st.player.alive = 0;       // [060E] the player has been struck
  }
  s.status |= 1;
} // handleAlienShot

// [0644] ShotBlowingUp
function shotBlowingUp(s) {
  s.blow = (s.blow - 1) & 0xFF;
  if (s.blow === 3) {
    eraseShifted(s.xr, s.yr, shotImage(s), s.size);
    s.image = 'alienShotExplode';
    s.yr = (s.yr - 2) & 0xFF;
    s.xr = (s.xr - 2) & 0xFF;
    s.size = 6;
    drawSprCollision(s.xr, s.yr, shotImage(s), s.size);
    return;
  }
  if (s.blow === 0) {
    eraseShifted(s.xr, s.yr, shotImage(s), s.size);
  }
} // shotBlowingUp

// [0913] TimeToSaucer (RST 2)
function timeToSaucer() {
  if (st.refAlienYr >= 0x78) {
    return;
  }
  if (st.tillSaucer === 0) {
    st.tillSaucer = 0x0600;
    st.saucer.start = 1;
  }
  st.tillSaucer = (st.tillSaucer - 1) & 0xFFFF;
} // timeToSaucer

// ---------------------------------------------------------------- main program
// [1618] PlrFireOrDemo
function plrFire() {
  if (st.player.alive !== 0xFF) {
    return;
  }
  if (objs[0].t0 !== 0 || objs[0].t1 !== 0) {
    return;
  }
  if (st.shot.status !== 0) {
    return;
  }
  if (st.fireBounce) {
    if (!controls.fire) {
      st.fireBounce = 0;
    }
    return;
  }
  if (controls.fire) {
    st.shot.status = 1;
    st.fireBounce = 1;
  }
} // plrFire

// [14D8] PlayerShotHit
function playerShotHit() {
  var s = st.shot;
  if (s.status === 5 || s.status !== 2) {
    return;
  }
  var b = s.yr;
  if (b >= 0xD8) {
    shotMissed();
    return;
  }
  if (!st.alienIsExploding) {
    return;
  }
  if (b >= 0xCE) {
    st.saucer.hit = 1;                 // [1579]
    s.status = 4;
    st.alienIsExploding = 0;
    soundBits3Off(0xF7);
    return;
  }
  b = (b + 6) & 0xFF;
  if (st.refAlienYr < 0x90 && st.refAlienYr >= b) {
    shotMissed();
    return;
  }
  // [1504] CodeBug1: find the alien at the hit position
  var r = findRow(b);
  var c = findColumn(s.xr);
  st.expAlienYr = r.yr;
  st.expAlienXr = c.xr;
  s.status = 5;
  var idx = r.row*11 + c.col - 1;
  if (idx < 0 || idx >= 55 || !st.aliens[idx]) {
    shotMissed();
    return;
  }
  st.aliens[idx] = 0;
  scoreForAlien(r.row);
  drawSprite(st.expAlienXr, st.expAlienYr, images.alienExplode[0], 16);
  st.expAlienTimer = 0x10;
} // playerShotHit

function shotMissed() {   // [1530] -> [154A]
  st.shot.status = 3;
  st.alienIsExploding = 0;
  soundBits3Off(0xF7);
} // shotMissed

// [0A5F] ScoreForAlien
function scoreForAlien(row) {
  if (!st.gameMode) {
    return;
  }
  soundBits3On(0x08);
  st.scoreDelta = ALIEN_SCORES[row < 2 ? 0 : (row < 4 ? 1 : 2)];
  st.adjustScore = 1;
} // scoreForAlien

// [0988] AdjustScore
function adjustScore() {
  if (!st.adjustScore) {
    return;
  }
  st.adjustScore = 0;
  st.score = intToBcd(bcdToInt(st.score) + bcdToInt(st.scoreDelta));   // carry beyond 9999 is dropped
  print4Digits(0x271C, st.score);
} // adjustScore

// [170E] AShotReloadRate
function aShotReloadRate() {
  var msb = st.score >> 8;
  for (var i = 0; i < 4; i++) {
    if (RELOAD_SCORE_TABLE[i] >= msb) {
      st.aShotReloadRate = RELOAD_RATE_TABLE[i];
      return;
    }
  }
  st.aShotReloadRate = RELOAD_RATE_TABLE[4];
} // aShotReloadRate

// [0935] extra ship at 1500 (factory DIP)
function extraShip() {
  if (!st.extraShipAvailable) {
    return;
  }
  if ((st.score >> 8) < 0x15) {
    return;
  }
  st.ships++;
  drawSimpAt(0x2501 + 0x200*st.ships, images.player[0], 16);
  drawChar(0x2501, String(Math.min(st.ships + 1, 9)));
  st.extraShipAvailable = 0;
  st.extraHold = 0xFF;
  soundBits3On(0x10);
} // extraShip

// [08D8] SpeedShots
function speedShots() {
  if (st.numAliens < 9) {
    st.alienShotDelta = 0xFB;
  }
} // speedShots

// [172C] ShotSound
function shotSound() {
  if (st.shot.status !== 0) {
    soundBits3On(0x02);
  } else {
    soundBits3Off(0xFD);
  }
} // shotSound

// [1740] TimeFleetSound (RST 2)
function timeFleetSound() {
  st.fleetSndHold = (st.fleetSndHold - 1) & 0xFF;
  if (st.fleetSndHold === 0) {
    outPort5(st.soundPort5 & 0x30);
  }
  if (!st.playerOK) {
    outPort5(st.soundPort5 & 0x30);
    return;
  }
  st.fleetSndCnt = (st.fleetSndCnt - 1) & 0xFF;
  if (st.fleetSndCnt !== 0) {
    return;
  }
  outPort5(st.soundPort5);
  if (st.numAliens === 0) {
    outPort5(st.soundPort5 & 0x30);
    return;
  }
  st.fleetSndCnt = st.fleetSndReload;
  st.changeFleetSnd = 1;
  st.fleetSndHold = 4;
} // timeFleetSound

// [1775] FleetDelayExShip
function fleetDelayExShip() {
  if (st.changeFleetSnd) {
    var i = 0;
    while (i < FLEET_ALIENS.length - 1 && st.numAliens < FLEET_ALIENS[i]) {
      i++;
    }
    st.fleetSndReload = FLEET_DELAY[i];
    var tone = (st.soundPort5 & 0x0F) << 1;
    if (tone === 0x10 || tone === 0) {
      tone = 1;
    }
    st.soundPort5 = (st.soundPort5 & 0x30) | tone;
    st.changeFleetSnd = 0;
  }
  st.extraHold = (st.extraHold - 1) & 0xFF;
  if (st.extraHold === 0) {
    soundBits3Off(0xEF);
  }
} // fleetDelayExShip

// [1804] CtrlSaucerSound
function ctrlSaucerSound() {
  if (!st.saucer.active) {
    soundBits3Off(0xFE);
    return;
  }
  if (st.saucer.hit) {
    return;
  }
  soundBits3On(0x01);
} // ctrlSaucerSound

// [1A7F] RemoveShip
function removeShip() {
  if (st.ships === 0) {
    return;
  }
  var total = st.ships;
  st.ships--;
  drawNumShips(st.ships);
  drawChar(0x2501, String(total & 15));
} // removeShip

// [19E6] DrawNumShips
function drawNumShips(n) {
  var addr = 0x2701;
  for (var i = 0; i < n; i++, addr += 0x200) {
    drawSimpAt(addr, images.player[0], 16);
  }
  while ((addr >> 8) !== 0x35) {
    clearSmallAt(addr, 16);
    addr += 0x200;
  }
} // drawNumShips

// [1956] DrawStatus
function drawStatus() {
  clearScreen();
  printMessage(0x241E, ' SCORE<1> HI-SCORE SCORE<2> ');
  print4Digits(0x271C, st.score);
  print4Digits(0x2F1C, st.hiScore);
  printMessage(0x3501, 'CREDIT ');
  printMessage(0x3C01, '00');
} // drawStatus

// [00B1] InitRack
function initRack() {
  st.refAlienYr = st.p1RefAlienYr;
  st.refAlienXr = st.p1RefAlienXr;
  st.alienPosYr = st.p1RefAlienYr;
  st.alienPosXr = st.p1RefAlienXr;
  var dx = st.p1RefAlienDX;
  if (dx === 3) {
    dx = 2;
  }
  st.refAlienDXr = dx;
  st.rackDirection = (dx === 0xFE) ? 1 : 0;
} // initRack

// [0798] NewGame (one player)
function newGame() {
  st.gameMode = 1;
  st.score = 0;
  drawStatus();
  st.ships = 3;
  st.p1RefAlienDX = 2;
  st.rackCnt = 0;
  st.aliens.fill(1);
  st.p1RefAlienYr = 0x78;
  st.p1RefAlienXr = 0x38;
  copyRAMMirror();
  removeShip();
  // [088D] PromptPlayer: "PLAY PLAYER<1>", the score blinks for ~2 seconds
  printMessage(0x2B11, 'PLAY PLAYER<1>');
  st.isrDelay = 0xB0;
  st.mainState = 'prompt';
} // newGame

// [0804] start of a round: playfield, shields, rack, tasks
function startRound() {
  drawBottomLine();
  restoreShields();
  drawBottomLine();
  initRack();
  st.suspendPlay = 1;
  soundBits3On(0x20);
  st.mainState = 'play';
} // startRound

// [09EF] end of turn: all aliens gone
function waveEndFinish() {
  st.suspendPlay = 0;
  clearPlayField();
  copyRAMMirror();
  st.rackCnt = (st.rackCnt & 7) + 1;
  st.p1RefAlienYr = ALIEN_START_TABLE[st.rackCnt - 1];
  st.p1RefAlienXr = 0x38;
  st.soundPort5 = 0x21;
  st.aliens.fill(1);
  startRound();
} // waveEndFinish

// [1971] -> [16E6]: the aliens have landed
function startInvaded() {
  st.player.alive = 0;
  soundBits3On(0x04);
  st.mainState = 'invaded';
} // startInvaded

// [166D] game over: no ships left (or invaded)
function startGameOver() {
  drawChar(0x2501, '0');
  if (bcdToInt(st.score) > bcdToInt(st.hiScore)) {
    st.hiScore = st.score;
    print4Digits(0x2F1C, st.hiScore);
  }
  st.mainState = 'gameOverText';
  st.mainText = 'GAME OVER ';
  st.mainTextAddr = 0x2D18;
  st.mainTextPos = 0;
  st.isrDelay = 7;
} // startGameOver

// [081F] the game loop body
function gameLoopBody() {
  plrFire();
  playerShotHit();
  rackBump();
  countAliens();
  adjustScore();
  if (st.numAliens === 0) {
    // [09EF]/[0A3C]: wait half a second (unless the player is dying), then the next round
    st.isrDelay = 0x30;
    st.mainState = 'waveEnd';
    return;
  }
  aShotReloadRate();
  extraShip();
  speedShots();
  shotSound();
  if (st.player.alive !== 0xFF) {
    soundBits3On(0x04);
  }
  fleetDelayExShip();
  ctrlSaucerSound();
} // gameLoopBody

function mainProgram() {
  switch (st.mainState) {
    case 'prompt':
      if (st.isrDelay === 0) {
        clearPlayField();
        startRound();
        return;
      }
      if (st.isrDelay & 4) {
        clearSmallAt(0x271C, 32);
      } else {
        print4Digits(0x271C, st.score);
      }
      return;

    case 'play':
      gameLoopBody();
      return;

    case 'waveEnd':
      if (st.player.alive !== 0xFF) {
        return;   // the player is dying: the player object restarts the loop [032C]
      }
      if (st.isrDelay !== 0) {
        return;
      }
      waveEndFinish();
      return;

    case 'invaded':
      // [16EE] wait for the player's explosion to finish, then game over
      playerShotHit();
      soundBits3On(0x04);
      if (st.player.alive !== 0xFF) {
        return;
      }
      st.suspendPlay = 0;
      drawNumShips(0);
      soundBits3Off(0xFB);
      startGameOver();
      return;

    case 'gameOverText':
      // [16C9] PrintMessageDel: one letter every 6 frames
      if (st.isrDelay > 1) {
        return;
      }
      if (st.mainTextPos < st.mainText.length) {
        drawChar(st.mainTextAddr + 0x100*st.mainTextPos, st.mainText[st.mainTextPos]);
        st.mainTextPos++;
        st.isrDelay = 7;
        return;
      }
      st.isrDelay = 0x80;
      st.mainState = 'gameOverWait';
      return;

    case 'gameOverWait':
      if (st.isrDelay !== 0) {
        return;
      }
      clearPlayField();
      st.gameMode = 0;
      outPort5(0);
      st.mainState = 'ended';
      return;
  }
} // mainProgram

// ---------------------------------------------------------------- the frame
function tick() {
  // RST 1 — scanline 96 [0008]
  st.vblankStatus = 0;
  if (st.suspendPlay && st.gameMode) {
    runGameObjs(1);
    cursorNextAlien();
  }
  mainProgram();
  // RST 2 — scanline 224 [0010]
  st.vblankStatus = 0x80;
  st.isrDelay = (st.isrDelay - 1) & 0xFF;
  if (st.suspendPlay && st.gameMode) {
    timeFleetSound();
    st.shotSync = objs[2].extra;
    drawAlien();
    runGameObjs(0);
    timeToSaucer();
  }
  mainProgram();
  tickCount++;
} // tick

function postFrame() {
  var msg = {
    id: 'frame',
    tick: tickCount,
    vram: vram,
    sounds: soundEvents,
    score: bcdToInt(st.score),
    hiScore: bcdToInt(st.hiScore),
    ships: st.ships,
    wave: st.rackCnt + 1,
    state: st.mainState
  };
  soundEvents = [];
  postMessage(msg);
  if (st.mainState === 'ended' && !st.gameOverPosted) {
    st.gameOverPosted = true;
    postMessage({id: 'gameOver', score: bcdToInt(st.score), hiScore: bcdToInt(st.hiScore)});
  }
} // postFrame

function gameLoop() {
  var now = Date.now();
  if (lastTime === false) {
    lastTime = now;
  }
  accumulator += now - lastTime;
  lastTime = now;
  if (accumulator > 250) {
    accumulator = 250;   // never catch up more than a quarter of a second
  }
  var ticked = false;
  while (accumulator >= TICK_MS) {
    tick();
    accumulator -= TICK_MS;
    ticked = true;
  }
  if (ticked) {
    postFrame();
  }
  if (!pause && st.mainState !== 'ended') {
    nextLoop = setTimeout(gameLoop, Math.max(1, TICK_MS - accumulator));
  }
} // gameLoop

// headless access for the regression test (tools/regress.mjs)
if (typeof self !== 'undefined') {
  self.__si = {
    tick: tick,
    state: function() { return st; },
    objs: function() { return objs; },
    vram: vram,
    controls: controls
  };
}

onmessage = function(event) {
  switch (event.data.id) {
    case 'init':
      clearTimeout(nextLoop);
      resetData();
      initData = event.data.initData || {};
      if (initData.sprites && initData.font) {
        loadGraphics(initData.sprites, initData.font);
      }
      st.hiScore = intToBcd(initData.hiScore || 0);
      newGame();
      if (!initData.headless) {
        gameLoop();
      }
      break;

    case 'controls':
      controls[event.data.action] = event.data.value;
      break;

    case 'pause':
      pause = true;
      clearTimeout(nextLoop);
      break;

    case 'continue':
      clearTimeout(nextLoop);
      pause = false;
      lastTime = false;
      gameLoop();
      break;

    case 'reset':
      clearTimeout(nextLoop);
      nextLoop = false;
      pause = true;
      controls.left = false;
      controls.right = false;
      controls.fire = false;
      break;
  }
}; // onmessage
