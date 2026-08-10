/**
 * Ballpark audio, synthesized in the browser.
 *
 * Everything here is generated with Web Audio primitives rather than loaded
 * from sample files: no assets to ship, no licensing, and the whole soundscape
 * is a few hundred lines. The vocabulary is small on purpose - a bat crack, a
 * mitt pop, a pitch whoosh and a crowd that swells at the right moments.
 */

export type SoundName =
  | "pitch"
  | "mitt"
  | "crack"
  | "foul"
  | "cheer"
  | "bigCheer"
  | "groan"
  | "strikeout"
  | "launch"
  | "firework"
  | "beam"
  | "organ";

export interface SoundOptions {
  /** 0..1, scales gain and (for crowd sounds) length. */
  intensity?: number;
}

const MASTER_GAIN = 0.5;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private muted = false;

  get enabled(): boolean {
    return !this.muted;
  }

  /**
   * Browsers will not start audio without a gesture, so the context is created
   * lazily and resumed from the first interaction.
   */
  private context(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.noise = this.buildNoise(this.ctx);
    }
    return this.ctx;
  }

  private buildNoise(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Slightly smoothed white noise - pure white is harsher than a ballpark.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.06 * white) / 1.06;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  resume() {
    const ctx = this.context();
    if (ctx?.state === "suspended") void ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05);
    }
    if (muted) this.stopAmbience();
    else this.startAmbience();
  }

  /** Low, continuous crowd murmur under everything else. */
  startAmbience() {
    const ctx = this.context();
    if (!ctx || !this.noise || !this.master || this.ambienceSource || this.muted) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5);

    // A slow wander so the murmur never sits perfectly still.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();

    source.connect(filter).connect(gain).connect(this.master);
    source.start();

    this.ambienceSource = source;
    this.ambienceGain = gain;
  }

  stopAmbience() {
    if (!this.ctx || !this.ambienceSource || !this.ambienceGain) return;
    const now = this.ctx.currentTime;
    this.ambienceGain.gain.setTargetAtTime(0, now, 0.3);
    const source = this.ambienceSource;
    setTimeout(() => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }, 1200);
    this.ambienceSource = null;
    this.ambienceGain = null;
  }

  play(name: SoundName, options: SoundOptions = {}) {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx || !this.master || !this.noise) return;
    if (ctx.state === "suspended") return; // Waiting on a gesture.

    const intensity = Math.max(0, Math.min(1, options.intensity ?? 0.6));
    const now = ctx.currentTime;

    switch (name) {
      case "pitch":
        this.burst({ type: "highpass", freq: 1400, q: 0.7, attack: 0.03, decay: 0.16, gain: 0.1 });
        break;
      case "mitt":
        this.burst({ type: "lowpass", freq: 1500, q: 1, attack: 0.001, decay: 0.11, gain: 0.32 });
        this.thump(150, 0.09, 0.18);
        break;
      case "crack":
        // Wooden bat: a sharp band of noise plus a low body resonance.
        this.burst({ type: "bandpass", freq: 2600, q: 1.4, attack: 0.001, decay: 0.14, gain: 0.5 });
        this.thump(320, 0.1, 0.22);
        break;
      case "foul":
        this.burst({ type: "bandpass", freq: 2100, q: 1.6, attack: 0.001, decay: 0.1, gain: 0.34 });
        this.crowd({ start: now + 0.15, length: 1.1, gain: 0.1, bright: 700 });
        break;
      case "cheer":
        this.crowd({ start: now, length: 1.6 + intensity * 1.2, gain: 0.16 + intensity * 0.16, bright: 1100 });
        break;
      case "bigCheer":
        this.crowd({ start: now, length: 3.4, gain: 0.42, bright: 1500, swell: 0.5 });
        break;
      case "groan":
        // A disappointed home crowd: shorter, darker and lower than a cheer.
        this.crowd({
          start: now,
          length: 1.1 + intensity * 1.0,
          gain: 0.09 + intensity * 0.13,
          bright: 380 + intensity * 160,
          swell: 0.18,
        });
        break;
      case "strikeout":
        this.crowd({ start: now, length: 1.4, gain: 0.15 + intensity * 0.1, bright: 900 });
        break;
      case "launch":
        this.whistle();
        break;
      case "firework":
        this.boom(intensity);
        break;
      case "beam":
        this.beam();
        break;
      case "organ":
        this.organ();
        break;
    }
  }

  /** A filtered noise hit - the basis of every impact sound. */
  private burst(spec: {
    type: BiquadFilterType;
    freq: number;
    q: number;
    attack: number;
    decay: number;
    gain: number;
  }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 1;
    // Start at a random offset so repeated hits are not identical.
    const offset = Math.random() * 1.5;

    const filter = ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.freq;
    filter.Q.value = spec.q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.gain, now + spec.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.attack + spec.decay);

    source.connect(filter).connect(gain).connect(this.master);
    source.start(now, offset, spec.attack + spec.decay + 0.05);
    source.stop(now + spec.attack + spec.decay + 0.06);
  }

  /** Low sine body, for the weight under a bat crack or a mitt pop. */
  private thump(freq: number, decay: number, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + decay);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    osc.connect(amp).connect(this.master);
    osc.start(now);
    osc.stop(now + decay + 0.02);
  }

  /**
   * A crowd: broadband noise with a slow swell, roughened by a low tremolo so
   * it reads as many voices rather than a hiss.
   */
  private crowd(spec: {
    start: number;
    length: number;
    gain: number;
    bright: number;
    swell?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const { start, length, gain: peak, bright } = spec;
    const swell = spec.swell ?? 0.25;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(bright * 0.6, start);
    band.frequency.linearRampToValueAtTime(bright, start + swell);
    band.frequency.linearRampToValueAtTime(bright * 0.7, start + length);
    band.Q.value = 0.8;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(peak, start + swell);
    amp.gain.setValueAtTime(peak, start + Math.min(length * 0.45, swell + 0.4));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length);

    // Tremolo: the texture of a lot of separate voices.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5.5 + Math.random() * 3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = peak * 0.28;
    lfo.connect(lfoGain).connect(amp.gain);

    source.connect(band).connect(amp).connect(this.master);
    source.start(start);
    lfo.start(start);
    source.stop(start + length + 0.1);
    lfo.stop(start + length + 0.1);
  }

  /** Rising whistle of a shell on its way up. */
  private whistle() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(1500, now + 1.2);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(0.05, now + 0.15);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);

    osc.connect(amp).connect(master);
    osc.start(now);
    osc.stop(now + 1.3);
  }

  /**
   * A transporter: two detuned oscillators sweeping up together, with a thin
   * band of noise over the top. Rising pitch is what makes something read as
   * dematerialising rather than exploding.
   */
  private beam() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    for (const [detune, gain] of [
      [0, 0.05],
      [7, 0.035],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.detune.setValueAtTime(detune, now);
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(2400, now + 0.5);

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(gain, now + 0.06);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

      osc.connect(amp).connect(master);
      osc.start(now);
      osc.stop(now + 0.65);
    }

    this.burst({
      type: "bandpass",
      freq: 2600,
      q: 2.4,
      attack: 0.02,
      decay: 0.5,
      gain: 0.045,
    });
  }

  /** The burst: a low thump, a bright crack, then crackling embers. */
  private boom(intensity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.burst({
      type: "lowpass",
      freq: 260 + intensity * 160,
      q: 0.9,
      attack: 0.004,
      decay: 0.45 + intensity * 0.3,
      gain: 0.34 + intensity * 0.24,
    });
    this.thump(70, 0.35, 0.3);

    // Embers: a scatter of tiny high bursts after the flash.
    const embers = 5 + Math.floor(intensity * 7);
    for (let i = 0; i < embers; i++) {
      setTimeout(
        () =>
          this.burst({
            type: "highpass",
            freq: 3200,
            q: 1,
            attack: 0.001,
            decay: 0.05,
            gain: 0.06,
          }),
        180 + Math.random() * 900,
      );
    }
  }

  /** A short ballpark-organ sting. */
  private organ() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const notes = [392, 523.25, 659.25];
    notes.forEach((freq, i) => {
      const start = now + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(0.11, start + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      osc.connect(amp).connect(master);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  }

  dispose() {
    this.stopAmbience();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}

export const sfx = new Sfx();
