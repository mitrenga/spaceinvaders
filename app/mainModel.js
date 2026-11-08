const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ScreenEntity } = await import('./screenEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen: the worker (gameWorker.js) runs the original program at a
 * fixed 60 Hz and sends its VRAM every frame; this model shows it, routes the
 * controls (keyboard, mouse, gamepad, touch — same wiring as Manic Miner) to
 * the worker and reacts to the game over. Sound events from the worker are
 * collected for the synthesizer (SI-M7).
 */
export class MainModel extends AbstractModel {

  constructor(app, attract) {
    super(app);
    this.id = 'MainModel';

    this.attract = attract;   // TODO SI-M8: attract mode (demo game); for now a normal game
    this.screenEntity = null;
    this.soundPorts = {3: 0, 5: 0};   // last seen sound port values (edge detection)
    this.frame = null;
    this.gameOver = false;
    this.fpsEntity = null;   // dev mode only: "draw/worker FPS" (Pleiades/Stinger pattern)
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
  } // constructor

  newBorderEntity() {
    return new BorderEntity(true, this.app.controls.touchscreen.supported);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = '#000000';
    this.desktopEntity.bkColor = '#000000';

    this.screenEntity = new ScreenEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight, '#ffffff');
    this.desktopEntity.addEntity(this.screenEntity);

    if (this.app.devModeName !== false) {
      this.fpsEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, this.desktopWidth-40, this.desktopHeight-5, 40, 4, '', '#00ff00', false, {align: 'right'});
      this.desktopEntity.addEntity(this.fpsEntity);
    }

    // the menu keeps the audio closed; the game opens its buses here (MM pattern):
    // one bus per concurrently playing board sound, see audioManager.js
    ['sounds', 'kill', 'death', 'ufo', 'ufoHit', 'bonus'].forEach((bus) => {
      this.sendEvent(0, {id: 'openAudioBus', bus: bus, options: {muted: this.app.muted.sounds}});
    });
    this.sendEvent(0, {id: 'openAudioBus', bus: 'music', options: {muted: this.app.muted.music}});

    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    var data = this.app.gameData();
    this.sendWorkerMessage({id: 'init', initData: {sprites: data.sprites, font: data.font, hiScore: this.app.hiScore || 0, attract: this.attract}});
  } // init

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown

  sendWorkerMessage(event) {
    if (this.app.worker) {
      this.app.worker.postMessage(event);
    }
  } // sendWorkerMessage

  handleWorkerMessage(event) {
    switch (event.data.id) {
      case 'frame':
        this.frame = event.data;
        this.fps.workerFrames++;
        // ★ R-045: a tiky světa zvlášť, odečtené z čítače ve zprávě
        if (this.fps.lastFrame !== false) { this.fps.ticks += event.data.tick-this.fps.lastFrame; }
        this.fps.lastFrame = event.data.tick;
        this.screenEntity.setVRAM(event.data.vram);
        this.app.score = event.data.score;
        if (event.data.sounds.length) {
          this.sendEvent(0, {id: 'soundPorts', sounds: event.data.sounds});
        }
        break;
      case 'gameOver':
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.score = event.data.score;
          this.app.setModel('GameOverModel');
        }
        break;
    }
  } // handleWorkerMessage

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'soundPorts':
        this.playSoundPorts(event.sounds);
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case this.app.controls.mouse.right:
            if (this.app.controls.mouse.enable && this.app.inputEventsManager.keysMap[this.app.controls.mouse.right] === false) {
              this.sendWorkerMessage({id: 'controls', action: 'right', value: true});
            }
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left');
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right');
              return true;
            }
            break;
          case 'RetryTouch':
            this.sendWorkerMessage({id: 'controls', action: event.action, value: true});
            return true;
          case this.app.controls.keyboard.right:
          case 'GamepadRight':
            this.sendWorkerMessage({id: 'controls', action: 'right', value: true});
            return true;
          case this.app.controls.mouse.left:
            if (this.app.controls.mouse.enable && this.app.inputEventsManager.keysMap[this.app.controls.mouse.left] === false) {
              this.sendWorkerMessage({id: 'controls', action: 'left', value: true});
            }
            return true;
          case this.app.controls.keyboard.left:
          case 'GamepadLeft':
            this.sendWorkerMessage({id: 'controls', action: 'left', value: true});
            return true;
          case this.app.controls.mouse.fire:
            if (this.app.controls.mouse.enable && this.app.inputEventsManager.keysMap[this.app.controls.mouse.fire] === false) {
              this.sendWorkerMessage({id: 'controls', action: 'fire', value: true});
              break;
            }
            return true;
          case this.app.controls.keyboard.fire:
          case 'GamepadJump':
            this.sendWorkerMessage({id: 'controls', action: 'fire', value: true});
            return true;
          case this.app.controls.keyboard.sounds:
            this.app.muted.sounds = !this.app.muted.sounds;
            this.sendEvent(0, {id: 'muteAudioBus', bus: 'sounds', muted: this.app.muted.sounds});
            return true;
          case this.app.controls.keyboard.music:
            this.app.muted.music = !this.app.muted.music;
            this.sendEvent(0, {id: 'muteAudioBus', bus: 'music', muted: this.app.muted.music});
            return true;
        }
        break;

      case 'keyRelease':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          case this.app.controls.mouse.right:
            if (this.app.controls.mouse.enable && this.app.inputEventsManager.keysMap[this.app.controls.mouse.right] === false) {
              this.sendWorkerMessage({id: 'controls', action: 'right', value: false});
            }
            return true;
          case 'Touch':
            this.touchEnd(event);
            return true;
          case this.app.controls.keyboard.right:
          case 'GamepadRight':
            this.sendWorkerMessage({id: 'controls', action: 'right', value: false});
            return true;
          case this.app.controls.mouse.left:
            if (this.app.controls.mouse.enable && this.app.inputEventsManager.keysMap[this.app.controls.mouse.left] === false) {
              this.sendWorkerMessage({id: 'controls', action: 'left', value: false});
            }
            return true;
          case this.app.controls.keyboard.left:
          case 'GamepadLeft':
            this.sendWorkerMessage({id: 'controls', action: 'left', value: false});
            return true;
          case this.app.controls.mouse.fire:
            if (this.app.controls.mouse.enable && this.app.inputEventsManager.keysMap[this.app.controls.mouse.fire] === false) {
              this.sendWorkerMessage({id: 'controls', action: 'fire', value: false});
            }
            return true;
          case this.app.controls.keyboard.fire:
          case 'GamepadJump':
            this.sendWorkerMessage({id: 'controls', action: 'fire', value: false});
            return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /**
   * Drives the synthesizer from the board's sound port writes (GAME-DESIGN 2.10):
   * port 3: bit 0 UFO (loops while set), 1 shot, 2 player death, 3 invader
   * killed, 4 extra ship; port 5: bits 0-3 fleet steps, 4 saucer hit. A rising
   * edge triggers the one-shot sounds; the UFO loop starts and stops with its bit.
   */
  playSoundPorts(events) {
    events.forEach((e) => {
      var prev = this.soundPorts[e.port];
      var rising = e.value & ~prev;
      var falling = prev & ~e.value;
      this.soundPorts[e.port] = e.value;
      if (e.port == 3) {
        if (rising & 0x01) {
          this.sendEvent(0, {id: 'playSound', bus: 'ufo', sound: 'ufo', options: {repeat: true}});
        }
        if (falling & 0x01) {
          this.sendEvent(0, {id: 'stopAudioBus', bus: 'ufo'});
        }
        if (rising & 0x02) {
          this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'shot', options: false});
        }
        if (rising & 0x04) {
          this.sendEvent(0, {id: 'playSound', bus: 'death', sound: 'playerDeath', options: false});
        }
        if (rising & 0x08) {
          this.sendEvent(0, {id: 'playSound', bus: 'kill', sound: 'invaderKilled', options: false});
        }
        if (rising & 0x10) {
          this.sendEvent(0, {id: 'playSound', bus: 'bonus', sound: 'extraShip', options: false});
        }
      } else if (e.port == 5) {
        for (var bit = 0; bit < 4; bit++) {
          if (rising & (1 << bit)) {
            this.sendEvent(0, {id: 'playSound', bus: 'music', sound: 'fleet'+(bit+1), options: false});
          }
        }
        if (rising & 0x10) {
          this.sendEvent(0, {id: 'playSound', bus: 'ufoHit', sound: 'ufoHit', options: false});
        }
      }
    });
  } // playSoundPorts

  // pause the worker and open the pause menu (RESUME / SOUNDS / MUSIC / EXIT GAME)
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.sendEvent(0, {id: 'pauseAllAudioBuses'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 36, 86, 153, 85, 'PAUSE GAME', 'MenuModel'));
  } // pauseGame

  touchStart(event, side) {
    var ts = this.app.controlsOptions.touchscreen.types[this.app.controls.touchscreen.type][side];
    if (ts.type == 'button') {
      this.sendWorkerMessage({id: 'controls', action: ts.action, value: true});
    }
    this.app.inputEventsManager.touchesGameControls[event.identifier] = {center: {x: event.x, y: event.y}, type: ts.type, control: ts.control, action: ts.action, actions: ts.actions};
  } // touchStart

  touchEnd(event) {
    var tgc = this.app.inputEventsManager.touchesGameControls;
    if (event.identifier in tgc) {
      if (tgc[event.identifier].action !== false) {
        this.sendWorkerMessage({id: 'controls', action: tgc[event.identifier].action, value: false});
      }
      delete tgc[event.identifier];
    }
  } // touchEnd

  touchMove(event) {
    var tgc = this.app.inputEventsManager.touchesGameControls;
    if (!(event.identifier in tgc)) {
      return;
    }
    var control = tgc[event.identifier];
    var action = control.action;
    if (control.type == 'joystick' && control.control == 'horizontal') {
      if (event.x-control.center.x < -10) {
        action = control.actions[0];
        control.center.x = event.x;
      }
      if (event.x-control.center.x > 10) {
        action = control.actions[1];
        control.center.x = event.x;
      }
      if (control.action !== action) {
        if (control.action !== false) {
          this.sendWorkerMessage({id: 'controls', action: control.action, value: false});
        }
        control.action = action;
        this.sendWorkerMessage({id: 'controls', action: control.action, value: true});
      }
    }
  } // touchMove

  // the game screen is monochrome; the cellophane overlay is multiplied over it
  drawModel() {
    super.drawModel();
    this.app.layout.paintOverlay(this);
  } // drawModel

  /**
   * Dev-mode indicator "xx/yy FPS": xx = frames drawn by the model per second
   * (requestAnimationFrame rate), yy = 'frame' messages received from the
   * worker per second (the fixed 60 Hz game tick; lower = worker paused or
   * not keeping up).
   */
  updateFps(timestamp) {
    if (!this.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      var draw = Math.round(this.fps.frames*1000/elapsed);
      var worker = Math.round(this.fps.workerFrames*1000/elapsed);
      var ticks = Math.round(this.fps.ticks*1000/elapsed);
      this.fpsEntity.setText(draw+'/'+worker+'/'+ticks+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    this.updateFps(timestamp);
    this.drawModel();
  } // loopModel

} // MainModel
