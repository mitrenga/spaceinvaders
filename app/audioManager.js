const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioOscillatorHandler } = await import('./svision/js/audio/audioOscillatorHandler.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { createShotScore, createPlayerDeathScore, createInvaderKilledScore, createFleetScore, createFleetMarchScore, createUfoScore, createUfoHitScore, createExtraShipScore } = await import('./soundEffects.js?ver='+window.srcVersion);
// begin code

/**
 * Audio manager: every sound is synthesized in real time by the svision
 * AudioOscillatorHandler (Web Audio oscillators, noise, filters, envelopes;
 * the same engine Endless Universe uses). One handler plays one score at a
 * time, so each sound of the board that can play concurrently has its own bus:
 *   sounds  the player's shot (also the SETTINGS > SOUNDS sample)
 *   kill    invader killed        death   the player's death
 *   ufo     the flying saucer loop ufoHit  saucer hit
 *   bonus   extra ship
 *   music   the fleet march (four bass steps; SETTINGS > MUSIC sample)
 * All effect buses follow the 'sounds' user level and mute state, the fleet
 * march follows 'music' (the original's "music" is nothing but the march).
 */
var EFFECT_BUSES = ['sounds', 'kill', 'death', 'ufo', 'ufoHit', 'bonus'];

export class AudioManager extends AbstractAudioManager {

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.sounds = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 7)))));
    this.volume.music = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusMusicLevel', 7)))));
    this.latencyHint = 'interactive';
  } // constructor

  static get effectBuses() {
    return EFFECT_BUSES;
  } // effectBuses

  // the user level a bus follows
  volumeKey(bus) {
    return (bus === 'music') ? 'music' : 'sounds';
  } // volumeKey

  createAudioHandler(bus, options) {
    return new AudioOscillatorHandler(this.app);
  } // createAudioHandler

  volumeFactor(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume]/levels[10];
  } // volumeFactor

  openBus(bus, options) {
    super.openBus(bus, options);
    this.refreshVolume(bus);
    this.muteBus(bus, ('muted' in options) ? options.muted : false);
  } // openBus

  refreshVolume(bus) {
    var handler = this.buses[bus];
    if (handler === undefined) {
      return;
    }
    handler.setBusVolume(this.volumeFactor(this.volume[this.volumeKey(bus)]));
  } // refreshVolume

  // muting 'sounds' mutes every effect bus
  muteBus(bus, muted) {
    if (bus === 'sounds') {
      EFFECT_BUSES.forEach((b) => super.muteBus(b, muted));
      return;
    }
    super.muteBus(bus, muted);
  } // muteBus

  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }
    switch (sound) {
      case 'shot':
      case 'exampleShotSound': return createShotScore();
      case 'playerDeath': return createPlayerDeathScore();
      case 'invaderKilled': return createInvaderKilledScore();
      case 'fleet1': return createFleetScore(0);
      case 'fleet2': return createFleetScore(1);
      case 'fleet3': return createFleetScore(2);
      case 'fleet4': return createFleetScore(3);
      case 'exampleFleetSound': return createFleetMarchScore();
      case 'ufo': return createUfoScore();
      case 'ufoHit': return createUfoHitScore();
      case 'extraShip': return createExtraShipScore();
    }
    return false;
  } // audioData

} // AudioManager
