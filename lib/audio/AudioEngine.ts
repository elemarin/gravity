/**
 * Programmatic flight audio built entirely on the Web Audio API — no sample
 * files to host or download (which matters: the app is rebuilt from scratch
 * each session). Two layers play together:
 *
 *   • A melodic "keyboard" score (gentle arpeggiated keys + a soft warm pad)
 *     inspired by the calm, uplifting tone of Minecraft. Every world has its
 *     own theme — key, mode and tempo — that plays while you are in its orbit
 *     or atmosphere; the deep-space cruise between worlds drops to a sparser,
 *     quieter version of the same idea so space stays chill but never silent.
 *   • A thruster layer (filtered noise + low rumble + optional tonal whine)
 *     driven by throttle, so it dominates near the ground and during burns and
 *     gently ducks the music while you hold the throttle down.
 *
 * Each engine has its own voice, so the thruster morphs timbre when you stage.
 * Everything is gated behind a user gesture (the Play button) per browser
 * autoplay rules, and degrades silently where Web Audio is unsupported.
 */

import { SOLAR_BODIES } from '@/lib/game/bodies';

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

// ── Per-world musical themes ────────────────────────────────────────────────
// Gentle, uplifting keyboard music in the spirit of Minecraft. Each theme is a
// key + mode + chord progression + tempo, from which a soft arpeggiator draws a
// flowing melody over a warm pad. Distinct roots, modes and tempos give every
// world its own mood; the deep-space cruise uses a sparse, quiet, low variant.

const MODES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
};

type Theme = {
  rootMidi: number; // tonic note (MIDI; 60 = middle C)
  mode: number[];   // scale intervals from the tonic
  prog: number[];   // chord roots as scale-degree indices, one per bar
  stepMs: number;   // time between arpeggio notes (tempo + spaciousness)
  level: number;    // overall loudness (0-1)
  bright: number;   // tone/pad brightness (0-1)
  melOct: number;   // octaves to lift the melody above the pad
};

// Keyed by body id (plus 'deepspace' for the cruise). Worlds without a hand
// tuned theme fall back to deep space, so new bodies still get music.
const THEMES: Record<string, Theme> = {
  // Home — warm, hopeful C major (I–V–vi–IV).
  earth:    { rootMidi: 60, mode: MODES.major,      prog: [0, 4, 5, 3], stepMs: 300, level: 0.55, bright: 0.62, melOct: 1 },
  // Lonely but pretty A-minor, slow and sparse.
  moon:     { rootMidi: 57, mode: MODES.minor,      prog: [0, 5, 3, 4], stepMs: 420, level: 0.42, bright: 0.42, melOct: 1 },
  // Bright, quick, shimmering lydian D.
  mercury:  { rootMidi: 62, mode: MODES.lydian,     prog: [0, 1, 4, 0], stepMs: 250, level: 0.46, bright: 0.82, melOct: 1 },
  // Lush, mysterious, thick lydian E♭.
  venus:    { rootMidi: 63, mode: MODES.lydian,     prog: [0, 3, 4, 5], stepMs: 380, level: 0.5,  bright: 0.55, melOct: 1 },
  // Adventurous dorian G.
  mars:     { rootMidi: 55, mode: MODES.dorian,     prog: [0, 3, 4, 3], stepMs: 300, level: 0.5,  bright: 0.5,  melOct: 1 },
  // Tiny, high, twinkling.
  phobos:   { rootMidi: 64, mode: MODES.major,      prog: [0, 4, 5, 4], stepMs: 360, level: 0.36, bright: 0.72, melOct: 1 },
  // Cold, distant minor.
  ceres:    { rootMidi: 59, mode: MODES.minor,      prog: [0, 5, 6, 4], stepMs: 440, level: 0.36, bright: 0.36, melOct: 1 },
  // Grand, broad, regal mixolydian F.
  jupiter:  { rootMidi: 53, mode: MODES.mixolydian, prog: [0, 3, 4, 0], stepMs: 360, level: 0.52, bright: 0.46, melOct: 1 },
  // Serene, floating lydian B♭.
  saturn:   { rootMidi: 58, mode: MODES.lydian,     prog: [0, 4, 1, 4], stepMs: 400, level: 0.46, bright: 0.52, melOct: 1 },
  // Hazy, exotic dorian C♯.
  titan:    { rootMidi: 61, mode: MODES.dorian,     prog: [0, 6, 3, 4], stepMs: 360, level: 0.42, bright: 0.4,  melOct: 1 },
  // Icy, crystalline, high lydian.
  uranus:   { rootMidi: 68, mode: MODES.lydian,     prog: [0, 4, 5, 1], stepMs: 300, level: 0.42, bright: 0.85, melOct: 1 },
  // Deep, vast, slow minor at the edge of the system.
  neptune:  { rootMidi: 50, mode: MODES.minor,      prog: [0, 5, 3, 6], stepMs: 460, level: 0.44, bright: 0.4,  melOct: 2 },
  // The cruise — quiet, sparse, low; chill but always present.
  deepspace:{ rootMidi: 45, mode: MODES.dorian,     prog: [0, 3, 4, 0], stepMs: 620, level: 0.3,  bright: 0.32, melOct: 2 },
};

const DEFAULT_THEME_ID = 'earth';
const STEPS_PER_BAR = 8;
// Gentle broken-chord shape over scale degrees relative to the chord root
// (0 root, 2 third, 4 fifth, 6 seventh, 7 octave) — flowing, never busy.
const ARP_PATTERN = [0, 2, 4, 7, 4, 2, 6, 4];

function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** MIDI note for a scale degree of a theme (degrees beyond the mode wrap up an octave). */
function modeMidi(t: Theme, degree: number): number {
  const n = t.mode.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return t.rootMidi + 12 * oct + t.mode[idx];
}

// Overall layer ceilings, kept conservative so the mix never clips.
const THRUSTER_LEVEL = 0.5;
const MUSIC_LEVEL = 0.5;

const SOUND_KEY = 'gravity:sound';

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
  altitude: number;   // km above the dominant body's surface
  firing: boolean;    // engine actually producing thrust (has fuel)
  engineId?: string;  // active engine, for timbre
  bodyId?: string;    // body whose gravity currently dominates (for the theme)
};

class SpaceAudio {
  private ctx: AudioContext | null = null;
  private built = false;
  private running = false;
  private enabled = true;
  private loadedEnabled = false;

  // shared
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;

  // music
  private musicBus!: GainNode;
  private padFilter!: BiquadFilterNode;
  private padVoices: PadVoice[] = [];
  private theme: Theme = THEMES[DEFAULT_THEME_ID];
  private currentThemeId = DEFAULT_THEME_ID;
  private pendingThemeId = DEFAULT_THEME_ID;
  private step = 0;
  private musicDuck = 1;
  private seqTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Warm sustained pad under the keys. Voices glide to the current chord.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.5;
    this.padFilter.connect(this.musicBus);

    const padSend = ctx.createGain();
    padSend.gain.value = 0.5;
    this.padFilter.connect(padSend).connect(this.reverb);

    const chord = this.chordTones(this.theme, 0);
    for (let i = 0; i < 3; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0.05; // soft — the melody sits on top
      gain.connect(this.padFilter);
      const oscA = ctx.createOscillator();
      oscA.type = 'triangle';
      oscA.frequency.value = midiToHz(chord[i]);
      const oscB = ctx.createOscillator();
      oscB.type = 'sine';
      oscB.frequency.value = midiToHz(chord[i]);
      oscB.detune.value = 6; // subtle chorus shimmer
      oscA.connect(gain);
      oscB.connect(gain);
      oscA.start();
      oscB.start();
      this.padVoices.push({ oscA, oscB, gain });
    }
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
    this.thrusterBus.gain.setTargetAtTime(0.0001, t, 0.05);
    this.musicDuck = 1;

    // Reset and start the keyboard sequencer from the top.
    this.step = 0;
    this.applyChord();
    this.musicBus.gain.setTargetAtTime(this.theme.level * MUSIC_LEVEL, t, 0.6);
    this.scheduleStep();
  }

  /** End a flight: fade both layers out and pause the sequencer. */
  stop() {
    this.running = false;
    if (this.seqTimer) { clearTimeout(this.seqTimer); this.seqTimer = null; }
    if (!this.ctx || !this.built) return;
    const t = this.ctx.currentTime;
    this.thrusterBus.gain.setTargetAtTime(0.0001, t, 0.2);
    this.musicBus.gain.setTargetAtTime(0.0001, t, 0.6);
  }

  /** The three pad/triad tones (scale degrees) for a bar of a theme. */
  private chordTones(t: Theme, bar: number): number[] {
    const d = t.prog[((bar % t.prog.length) + t.prog.length) % t.prog.length];
    return [modeMidi(t, d), modeMidi(t, d + 2), modeMidi(t, d + 4)];
  }

  /** Glide the pad to the current bar's chord and track theme brightness. */
  private applyChord() {
    if (!this.ctx) return;
    const bar = Math.floor(this.step / STEPS_PER_BAR);
    const tones = this.chordTones(this.theme, bar);
    const now = this.ctx.currentTime;
    this.padVoices.forEach((v, i) => {
      const f = midiToHz(tones[i]);
      v.oscA.frequency.setTargetAtTime(f, now, 1.6);
      v.oscB.frequency.setTargetAtTime(f, now, 1.6);
    });
    this.padFilter.frequency.setTargetAtTime(600 + this.theme.bright * 1400, now, 1.5);
  }

  /** Schedule the next sequencer step on the current theme's tempo. */
  private scheduleStep() {
    if (this.seqTimer) clearTimeout(this.seqTimer);
    const ms = this.theme.stepMs;
    this.seqTimer = setTimeout(() => {
      if (this.running) this.playStep();
      this.scheduleStep();
    }, ms);
  }

  /** One arpeggio step: swap themes on bar lines, then voice a gentle key note. */
  private playStep() {
    const barPos = this.step % STEPS_PER_BAR;

    if (barPos === 0) {
      // Switch worlds on bar boundaries so the change never jars mid-phrase.
      if (this.pendingThemeId !== this.currentThemeId && THEMES[this.pendingThemeId]) {
        this.currentThemeId = this.pendingThemeId;
        this.theme = THEMES[this.currentThemeId];
        this.step = 0;
      }
      this.applyChord();
    }

    const t = this.theme;
    const bar = Math.floor(this.step / STEPS_PER_BAR);
    const d = t.prog[bar % t.prog.length];
    // Sparser themes breathe more; busier ones still leave gaps.
    const restChance = t.stepMs > 420 ? 0.3 : 0.13;
    if (Math.random() >= restChance) {
      const degree = d + t.melOct * t.mode.length + ARP_PATTERN[barPos];
      const accent = barPos === 0 ? 1 : barPos === 4 ? 0.82 : 0.6;
      const vel = accent * (0.7 + Math.random() * 0.3);
      this.keyNote(modeMidi(t, degree), vel);
    }
    this.step++;
  }

  /** A single soft keyboard note — mellow additive tone with a ringing decay. */
  private keyNote(midi: number, vel: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = midiToHz(midi);
    const dur = 1.7 + Math.random() * 0.9;
    const amp = Math.max(0.0002, vel * 0.5 * this.musicDuck);

    // Per-note tone shaping + amp envelope.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + this.theme.bright * 2600;
    lp.Q.value = 0.4;
    const vca = ctx.createGain();
    vca.gain.setValueAtTime(0.0001, t);
    vca.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    vca.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(vca).connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    vca.connect(send).connect(this.reverb);

    // Additive partials: fundamental + soft octave shimmer + a little warmth.
    const partials: Array<[OscillatorType, number, number, number]> = [
      ['sine', 1, 1.0, dur],
      ['sine', 2, 0.3, dur * 0.6],
      ['triangle', 1, 0.12, dur * 0.9],
    ];
    const oscs: OscillatorNode[] = [];
    const gains: GainNode[] = [];
    for (const [type, mult, lvl, d] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + d + 0.05);
      oscs.push(o);
      gains.push(g);
    }
    // Tear down once the longest partial (the fundamental) has rung out.
    oscs[0].onended = () => {
      oscs.forEach((o) => o.disconnect());
      gains.forEach((g) => g.disconnect());
      lp.disconnect();
      vca.disconnect();
      send.disconnect();
    };
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

    // Pick the theme for where we are: a world's own music while inside its
    // sphere of influence (orbit/atmosphere), the quiet cruise theme otherwise.
    this.pendingThemeId = this.themeFor(p.bodyId, p.altitude);

    // Keep the keys present but tuck them under the engine during burns.
    this.musicDuck = 1 - 0.35 * thr;
    const musicTarget = this.theme.level * MUSIC_LEVEL * this.musicDuck;
    this.musicBus.gain.setTargetAtTime(musicTarget, t, 0.6);
  }

  /** Theme id for the current world + altitude (deep space when far out). */
  private themeFor(bodyId: string | undefined, altitude: number): string {
    if (!bodyId || !THEMES[bodyId]) return 'deepspace';
    const def = SOLAR_BODIES[bodyId];
    // Inside the body's sphere of influence ≈ in its orbit or atmosphere.
    if (def && altitude < def.soiRadius) return bodyId;
    return 'deepspace';
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
