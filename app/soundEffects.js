// begin code

/**
 * The nine analog sounds of the Space Invaders board (SN76477 + discrete
 * circuits; GAME-DESIGN chap. 2.10 and 7) as scores for the svision
 * AudioOscillatorHandler. Tuned by ear and by measurement against the MAME
 * reference samples in sources/sound (pitch by autocorrelation, envelope by
 * RMS; tools in the M7 notes):
 *   shot         2.6 kHz -> 2.4 kHz noisy tone, 0.3 s              (port 3 bit 1, sample 1)
 *   playerDeath  0.7 s low noisy rumble                            (port 3 bit 2, sample 2)
 *   invaderKilled two falling sweeps 0.35 s                        (port 3 bit 3, sample 3)
 *   fleet1-4     four ~70 ms bass thumps 69/60/56/52 Hz             (port 5 bits 0-3, samples 4-7)
 *   ufo          490 Hz warbling loop, 0.5 s period                 (port 3 bit 0, sample 0)
 *   ufoHit       2.2 s siren: pitch swinging 1.1 kHz <-> 450 Hz     (port 5 bit 4, sample 8)
 *   extraShip    the UFO circuit retriggered for a second           (port 3 bit 4, sample 9)
 * Tempo 1200 => one tick = 12.5 ms, so note starts can be placed precisely.
 */
var TEMPO = 1200;

function score(instruments, tracks, volume, repeat) {
  return {tempo: TEMPO, volume: volume, defaultDuration: 1, instruments: instruments, tracks: tracks, repeat: repeat || false};
} // score

export function createShotScore() {
  return score({
    tone: {
      class: 'OscillatorInstrument',
      osc: [{type: 'square'}, {type: 'sawtooth', detune: 12, gain: 0.5}],
      pitchEnv: {from: 2650, to: 2350, decay: 0.3},
      filter: {type: 'lowpass', freq: 3200, Q: 0.7},
      env: {attack: 0.002, decay: 0.32, sustain: 0},
      gain: 0.35
    },
    hiss: {
      class: 'NoiseInstrument',
      filter: {type: 'bandpass', freq: 2600, Q: 1.2},
      env: {attack: 0.002, decay: 0.28, sustain: 0},
      gain: 0.45
    }
  }, [
    {instrument: 'tone', pattern: [[{tick: 0, pitch: 2600}]]},
    {instrument: 'hiss', pattern: [[{tick: 0}]]}
  ], 0.5);
} // createShotScore

export function createPlayerDeathScore() {
  return score({
    rumble: {
      class: 'NoiseInstrument',
      filterEnv: {type: 'lowpass', from: 1800, to: 250, decay: 0.7, Q: 0.8},
      env: {attack: 0.005, decay: 0.72, sustain: 0},
      gain: 0.9
    },
    crackle: {
      class: 'NoiseInstrument',
      noise: 'crackle',
      noiseDensity: 0.08,
      filter: {type: 'bandpass', freq: 600, Q: 0.6},
      env: {attack: 0.005, decay: 0.6, sustain: 0},
      gain: 0.7
    }
  }, [
    {instrument: 'rumble', pattern: [[{tick: 0}]]},
    {instrument: 'crackle', pattern: [[{tick: 0}]]}
  ], 0.6);
} // createPlayerDeathScore

export function createInvaderKilledScore() {
  return score({
    sweep1: {
      class: 'OscillatorInstrument',
      osc: [{type: 'sawtooth'}, {type: 'square', detune: -8, gain: 0.5}],
      pitchEnv: {from: 1300, to: 380, decay: 0.09},
      filter: {type: 'lowpass', freq: 2500},
      env: {attack: 0.002, decay: 0.1, sustain: 0},
      gain: 0.45
    },
    sweep2: {
      class: 'OscillatorInstrument',
      osc: [{type: 'sawtooth'}, {type: 'square', detune: -8, gain: 0.5}],
      pitchEnv: {from: 1750, to: 600, decay: 0.16},
      filter: {type: 'lowpass', freq: 2500},
      env: {attack: 0.002, decay: 0.18, sustain: 0},
      gain: 0.4
    },
    sweep3: {
      class: 'OscillatorInstrument',
      osc: [{type: 'sawtooth'}],
      pitchEnv: {from: 1900, to: 900, decay: 0.08},
      filter: {type: 'lowpass', freq: 2500},
      env: {attack: 0.002, decay: 0.1, sustain: 0},
      gain: 0.12
    }
  }, [
    {instrument: 'sweep1', pattern: [[{tick: 0, pitch: 1000}]]},
    {instrument: 'sweep2', pattern: [[{tick: 7, pitch: 1000}]]},
    {instrument: 'sweep3', pattern: [[{tick: 21, pitch: 1000}]]}
  ], 0.5);
} // createInvaderKilledScore

var FLEET_PITCH = [69.3, 60.2, 56.2, 52.1];

export function createFleetScore(step) {
  return score({
    thump: {
      class: 'OscillatorInstrument',
      osc: [{type: 'square'}, {type: 'sawtooth', gain: 0.6}],
      filter: {type: 'lowpass', freq: 420, Q: 1.5},
      env: {attack: 0.003, decay: 0.075, sustain: 0},
      gain: 0.9
    }
  }, [
    {instrument: 'thump', pattern: [[{tick: 0, pitch: FLEET_PITCH[step]}]]}
  ], 0.8);
} // createFleetScore

// the four steps in a row (SETTINGS > MUSIC sample)
export function createFleetMarchScore() {
  return score({
    thump: {
      class: 'OscillatorInstrument',
      osc: [{type: 'square'}, {type: 'sawtooth', gain: 0.6}],
      filter: {type: 'lowpass', freq: 420, Q: 1.5},
      env: {attack: 0.003, decay: 0.075, sustain: 0},
      gain: 0.9
    }
  }, [
    {instrument: 'thump', pattern: [FLEET_PITCH.map(function(p, i) { return {tick: i*40, pitch: p}; })]}
  ], 0.8);
} // createFleetMarchScore

export function createUfoScore() {
  return score({
    warble: {
      class: 'OscillatorInstrument',
      osc: [{type: 'square'}, {type: 'triangle', gain: 0.7}],
      lfo: {rate: 2.0, depth: 420},
      filter: {type: 'lowpass', freq: 1600, Q: 1.0},
      env: {attack: 0.01, decay: 0.05, sustain: 1.0, release: 0.05},
      gain: 0.35
    }
  }, [
    {instrument: 'warble', pattern: [[{tick: 0, pitch: 490, dur: 40}]]}
  ], 0.45, true);
} // createUfoScore

export function createUfoHitScore() {
  return score({
    siren: {
      class: 'OscillatorInstrument',
      osc: [{type: 'square'}, {type: 'sawtooth', detune: 6, gain: 0.5}],
      lfo: {rate: 0.75, depth: 800},
      filter: {type: 'lowpass', freq: 2200, Q: 1.0},
      env: {attack: 0.05, decay: 2.2, sustain: 0},
      gain: 0.5
    },
    burst: {
      class: 'NoiseInstrument',
      filterEnv: {type: 'lowpass', from: 3000, to: 400, decay: 0.5},
      env: {attack: 0.002, decay: 0.5, sustain: 0},
      gain: 0.5
    }
  }, [
    {instrument: 'siren', pattern: [[{tick: 0, pitch: 720}]]},
    {instrument: 'burst', pattern: [[{tick: 0}]]}
  ], 0.5);
} // createUfoHitScore

export function createExtraShipScore() {
  return score({
    warble: {
      class: 'OscillatorInstrument',
      osc: [{type: 'square'}, {type: 'triangle', gain: 0.7}],
      lfo: {rate: 6.0, depth: 300},
      filter: {type: 'lowpass', freq: 1800, Q: 1.0},
      env: {attack: 0.01, decay: 0.9, sustain: 0},
      gain: 0.35
    }
  }, [
    {instrument: 'warble', pattern: [[{tick: 0, pitch: 560}]]}
  ], 0.45);
} // createExtraShipScore
