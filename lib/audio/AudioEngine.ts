/**
 * Programmatic flight audio built entirely on the Web Audio API — no sample
 * files to host or download (which matters: the app is rebuilt from scratch
 * each session). Two layers cross-fade on flight state:
 *
 *   • A "chill space" ambient pad (slow chord pad + sub drone + reverb bells)
 *     whose level rises with altitude — barely there on the pad, blooming once
 *     you reach space.
 *   • A thruster layer (filtered noise + low rumble + optional tonal whine)
 *     driven by throttle, so it dominates near the ground and during burns.
 *
 * Each engine has its own voice, so the thruster morphs timbre when you stage.
 * Everything is gated behind a user gesture (the Play button) per browser
 * autoplay rules, and degrades silently where Web Audio is unsupported.
 */

import { KARMAN_LINE } from '@/lib/game/constants';

// ── Engine voices ──────────────────────────────────────────────────────────
// Each engine maps to a thruster timbre. rumble = low oscillator tone,
// noise = broadband roar shaped by a band-pass, whine = optional high tonal
// component (ion/nuclear). gain scales overall loudness.
export type EngineVoice = {
  rumbleHz: number;     // low oscillator base frequency
  noiseCutoff: number;  // band-pass centre for the roar
  noiseQ: number;       // band-pass resonance
  noiseLevel: number;   // 0-1 amount of broadband roar
  toneLevel: number;    // 0-1 amount of low rumble tone
  whineHz: number;      // high tonal component frequency (0 = none)
  whineLevel: number;   // 0-1 amount of whine
  gain: number;         // overall loudness multiplier
};

const DEFAULT_VOICE: EngineVoice = {
  rumbleHz: 60, noiseCutoff: 900, noiseQ: 0.8,
  noiseLevel: 0.5, toneLevel: 0.5, whineHz: 0, whineLevel: 0, gain: 0.9,
};

const ENGINE_VOICES: Record<string, Partial<EngineVoice>> = {
  // Sparrow — punchy, balanced first stage.
  'engine-basic':   { rumbleHz: 60,  noiseCutoff: 900,  noiseLevel: 0.5,  toneLevel: 0.5,  gain: 0.9 },
  // Comet Vac — airy, hiss-forward vacuum engine.
  'engine-vacuum':  { rumbleHz: 78,  noiseCutoff: 1700, noiseLevel: 0.72, toneLevel: 0.28, gain: 0.7 },
  // Titan Heavy — deep, brute-force core rumble.
  'engine-heavy':   { rumbleHz: 42,  noiseCutoff: 560,  noiseLevel: 0.55, toneLevel: 0.78, gain: 1.05 },
  // NERV — smooth nuclear hum with a faint reactor whine.
  'engine-nuclear': { rumbleHz: 54,  noiseCutoff: 680,  noiseLevel: 0.3,  toneLevel: 0.5,  whineHz: 320, whineLevel: 0.16, gain: 0.82 },
  // Ion Drive — near-silent electric whine, almost no roar.
  'engine-ion':     { rumbleHz: 120, noiseCutoff: 2400, noiseQ: 4, noiseLevel: 0.12, toneLevel: 0.14, whineHz: 920, whineLevel: 0.3, gain: 0.42 },
  // Side boosters — extra-loud crackle off the pad.
  'booster-solid':  { rumbleHz: 50,  noiseCutoff: 1200, noiseLevel: 0.85, toneLevel: 0.5,  gain: 1.05 },
  'booster-liquid': { rumbleHz: 46,  noiseCutoff: 820,  noiseLevel: 0.62, toneLevel: 0.72, gain: 1.05 },
  // Landers — smaller, higher descent thrusters.
  'lander-light':   { rumbleHz: 84,  noiseCutoff: 1000, noiseLevel: 0.5,  toneLevel: 0.32, gain: 0.55 },
  'lander-heavy':   { rumbleHz: 70,  noiseCutoff: 820,  noiseLevel: 0.5,  toneLevel: 0.42, gain: 0.62 },
};

export function engineVoice(id: string | undefined): EngineVoice {
  return { ...DEFAULT_VOICE, ...(id ? ENGINE_VOICES[id] : undefined) };
}

// ── Ambient music material ──────────────────────────────────────────────────
// A calm vi–IV–I–V progression voiced in the mid register so the three pad
// voices glide smoothly between chords.
const CHORDS: number[][] = [
  [220.00, 261.63, 329.63], // Am  (A3 C4 E4)
  [174.61, 261.63, 349.23], // F   (F3 C4 F4)
  [196.00, 261.63, 329.63], // C   (G3 C4 E4)
  [196.00, 246.94, 293.66], // G   (G3 B3 D4)
];
const CHORD_DUR = 14; // seconds per chord
// Pentatonic sparkle bells that drift in once you're up in space.
const BELL_SCALE = [523.25, 587.33, 659.25, 783.99, 880.00];

// Overall layer ceilings, kept conservative so the mix never clips.
const THRUSTER_LEVEL = 0.5;
const MUSIC_LEVEL = 0.5;

const SOUND_KEY = 'gravity:sound';

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Algorithmic reverb tail: decaying stereo noise as a convolution impulse. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

type PadVoice = { oscA: OscillatorNode; oscB: OscillatorNode; gain: GainNode };

export type FlightAudioParams = {
  throttle: number;   // 0-1
  altitude: number;   // km above launch surface
  firing: boolean;    // engine actually producing thrust (has fuel)
  engineId?: string;  // active engine, for timbre
};

class SpaceAudio {
  private ctx: AudioContext | null = null;
  private built = false;
  private running = false;
  private enabled = true;
  private loadedEnabled = false;
  private lastAltNorm = 0;

  // shared
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;

  // music
  private musicBus!: GainNode;
  private padFilter!: BiquadFilterNode;
  private padVoices: PadVoice[] = [];
  private chordIndex = 0;
  private chordTimer: ReturnType<typeof setInterval> | null = null;
  private bellTimer: ReturnType<typeof setTimeout> | null = null;

  // thruster
  private thrusterBus!: GainNode;
  private noiseFilter!: BiquadFilterNode;
  private noiseGain!: GainNode;
  private rumbleOsc!: OscillatorNode;
  private rumbleGain!: GainNode;
  private whineOsc!: OscillatorNode;
  private whineGain!: GainNode;

  isEnabled(): boolean {
    if (!this.loadedEnabled) {
      this.loadedEnabled = true;
      if (typeof window !== 'undefined') {
        const v = window.localStorage.getItem(SOUND_KEY);
        this.enabled = v === null ? true : v === '1';
      }
    }
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.loadedEnabled = true;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    }
    if (this.ctx && this.built) {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(on && this.running ? 1 : 0, t, 0.1);
    }
  }

  private ensureCtx(): boolean {
    if (this.ctx) return true;
    if (typeof window === 'undefined') return false;
    const Ctor = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      return true;
    } catch {
      return false;
    }
  }

  private build() {
    if (this.built || !this.ctx) return;
    const ctx = this.ctx;
    this.noiseBuf = makeNoiseBuffer(ctx, 2);

    // Master chain with a gentle limiter so layered sources never clip.
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // Shared reverb send.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3, 2.5);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.5;
    this.reverb.connect(reverbReturn).connect(this.master);

    this.buildMusic(ctx);
    this.buildThruster(ctx);
    this.built = true;
  }

  private buildMusic(ctx: AudioContext) {
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.0001;
    this.musicBus.connect(this.master);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1100;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.musicBus);

    // Send the pad into reverb for a spacious tail.
    const padSend = ctx.createGain();
    padSend.gain.value = 0.6;
    this.padFilter.connect(padSend).connect(this.reverb);

    // Slow filter sweep keeps the pad gently evolving.
    const filtLfo = ctx.createOscillator();
    filtLfo.frequency.value = 0.05;
    const filtLfoGain = ctx.createGain();
    filtLfoGain.gain.value = 350;
    filtLfo.connect(filtLfoGain).connect(this.padFilter.frequency);
    filtLfo.start();

    // Three detuned pad voices.
    const chord = CHORDS[0];
    for (let i = 0; i < 3; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0.16;
      gain.connect(this.padFilter);
      const oscA = ctx.createOscillator();
      oscA.type = 'triangle';
      oscA.frequency.value = chord[i];
      const oscB = ctx.createOscillator();
      oscB.type = 'sine';
      oscB.frequency.value = chord[i];
      oscB.detune.value = 7; // subtle chorus shimmer
      oscA.connect(gain);
      oscB.connect(gain);
      oscA.start();
      oscB.start();
      this.padVoices.push({ oscA, oscB, gain });
    }

    // Low sub drone for warmth/depth.
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 65.41; // C2
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.09;
    drone.connect(droneGain).connect(this.musicBus);
    drone.start();
  }

  private buildThruster(ctx: AudioContext) {
    this.thrusterBus = ctx.createGain();
    this.thrusterBus.gain.value = 0.0001;

    // Flicker layer: a small tremolo gives the flame some life.
    const flicker = ctx.createGain();
    flicker.gain.value = 1;
    this.thrusterBus.connect(flicker).connect(this.master);
    const flickerLfo = ctx.createOscillator();
    flickerLfo.type = 'sine';
    flickerLfo.frequency.value = 8;
    const flickerDepth = ctx.createGain();
    flickerDepth.gain.value = 0.08;
    flickerLfo.connect(flickerDepth).connect(flicker.gain);
    flickerLfo.start();

    // A touch of reverb so burns sit in the same space as the music.
    const thrSend = ctx.createGain();
    thrSend.gain.value = 0.12;
    flicker.connect(thrSend).connect(this.reverb);

    // Broadband roar.
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuf;
    noiseSrc.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 900;
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.5;
    noiseSrc.connect(this.noiseFilter).connect(this.noiseGain).connect(this.thrusterBus);
    noiseSrc.start();

    // Low rumble tone.
    this.rumbleOsc = ctx.createOscillator();
    this.rumbleOsc.type = 'sawtooth';
    this.rumbleOsc.frequency.value = 60;
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = 220;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.5;
    this.rumbleOsc.connect(rumbleLP).connect(this.rumbleGain).connect(this.thrusterBus);
    this.rumbleOsc.start();

    // Optional tonal whine (ion / nuclear).
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'triangle';
    this.whineOsc.frequency.value = 320;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.thrusterBus);
    this.whineOsc.start();
  }

  /** Start a flight: unlock the context (gesture-driven) and bring layers up. */
  start() {
    if (!this.ensureCtx()) return;
    this.build();
    const ctx = this.ctx!;
    void ctx.resume();
    this.running = true;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.isEnabled() ? 1 : 0, t, 0.1);
    this.musicBus.gain.setTargetAtTime(0.05 * MUSIC_LEVEL, t, 0.1);
    this.thrusterBus.gain.setTargetAtTime(0.0001, t, 0.05);
    this.lastAltNorm = 0;

    // Restart the chord progression and bell scheduler.
    this.chordIndex = 0;
    this.applyChord(0);
    if (this.chordTimer) clearInterval(this.chordTimer);
    this.chordTimer = setInterval(() => {
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      this.applyChord(this.chordIndex);
    }, CHORD_DUR * 1000);
    this.scheduleBell();
  }

  /** End a flight: fade both layers out and pause schedulers. */
  stop() {
    this.running = false;
    if (this.chordTimer) { clearInterval(this.chordTimer); this.chordTimer = null; }
    if (this.bellTimer) { clearTimeout(this.bellTimer); this.bellTimer = null; }
    if (!this.ctx || !this.built) return;
    const t = this.ctx.currentTime;
    this.thrusterBus.gain.setTargetAtTime(0.0001, t, 0.2);
    this.musicBus.gain.setTargetAtTime(0.0001, t, 0.6);
  }

  private applyChord(i: number) {
    if (!this.ctx) return;
    const chord = CHORDS[i];
    const t = this.ctx.currentTime;
    this.padVoices.forEach((voice, idx) => {
      const f = chord[idx];
      voice.oscA.frequency.setTargetAtTime(f, t, 2.2);
      voice.oscB.frequency.setTargetAtTime(f, t, 2.2);
    });
  }

  private scheduleBell() {
    if (this.bellTimer) clearTimeout(this.bellTimer);
    const delay = 4 + Math.random() * 8;
    this.bellTimer = setTimeout(() => {
      if (this.running && this.lastAltNorm > 0.4) this.bell();
      this.scheduleBell();
    }, delay * 1000);
  }

  private bell() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freq = BELL_SCALE[Math.floor(Math.random() * BELL_SCALE.length)];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const peak = 0.12 * this.lastAltNorm * MUSIC_LEVEL;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    osc.connect(gain).connect(pan);
    pan.connect(this.master);
    pan.connect(this.reverb);
    osc.start(t);
    osc.stop(t + 3.4);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); pan.disconnect(); };
  }

  /** Per-frame update driven by flight state. No-op until a flight starts. */
  update(p: FlightAudioParams) {
    if (!this.ctx || !this.built || !this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const thr = p.firing ? Math.max(0, Math.min(1, p.throttle)) : 0;
    const v = engineVoice(p.engineId);
    this.thrusterBus.gain.setTargetAtTime(thr * v.gain * THRUSTER_LEVEL, t, 0.05);
    this.noiseFilter.frequency.setTargetAtTime(v.noiseCutoff, t, 0.15);
    this.noiseFilter.Q.setTargetAtTime(v.noiseQ, t, 0.2);
    this.noiseGain.gain.setTargetAtTime(v.noiseLevel, t, 0.15);
    this.rumbleOsc.frequency.setTargetAtTime(v.rumbleHz, t, 0.15);
    this.rumbleGain.gain.setTargetAtTime(v.toneLevel, t, 0.15);
    this.whineOsc.frequency.setTargetAtTime(v.whineHz || 320, t, 0.2);
    this.whineGain.gain.setTargetAtTime(v.whineLevel, t, 0.2);

    // Music blooms with altitude — faint on the pad, full in space.
    const altNorm = smoothstep(p.altitude / (KARMAN_LINE * 0.85));
    this.lastAltNorm = altNorm;
    const musicTarget = (0.05 + 0.95 * altNorm) * MUSIC_LEVEL;
    this.musicBus.gain.setTargetAtTime(musicTarget, t, 0.8);
  }

  /** A short ignition whoosh layered over the thruster ramp. */
  ignite() {
    this.burst(0.45, 600, 1800, 0.5);
  }

  /** Stage separation — a quick downward whoosh. */
  stageBurst() {
    this.burst(0.5, 1600, 400, 0.6);
  }

  /** Touchdown: soft thud when landed, heavier boom when destroyed. */
  touchdown(landed: boolean) {
    if (!this.ctx || !this.built) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Cut the thruster immediately — the flight is over.
    this.thrusterBus.gain.setTargetAtTime(0.0001, t, 0.08);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const gain = ctx.createGain();
    const startF = landed ? 90 : 130;
    const dur = landed ? 0.5 : 1.1;
    const peak = landed ? 0.5 : 0.85;
    osc.frequency.setValueAtTime(startF, t);
    osc.frequency.exponentialRampToValueAtTime(landed ? 50 : 28, t + dur);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };

    // A burst of debris noise on top.
    this.burst(dur, landed ? 800 : 1400, landed ? 200 : 120, landed ? 0.25 : 0.7);
  }

  /** Shared one-shot: band-passed noise sweeping from f0 to f1 with a decay. */
  private burst(dur: number, f0: number, f1: number, level: number) {
    if (!this.ctx || !this.built) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain);
    gain.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    gain.connect(send).connect(this.reverb);
    src.start(t);
    src.stop(t + dur + 0.05);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); send.disconnect(); };
  }
}

const audio = new SpaceAudio();

/** Begin flight audio. Must be called from a user gesture (e.g. Play click). */
export function startFlightAudio() { audio.start(); }
/** Fade out and pause flight audio. */
export function stopFlightAudio() { audio.stop(); }
/** Per-frame update from flight state. */
export function updateFlightAudio(p: FlightAudioParams) { audio.update(p); }
/** Ignition whoosh. */
export function soundIgnite() { audio.ignite(); }
/** Stage-separation whoosh. */
export function soundStage() { audio.stageBurst(); }
/** Touchdown thud / crash boom. */
export function soundTouchdown(landed: boolean) { audio.touchdown(landed); }
/** Persisted mute toggle. */
export function setSoundEnabled(on: boolean) { audio.setEnabled(on); }
export function isSoundEnabled(): boolean { return audio.isEnabled(); }
