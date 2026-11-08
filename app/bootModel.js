const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ScreenEntity } = await import('./screenEntity.js?ver='+window.srcVersion);
// begin code

/**
 * Boot model of the remake — the counterpart of svision's ZXResetModel on the
 * 224x256 monitor of the game. Space Invaders has no power-on sequence to show
 * (the reset clears the RAM and goes straight to the attract mode), so the
 * boot plays the opening of the attract mode instead, the one everybody knows
 * (GAME-DESIGN chap. 2.9, L_0AEA): "PLAY" typed with an upside-down Y, "SPACE
 * INVADERS" typed under it, the score advance table, then the small alien comes in from the right,
 * drags the wrong Y off the screen, comes back pushing the right one into
 * place and is wiped. Then the copyright line, and the menu.
 *
 * Positions, timing and sprites are the original's: the texts at 3017h and
 * 2B14h with 7 frames between letters (PrintMessageDel 0A93h), the alien on
 * the PLAY row (Yr B8h) moving one pixel a frame (SplashSprite 1868h, called
 * from the mid-screen interrupt) between the Xr of the three descriptors
 * (1A95h, 1BB0h, 1FC9h; screen x = Xr - 32), its two image forms swapping
 * every four steps, one second pauses (64 frames) between the moves, and the
 * ten-column wipe of ClearSmallSprite at 33B7h; in between, the SCORE ADVANCE
 * TABLE of DrawAdvTable (1815h) with the four sprites and their point lines
 * typed out. The demo game of the attract is left out — this is a boot.
 *
 * The picture is composed into a VRAM image of the original layout (7 KiB,
 * 2400h-3FFFh) and shown by the same ScreenEntity as the game, with the
 * cellophane overlay of the platform over it. Nothing here touches the game
 * worker; the glyphs and sprites come from data/font.json and
 * data/sprites.json, the ROM conversions the game itself draws from.
 */
export class BootModel extends AbstractModel {

  /**
   * @param {Object} app - The application instance.
   * @param {string} copyright - The copyright text shown after the animation.
   */
  constructor(app, copyright) {
    super(app);
    this.id = 'BootModel';

    this.copyright = copyright;
    this.font = null;
    this.sprites = null;
    this.vram = new Uint8Array(0x1C00);
    this.screenEntity = null;
    this.copyrightEntity = null;
    this.script = null;
    this.startTime = false;
    this.frame = 0;
    this.finished = false;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = '#000000';
    this.desktopEntity.bkColor = '#000000';

    this.screenEntity = new ScreenEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight, '#ffffff');
    this.screenEntity.setVRAM(this.vram);
    this.desktopEntity.addEntity(this.screenEntity);

    this.copyrightEntity = new TextEntity(this.desktopEntity, this.app.fonts.spaceInvadersFonts8x8Prop, 0, this.desktopHeight-14, this.desktopWidth, 8,
      this.copyright.replace(/⋅/g, '-'), ZXColor.white, false, {align: 'center'});
    this.copyrightEntity.hide = true;
    this.desktopEntity.addEntity(this.copyrightEntity);

    // the ROM conversions the game draws from (GameApp.gameData unwraps the
    // {font: ...} / {sprites: ...} files); without them there is nothing to animate
    var data = this.app.gameData();
    if (data.font && data.font.glyphs && data.sprites && data.sprites.alienSquid) {
      this.font = data.font;
      this.sprites = data.sprites;
      this.sendEvent(500, {id: 'showBoot'});
    } else {
      this.sendEvent(500, {id: 'showCopyright'});
    }
  } // init

  // ---------------------------------------------------------------- the picture
  /** sets or clears one pixel of the VRAM image (screen coordinates) */
  plot(x, y, on) {
    if (x < 0 || x >= 224 || y < 0 || y >= 256) {
      return;
    }
    var h = 255-y;
    var i = x*32+(h >> 3), bit = 1 << (h & 7);
    this.vram[i] = on ? (this.vram[i] | bit) : (this.vram[i] & ~bit);
  } // plot

  /** a grid of '#' rows, overwriting its rectangle like DrawSprite (15D3h) */
  blit(grid, x, y) {
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        this.plot(x+c, y+r, grid[r][c] === '#');
      }
    }
    this.screenEntity.invalidate();
  } // blit

  clearRect(x, y, width, height) {
    for (var r = 0; r < height; r++) {
      for (var c = 0; c < width; c++) {
        this.plot(x+c, y+r, false);
      }
    }
    this.screenEntity.invalidate();
  } // clearRect

  /** one character of the ROM font; '⅄' is the upside-down Y (the 'y' of data/font.json) */
  drawChar(ch, x, y) {
    var glyph = this.font.glyphs[ch === '⅄' ? 'y' : ch] || this.font.glyphs[' '];
    this.blit(glyph, x, y);
  } // drawChar

  /** PrintMessage (08F3h): a whole string at once, 8 px a character */
  drawText(str, x, y) {
    for (var i = 0; i < str.length; i++) {
      this.drawChar(str[i], x+8*i, y);
    }
  } // drawText

  /**
   * One frame of a sprite; `fromColumn`/`columns` take a slice of it, the way
   * the advance table draws 16 bytes out of the middle of the saucer.
   */
  drawSprite(name, x, y, frame, fromColumn, columns) {
    var sprite = this.sprites[name];
    var grid = sprite.sprite[frame % sprite.sprite.length];
    if (fromColumn !== undefined) {
      grid = grid.map((row) => row.substring(fromColumn, fromColumn+columns));
      x += fromColumn;
    }
    this.blit(grid, x, y);
  } // drawSprite

  // ---------------------------------------------------------------- the script
  /**
   * The animation as a generator: every `yield` is one frame of the original
   * (60 Hz). loopModel steps it as many times as frames have elapsed.
   */
  *bootScript() {
    var i;

    // PrintMessageDel: a letter, then 7 frames
    var play = 'PLA⅄';                                   // MessagePlayUY 1CFAh at 3017h
    for (i = 0; i < play.length; i++) {
      this.drawChar(play[i], 96+8*i, 64);
      yield* this.wait(7);
    }
    var name = 'SPACE  INVADERS';                        // 1DAFh at 2B14h
    for (i = 0; i < name.length; i++) {
      this.drawChar(name[i], 56+8*i, 88);
      yield* this.wait(7);
    }
    yield* this.wait(64);                                // OneSecDelay

    // DrawAdvTable (1815h): the heading and the four sprites at once, then the
    // four point lines typed; TwoSecDelay after it (0B14h)
    this.drawText('*SCORE ADVANCE TABLE*', 32, 120);    // 1CA3h at 2810h
    this.drawSprite('saucer', 60, 136, 0, 4, 16);        // 1D68h = the saucer 4 columns in, 16 wide
    this.drawSprite('alienSquid', 64, 152, 0);           // 1C20h alien C, form 0
    this.drawSprite('alienCrab', 64, 168, 1);            // 1C40h alien B, form 1
    this.drawSprite('alienOctopus', 64, 184, 0);         // 1C00h alien A, form 0
    var lines = ['=? MYSTERY', '=30 POINTS', '=20 POINTS', '=10 POINTS'];   // 1DCFh: at 2E0Eh, 2E0Ch, 2E0Ah, 2E08h
    for (i = 0; i < lines.length; i++) {
      for (var j = 0; j < lines[i].length; j++) {
        this.drawChar(lines[i][j], 80+8*j, 136+16*i);
        yield* this.wait(7);
      }
    }
    yield* this.wait(128);                               // TwoSecDelay

    // 1A95h: the small alien (AlienSprA 1C20h) from Xr FEh to 9Eh on the PLAY row
    yield* this.move('alienSquid', 222, 126, -1);       // last drawn at 127
    // 1BB0h: pulling the upside-down Y (1BA0h / 1BD0h) from Xr 98h off the right edge;
    // the pulling image sits 6 px left of where the small alien stopped, so the
    // small alien is wiped first
    this.clearRect(127, 64, 16, 8);
    yield* this.move('splashAlienPullY', 120, 223, 1, 'splashAlienPushY');
    yield* this.wait(64);
    // 1FC9h: pushing the right Y (1F80h / 1FB0h) back from the edge to Xr 97h
    yield* this.move('splashAlienA', 223, 119, -1, 'splashAlienB');   // last drawn at 120, form A
    yield* this.wait(64);
    // ClearSmallSprite at 33B7h, 10 rows: the alien goes, the Y it pushed stays
    this.clearRect(125, 64, 10, 8);
    yield* this.wait(60);
  } // bootScript

  *wait(frames) {
    for (var f = 0; f < frames; f++) {
      yield;
    }
  } // wait

  /**
   * SplashSprite (1868h), one call a frame: the form counter goes up, the step
   * is added, and on reaching the target the routine flags it and returns
   * without drawing — so the sprite is last seen one step short of the target
   * (which is what puts the alien's arm under the ten-column wipe at the end).
   * The image is the base one while bit 2 of the counter is set, the alternate
   * (+30h: the second sprite here, or the second frame of the first) while it
   * is clear. The sprite is 16x8 and overwrites its rectangle, so the step
   * behind it is wiped first.
   */
  *move(spriteA, from, to, step, spriteB) {
    var x = from, form = 0;
    for (;;) {
      form++;
      var behind = x;
      x += step;
      if (x === to) {
        return;
      }
      var alternate = (form & 4) === 0;
      var name = (alternate && spriteB) ? spriteB : spriteA;
      var frame = (alternate && !spriteB) ? 1 : 0;
      this.clearRect(behind, 64, 16, 8);
      this.drawSprite(name, x, 64, frame);
      yield;
    }
  } // move

  // ---------------------------------------------------------------- events
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'showBoot':
        this.script = this.bootScript();
        this.startTime = this.app.now;
        this.frame = 0;
        // safety net: the script is about 11 s long
        this.sendEvent(20000, {id: 'showCopyright'});
        return true;
      case 'showCopyright':
        if (this.finished) {
          return true;
        }
        this.finished = true;
        this.cancelEvent('showCopyright');
        this.script = null;
        this.screenEntity.hide = true;
        this.copyrightEntity.hide = false;
        this.drawModel();
        this.sendEvent(1200, {id: 'setMenuModel'});
        return true;
      case 'setMenuModel':
        // not before the application data has come or failed
        // (AbstractApp.appDataPending): on a slow line the boot stays
        if (this.app.appDataPending()) {
          this.sendEvent(100, {id: 'setMenuModel'});
          return true;
        }
        this.app.setModel('MenuModel');
        return true;
      case 'keyPress':
        // any key, mouse button or touch ends the boot at once: the animation
        // stops where it is and the menu comes up
        if (this.desktopEntity.modalEntity) {
          break;
        }
        this.finished = true;
        this.script = null;
        this.cancelEvent('showCopyright');
        this.cancelEvent('setMenuModel');
        this.sendEvent(0, {id: 'menuWhenReady'});
        return true;
      case 'menuWhenReady':
        // a key can end the boot before the application data have arrived:
        // the menu waits for the request to be over (AbstractApp.appDataPending,
        // however long a slow line takes), then comes up at once
        if (this.app.appDataPending()) {
          this.sendEvent(100, {id: 'menuWhenReady'});
        } else {
          this.app.setModel('MenuModel');
        }
        return true;
      case 'retryLoadAppData':
        // sent by the error panel's RETRY button: reload the application data
        // and retry the menu handover once the request is over (setMenuModel
        // waits for it; offline there is none and the app falls back to
        // storage at once)
        this.app.loadAppData();
        this.sendEvent(0, {id: 'setMenuModel'});
        return true;
    }

    return false;
  } // handleEvent

  /** steps the script at 60 Hz, however fast the display runs */
  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.script !== null) {
      var due = Math.floor((timestamp-this.startTime)*60/1000);
      var guard = 0;
      while (this.frame < due && this.script !== null && guard < 10) {
        this.frame++;
        guard++;
        var step = this.script.next();
        if (step.done) {
          this.sendEvent(0, {id: 'showCopyright'});
          break;
        }
      }
      if (this.frame < due) {
        this.startTime = timestamp-this.frame*1000/60;   // fell behind (tab hidden): do not rush
      }
    }
    this.drawModel();
  } // loopModel

  // the monitor is monochrome; the cellophane overlay is multiplied over it (MainModel)
  drawModel() {
    super.drawModel();
    if (this.screenEntity && !this.screenEntity.hide) {
      this.app.layout.paintOverlay(this);
    }
  } // drawModel

} // BootModel
