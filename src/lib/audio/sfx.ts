/**
 * Ballpark audio, synthesized in the browser.
 *
 * Everything here is generated with Web Audio primitives rather than loaded
 * from sample files: no assets to ship, no licensing, and the whole soundscape
 * is a few hundred lines. The vocabulary is small on purpose - a bat crack, a
 * mitt pop, a pitch whoosh and a crowd that swells at the right moments.
 *
 * The one idea worth knowing before changing anything: **a crowd is voices,
 * not noise**. Filtered noise makes a passable impact or a passable roar, but
 * it can never make a groan, because a groan is pitched and has a vowel in it.
 * So there are two crowd generators here, and which one a sound reaches for
 * decides whether it lands. `crowd` is the noise roar - right for the wall of
 * sound behind a big hit, where hundreds of separate pitches really do average
 * out to broadband. `voices` is a formant-filtered oscillator cluster - right
 * for anything where you are meant to hear people rather than volume: the
 * "ohhh" after a ball lands in a glove, the few fans reacting to a foul, the
 * murmur under an empty park.
 */

export type SoundName =
  | "pitch"
  | "mitt"
  | "crack"
  /** A bat cutting through air that had a ball in it a moment ago. */
  | "whoosh"
  | "foul"
  | "cheer"
  | "bigCheer"
  | "groan"
  | "strikeout"
  | "launch"
  | "firework"
  | "beam"
  /** The between-innings organ riff. */
  | "organ"
  /** The organ's "Charge!" fanfare, and the shout that answers it. */
  | "charge";

export interface SoundOptions {
  /** 0..1, scales gain and (for crowd sounds) length. */
  intensity?: number;
}

const MASTER_GAIN = 0.5;

/** How loud the ambient park sits under everything else. */
const BED_GAIN = 0.075;

/**
 * Vowels, as the first three formants that make them. A voice is a buzz at
 * some pitch pushed through the resonances of a throat and mouth; the buzz
 * decides the note, these decide which vowel you hear, and it is the vowel
 * that makes a sound read as a person. Bandwidths run 60-160Hz in a real
 * vocal tract, which is where the Q values in `voices` come from.
 */
const VOWEL = {
  /** "ohhh" - the disappointed one. */
  oh: [520, 900, 2450],
  /** "ahhh" - open and bright, what a cheer is made of. */
  ah: [780, 1180, 2600],
  /** "oooh" - dark and closed, a held breath. */
  ooh: [360, 820, 2400],
} as const;

type Vowel = keyof typeof VOWEL;

/**
 * Where the voices in a crowd sit relative to each other. Not a random spread:
 * a real crowd is clumped into registers, and picking multipliers off this list
 * keeps a group of voices sounding like a group of people rather than like one
 * detuned synth.
 */
const REGISTERS = [0.72, 0.86, 1, 1.13, 1.58, 1.84, 2.12] as const;

/**
 * Three resonant bandpasses throw away most of what a sawtooth puts into them
 * - measured against the rest of the file, around 15dB of it. Without this the
 * `gain` passed to `voices` would mean something different from the `gain`
 * passed to everything else, and every crowd sound would quietly come out a
 * third the size of the cheer it is supposed to answer. The figure is measured
 * rather than derived: it is what puts a groan and a cheer at the same peak.
 */
const VOICE_MAKEUP = 6;

interface Bed {
  gain: GainNode;
  stop(): void;
}

class Sfx {
  private ctx: AudioContext | null = null;
  /** Mute and volume. Everything, wet and dry, passes through here. */
  private master: GainNode | null = null;
  /** What individual sounds connect to. */
  private dry: GainNode | null = null;
  /** Reverb send; how much of a sound reaches it is per-sound `space`. */
  private send: GainNode | null = null;
  /** Smoothed noise - the basis of the impacts. Deliberately dark. */
  private noise: AudioBuffer | null = null;
  /** White noise, for claps, breath and the ambient bed. */
  private bright: AudioBuffer | null = null;
  private muted = false;
  private wantBed = false;
  private bed: Bed | null = null;
  private bedTimer: ReturnType<typeof setInterval> | null = null;

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

      // The park, as a signal chain. Sounds land on `dry`; a copy of whatever
      // asks for it goes through the convolver and comes back wet. Both meet
      // at `master`, so muting kills the tail as well as the source - a mute
      // that leaves three seconds of reverb ringing is not a mute.
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;

      // A home run sets off the crack, the cheer, the whistle, seven booms and
      // a cheer per run that scores, all inside two seconds. Without this they
      // add arithmetically and clip. Slow attack so the crack still cracks.
      const bus = this.ctx.createDynamicsCompressor();
      bus.threshold.value = -15;
      bus.knee.value = 22;
      bus.ratio.value = 3.5;
      bus.attack.value = 0.008;
      bus.release.value = 0.28;

      this.dry = this.ctx.createGain();
      this.send = this.ctx.createGain();
      const reverb = this.ctx.createConvolver();
      reverb.buffer = this.buildImpulse(this.ctx);
      const wet = this.ctx.createGain();
      wet.gain.value = 0.38;

      this.dry.connect(this.master);
      this.send.connect(reverb).connect(wet).connect(this.master);
      this.master.connect(bus).connect(this.ctx.destination);

      this.noise = this.buildNoise(this.ctx);
      this.bright = this.buildBright(this.ctx);
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

  /**
   * Unsmoothed noise, six seconds of it. The smoothed buffer above rolls off
   * around 400Hz, which suits an impact and starves anything that needs energy
   * up where claps and consonants live. Six seconds rather than two because
   * the bed loops this: a two-second loop of noise is audible *as* a loop,
   * which is a good part of why the old ambience read as tape hiss.
   */
  private buildBright(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 6);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /**
   * The park's reverb tail, as decaying noise. Stereo with the two channels
   * generated independently, which is what makes it wide, and the first few
   * milliseconds left empty so sounds seem to happen at some distance from the
   * walls rather than inside them.
   */
  private buildImpulse(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 2.4);
    const predelay = Math.floor(ctx.sampleRate * 0.018);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        // Reflections come back darker than they left.
        last = (last + 0.4 * white) / 1.4;
        if (i < predelay) {
          data[i] = 0;
          continue;
        }
        const u = (i - predelay) / (length - predelay);
        data[i] = last * Math.pow(1 - u, 2.6);
      }
    }
    return buffer;
  }

  /**
   * A gain node that is silent until something says otherwise.
   *
   * Worth the method, because the alternative is a bug that does not look like
   * one. An AudioParam holds its *default* for all time before its first
   * scheduled event, and a gain's default is 1. So a node built now and faded
   * in at some point later does not sit silent in between - it sits wide open,
   * and the fraction of a millisecond between its source starting and its
   * envelope taking over passes the raw source through at full scale. That is
   * a click, at whatever amplitude the source happens to be at, and it lands
   * on exactly the sounds that are scheduled ahead rather than played now: the
   * key clicks under an organ chord, applause, embers, the events in the bed.
   * Measured on the organ riff it was a single sample at 0.69, against a note
   * that peaks at 0.045 - fifteen times the music it was attached to.
   */
  private gate(gain = 0.0001): GainNode {
    const node = this.ctx!.createGain();
    node.gain.value = gain;
    return node;
  }

  /** Send a finished sound to the park: dry always, wet by `space` (0..1). */
  private sink(node: AudioNode, space = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    node.connect(this.dry);
    if (space > 0 && this.send) {
      const tap = ctx.createGain();
      tap.gain.value = space;
      node.connect(tap).connect(this.send);
    }
  }

  resume() {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => this.syncBed());
      return;
    }
    this.syncBed();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05);
    }
    // Muting stops the bed outright rather than just turning it down: it is
    // the one sound here that would otherwise run forever, scheduling voices
    // and claps nobody can hear.
    this.syncBed();
  }

  /**
   * Turn the ambient park on or off. Safe to call before the audio context
   * exists or while it is still waiting on a gesture - the intent is recorded
   * and the bed starts as soon as it can.
   */
  setAmbience(on: boolean) {
    this.wantBed = on;
    if (on) this.context();
    this.syncBed();
  }

  play(name: SoundName, options: SoundOptions = {}) {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx || !this.dry || !this.noise || !this.bright) return;
    if (ctx.state === "suspended") return; // Waiting on a gesture.

    const intensity = Math.max(0, Math.min(1, options.intensity ?? 0.6));
    const now = ctx.currentTime;

    switch (name) {
      case "pitch":
        this.burst({
          type: "highpass",
          freq: 1400,
          q: 0.7,
          attack: 0.03,
          decay: 0.16,
          gain: 0.1,
          space: 0.12,
        });
        break;
      case "mitt":
        this.burst({
          type: "lowpass",
          freq: 1500,
          q: 1,
          attack: 0.001,
          decay: 0.11,
          gain: 0.32,
          space: 0.18,
        });
        this.thump(150, 0.09, 0.18);
        break;
      case "crack":
        // Wooden bat: a sharp band of noise plus a low body resonance. How
        // hard the ball was hit is carried by all three of level, brightness
        // and weight - a ball off the end of the bat is not a quiet version of
        // a barrelled one, it is a duller one.
        this.burst({
          type: "bandpass",
          freq: 1900 + intensity * 1100,
          q: 1.4,
          attack: 0.001,
          decay: 0.1 + intensity * 0.07,
          gain: 0.24 + intensity * 0.42,
          // The one sound in the park everybody hears come back off the far
          // stands, and more of it the harder the ball was hit.
          space: 0.18 + intensity * 0.22,
        });
        this.thump(360 - intensity * 80, 0.09 + intensity * 0.09, 0.12 + intensity * 0.2);
        // Anything really struck gets a second, lower body under it: the part
        // of a home run you feel rather than hear.
        if (intensity > 0.7) this.thump(110, 0.26, 0.14 * intensity);
        break;
      case "whoosh":
        this.whoosh(intensity);
        break;
      case "foul":
        // Played under a "crack", so this is only what the park does about it.
        // A foul is not a crowd event: nothing has happened yet, and the few
        // hundred people near where it landed react on their own account. So
        // it gets individual voices at staggered times and a thin smatter of
        // applause, and pointedly *not* a swell - the swell is what made this
        // read as a hiss before, because a unified crowd sound implies a
        // unified reason to make it.
        this.burst({
          type: "bandpass",
          freq: 2400,
          q: 1.8,
          attack: 0.001,
          decay: 0.09,
          gain: 0.18,
          space: 0.3,
        });
        this.reactions(now + 0.13, 3, 0.55, 0.75);
        break;
      case "cheer":
        this.crowd({
          start: now,
          length: 1.6 + intensity * 1.2,
          gain: 0.16 + intensity * 0.16,
          bright: 1100,
        });
        break;
      case "bigCheer":
        this.crowd({ start: now, length: 3.4, gain: 0.42, bright: 1500, swell: 0.5 });
        break;
      case "groan":
        this.groan(intensity);
        break;
      case "strikeout":
        // Not a quieter cheer: a different shape. A strikeout is punctuation -
        // the park snaps up on the call and is done a second later - where a
        // cheer for a hit keeps climbing while the ball is still out there.
        this.crowd({
          start: now,
          length: 1.35,
          gain: 0.12 + intensity * 0.09,
          bright: 950,
          swell: 0.14,
        });
        // The "yeah!" over the top: voices going *up*, which is the whole
        // difference between a crowd celebrating and a crowd complaining.
        this.voices({
          start: now + 0.02,
          length: 0.5 + intensity * 0.2,
          gain: 0.09 + intensity * 0.07,
          from: 186,
          to: 238,
          vowel: "ah",
          count: 7,
          attack: 0.045,
          spread: 60,
          space: 0.45,
        });
        this.scatter({ start: now + 0.1, length: 1.5, count: 30, gain: 0.05, space: 0.5 });
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
        this.organ("riff");
        break;
      case "charge":
        this.organ("charge");
        break;
    }

    // A park that has just made a noise stays louder than one that has not.
    if (name === "cheer" || name === "bigCheer" || name === "strikeout") {
      this.stir(0.5 + intensity * 0.5);
    } else if (name === "groan") {
      this.stir(0.3 * intensity);
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
    /** Scheduled start; defaults to now. */
    start?: number;
    space?: number;
    /** White rather than the smoothed buffer - for claps and embers. */
    bright?: boolean;
  }) {
    const ctx = this.ctx;
    const buffer = spec.bright ? this.bright : this.noise;
    if (!ctx || !buffer || !this.dry) return;
    const now = Math.max(spec.start ?? ctx.currentTime, ctx.currentTime);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1;
    // Start at a random offset so repeated hits are not identical.
    const offset = Math.random() * 1.5;

    const filter = ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.freq;
    filter.Q.value = spec.q;

    const gain = this.gate();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.gain, now + spec.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.attack + spec.decay);

    source.connect(filter).connect(gain);
    this.sink(gain, spec.space ?? 0);
    source.start(now, offset, spec.attack + spec.decay + 0.05);
    source.stop(now + spec.attack + spec.decay + 0.06);
  }

  /**
   * A group of people making one sound. Sawtooth oscillators spread across the
   * registers of a mixed crowd, summed and pushed through three bandpass
   * filters parked on a vowel's formants, with a little breath noise through
   * the same filters so it is not purely synthetic.
   *
   * The pitch contour does most of the emotional work: the same voices on the
   * same vowel read as a cheer going up and a groan coming down. Everything
   * else here is texture.
   */
  private voices(spec: {
    start?: number;
    length: number;
    gain: number;
    /** Fundamental at the start of the sound. */
    from: number;
    /** Fundamental at the end. Below `from` falls, above it rises. */
    to: number;
    vowel: Vowel;
    count?: number;
    attack?: number;
    /** Detune spread in cents - nobody in a crowd is quite in tune. */
    spread?: number;
    space?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx || !this.bright || !this.dry) return;
    const start = Math.max(spec.start ?? ctx.currentTime, ctx.currentTime);
    const { length, from, to } = spec;
    const count = spec.count ?? 7;
    const attack = spec.attack ?? 0.12;
    const spread = spec.spread ?? 40;
    const end = start + length;

    const peak = spec.gain * VOICE_MAKEUP;
    const amp = this.gate();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(peak, start + attack);
    amp.gain.setValueAtTime(peak, start + Math.min(attack + length * 0.3, length * 0.6));
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    this.sink(amp, spec.space ?? 0.4);

    // Everything that buzzes lands here; the formants are downstream, so one
    // set of filters colours the whole crowd at once.
    const source = ctx.createGain();
    source.gain.value = 1 / Math.max(3, count);

    const formants = VOWEL[spec.vowel];
    // Higher formants are weaker in a real voice, and the top one is mostly
    // there to keep the vowel from sounding like it is behind a blanket.
    const weights = [1, 0.45, 0.16];
    const qs = [7, 9, 15];
    formants.forEach((freq, i) => {
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(freq, start);
      // The mouth closes a little as a groan falls away.
      band.frequency.linearRampToValueAtTime(freq * (to < from ? 0.88 : 1.06), end);
      band.Q.value = qs[i];
      const level = ctx.createGain();
      level.gain.value = weights[i];
      source.connect(band).connect(level).connect(amp);
    });

    for (let i = 0; i < count; i++) {
      const register = REGISTERS[i % REGISTERS.length] * (0.96 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = (Math.random() * 2 - 1) * spread;
      osc.frequency.setValueAtTime(from * register, start);
      osc.frequency.exponentialRampToValueAtTime(to * register, end);

      // Nobody holds a steady note, and the wobble is not shared - independent
      // vibrato is most of what separates a crowd from a chord.
      const vib = ctx.createOscillator();
      vib.frequency.value = 4 + Math.random() * 2.5;
      const vibDepth = ctx.createGain();
      vibDepth.gain.value = 5 + Math.random() * 7;
      vib.connect(vibDepth).connect(osc.detune);

      osc.connect(source);
      osc.start(start);
      vib.start(start);
      osc.stop(end + 0.05);
      vib.stop(end + 0.05);
    }

    // Breath. Cheap, and without it the whole thing is recognisably an organ.
    const air = ctx.createBufferSource();
    air.buffer = this.bright;
    air.loop = true;
    air.playbackRate.value = 0.9 + Math.random() * 0.2;
    const airLevel = ctx.createGain();
    airLevel.gain.value = 0.1;
    air.connect(airLevel).connect(source);
    air.start(start, Math.random() * 4);
    air.stop(end + 0.05);
  }

  /**
   * Applause, as a handful of individual claps rather than a texture. Each one
   * is a few milliseconds of white noise; what makes it read as a crowd is
   * that no two land together and no two are the same brightness.
   */
  private scatter(spec: {
    start: number;
    length: number;
    count: number;
    gain: number;
    space?: number;
  }) {
    for (let i = 0; i < spec.count; i++) {
      // Squared distribution: applause is densest just after it starts, then
      // thins out, which an even scatter never does.
      const u = Math.random();
      const at = spec.start + u * u * spec.length;
      this.burst({
        start: at,
        type: "bandpass",
        freq: 1100 + Math.random() * 1500,
        q: 0.9,
        attack: 0.0008,
        decay: 0.018 + Math.random() * 0.03,
        gain: spec.gain * (0.5 + Math.random() * 0.9),
        space: spec.space ?? 0.45,
        bright: true,
      });
    }
  }

  /**
   * A few people reacting on their own, which is what a foul ball or a quiet
   * moment in the stands actually sounds like. Staggered, different pitches,
   * different vowels - deliberately not in unison.
   */
  private reactions(start: number, count: number, window: number, gain = 1, claps = true) {
    for (let i = 0; i < count; i++) {
      const at = start + Math.random() * window;
      const low = 118 + Math.random() * 95;
      this.voices({
        start: at,
        length: 0.38 + Math.random() * 0.34,
        gain: (0.045 + Math.random() * 0.045) * gain,
        from: low,
        to: low * (0.76 + Math.random() * 0.12),
        vowel: Math.random() < 0.5 ? "oh" : "ah",
        count: 2,
        attack: 0.05,
        spread: 28,
        space: 0.55,
      });
    }
    if (!claps) return;
    this.scatter({
      start: start + 0.08,
      length: window + 0.4,
      count: Math.round(7 * gain),
      gain: 0.05 * gain,
      space: 0.5,
    });
  }

  /**
   * The disappointed home crowd. This is the sound the noise generator cannot
   * make: a groan is a few thousand people on the same low vowel, sliding
   * downward, and every one of those three things - pitch, vowel, fall - is
   * something filtered noise has no way to express. It used to be a dark cheer
   * and it read as a dark hiss.
   */
  private groan(intensity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const length = 1.25 + intensity * 0.75;

    this.voices({
      // A beat late on purpose: a crowd sees it, then reacts.
      start: now + 0.06,
      length,
      gain: 0.1 + intensity * 0.13,
      from: 170 - intensity * 20,
      to: 112 - intensity * 16,
      vowel: "oh",
      count: 9,
      // Slow bloom. A groan has no attack in it - it gathers.
      attack: 0.2 + intensity * 0.08,
      spread: 48,
      space: 0.5,
    });

    // A dark noise bed underneath for the size of the place: the voices carry
    // the character, this carries how many of them there are.
    this.crowd({
      start: now + 0.04,
      length: length * 0.9,
      gain: 0.035 + intensity * 0.05,
      bright: 330,
      swell: 0.3,
    });

    // The stragglers still going after the rest have given up - voices only.
    // Nobody applauds a groan, and the clap scatter that belongs under a foul
    // turns the tail of this into polite appreciation of a bad outcome.
    this.reactions(now + length * 0.55, 2, 0.5, 0.7, false);
  }

  /**
   * Air off a bat that hit nothing: noise through a bandpass that sweeps up
   * past the listener and away again, which is the whole of what a swing and a
   * miss sounds like. The sweep is what makes it a pass rather than a hiss -
   * a fixed band reads as static, however it is shaped.
   */
  private whoosh(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.dry) return;
    const now = ctx.currentTime;
    const length = 0.26;
    const peak = 0.12 + intensity * 0.16;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.9 + Math.random() * 0.25;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(420, now);
    band.frequency.exponentialRampToValueAtTime(1500 + intensity * 900, now + length * 0.45);
    band.frequency.exponentialRampToValueAtTime(380, now + length);

    const amp = this.gate();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(peak, now + length * 0.42);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + length);

    source.connect(band).connect(amp);
    this.sink(amp, 0.12);
    source.start(now, Math.random() * 1.5, length + 0.05);
    source.stop(now + length + 0.06);
  }

  /** Low sine body, for the weight under a bat crack or a mitt pop. */
  private thump(freq: number, decay: number, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + decay);

    const amp = this.gate(gain);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    osc.connect(amp);
    this.sink(amp, 0.1);
    osc.start(now);
    osc.stop(now + decay + 0.02);
  }

  /**
   * A crowd as a wall of sound: broadband noise with a slow swell, roughened
   * by a low tremolo. Right for a roar, where hundreds of pitches genuinely do
   * average out to broadband - and wrong for anything you are meant to hear
   * individual people in, which is what `voices` is for.
   */
  private crowd(spec: {
    start: number;
    length: number;
    gain: number;
    bright: number;
    swell?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.dry) return;
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

    const amp = this.gate();
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

    source.connect(band).connect(amp);
    this.sink(amp, 0.42);
    source.start(start);
    lfo.start(start);
    source.stop(start + length + 0.1);
    lfo.stop(start + length + 0.1);
  }

  /** Rising whistle of a shell on its way up. */
  private whistle() {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(1500, now + 1.2);

    const amp = this.gate();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(0.05, now + 0.15);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);

    osc.connect(amp);
    this.sink(amp, 0.3);
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
    if (!ctx || !this.dry) return;
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

      const amp = this.gate();
      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(gain, now + 0.06);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

      osc.connect(amp);
      this.sink(amp, 0.35);
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
      space: 0.35,
    });
  }

  /** The burst: a low thump, a bright crack, then crackling embers. */
  private boom(intensity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.burst({
      type: "lowpass",
      freq: 260 + intensity * 160,
      q: 0.9,
      attack: 0.004,
      decay: 0.45 + intensity * 0.3,
      gain: 0.34 + intensity * 0.24,
      space: 0.5,
    });
    this.thump(70, 0.35, 0.3);

    // Embers: a scatter of tiny high bursts after the flash. Scheduled on the
    // audio clock rather than with timers, so they cannot arrive after a mute
    // or drift when the main thread is busy drawing the show that set them off.
    const embers = 5 + Math.floor(intensity * 7);
    for (let i = 0; i < embers; i++) {
      this.burst({
        start: now + 0.18 + Math.random() * 0.9,
        type: "highpass",
        freq: 3200,
        q: 1,
        attack: 0.001,
        decay: 0.05,
        gain: 0.06,
        space: 0.45,
        bright: true,
      });
    }
  }

  /**
   * The ballpark organ, by drawbars: a stack of sine partials at whole-number
   * multiples of the note, which is how the real instrument works and why no
   * single waveform sounds like one. The tiny noise click on each attack is
   * the key contact - unmusical, and the thing people actually recognise.
   */
  private organ(phrase: "riff" | "charge") {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    const now = ctx.currentTime;

    // [frequency, when, how long, level]. The level is there because an organ
    // note is a stack of sine partials and sines add coherently: three notes
    // of a chord at the melody's level peak three times as high as the melody
    // does, and the riff came out louder than the loudest cheer in the park.
    // Inner voices of a chord sit under the top line, the way a player would
    // balance them.
    const riff: Array<[number, number, number, number]> = [
      [392.0, 0, 0.16, 1],
      [523.25, 0.13, 0.16, 1],
      [659.25, 0.26, 0.16, 1],
      // Lands on a chord rather than a note - the organ never plays one.
      [783.99, 0.39, 0.62, 1],
      [523.25, 0.39, 0.62, 0.4],
      [659.25, 0.39, 0.62, 0.4],
    ];
    // The cavalry call. Five up to the top, a breath, then the long one.
    const charge: Array<[number, number, number, number]> = [
      [392.0, 0, 0.13, 1],
      [523.25, 0.12, 0.13, 1],
      [659.25, 0.24, 0.13, 1],
      [783.99, 0.36, 0.26, 1],
      [659.25, 0.62, 0.13, 1],
      [783.99, 0.74, 0.6, 1],
    ];

    // The riff is cued the instant the side is retired, which is also the
    // instant nine fielders beam off the field. Waiting out the transporters
    // is the difference between an organ playing and an organ interrupting.
    const notes = phrase === "charge" ? charge : riff;
    const lead = phrase === "charge" ? 0 : 0.75;
    // The chord is quieter per note than the fanfare's single notes for the
    // same reason it is balanced at all: its partials coincide and add.
    const level = phrase === "charge" ? 0.085 : 0.08;
    for (const [freq, at, length, balance] of notes) {
      this.organNote(freq, now + lead + at, length, level * balance);
    }

    if (phrase === "charge") {
      // And the park answers it. Short, loud, upward - the shape of a word
      // shouted in unison, which is the only part of "Charge!" that survives
      // being yelled by forty thousand people.
      this.voices({
        start: now + 1.36,
        length: 0.62,
        gain: 0.2,
        from: 165,
        to: 205,
        vowel: "ah",
        count: 9,
        attack: 0.035,
        spread: 70,
        space: 0.5,
      });
      this.scatter({ start: now + 1.5, length: 1.4, count: 26, gain: 0.05 });
    }
  }

  private organNote(freq: number, start: number, length: number, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    const end = start + length;

    const amp = this.gate();
    amp.gain.setValueAtTime(0.0001, start);
    // Organs do not swell and do not decay while a key is down.
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.014);
    amp.gain.setValueAtTime(gain, end - 0.09);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    this.sink(amp, 0.42);

    // Drawbar registration: sub-octave for weight, the odd harmonics for the
    // reedy bite that carries across a stadium.
    const bars: Array<[number, number]> = [
      [0.5, 0.3],
      [1, 1],
      [2, 0.5],
      [3, 0.34],
      [4, 0.2],
      [6, 0.11],
      [8, 0.07],
    ];

    // One vibrato across the whole stack - unlike a crowd, an organ's voices
    // really are locked together.
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.2;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 7;
    vib.start(start);
    vib.stop(end + 0.05);

    for (const [mult, level] of bars) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      const bar = ctx.createGain();
      bar.gain.value = level;
      vib.connect(vibDepth).connect(osc.detune);
      osc.connect(bar).connect(amp);
      osc.start(start);
      osc.stop(end + 0.05);
    }

    this.burst({
      start,
      type: "highpass",
      freq: 2600,
      q: 0.8,
      attack: 0.0008,
      decay: 0.02,
      gain: gain * 0.5,
      space: 0.3,
      bright: true,
    });
  }

  // --- The ambient park -----------------------------------------------------

  /** Start or stop the bed to match what is wanted and what is possible. */
  private syncBed() {
    const ctx = this.ctx;
    const should = this.wantBed && !this.muted && ctx?.state === "running";
    if (should && !this.bed) this.startBed();
    else if (!should && this.bed) this.stopBed();
  }

  /**
   * The park itself: the sound of somewhere with people in it, under
   * everything else and mostly below notice until it stops.
   *
   * This is the thing the old TODO here said synthesis could not do, and it
   * was right about the method it had in mind. Filtered noise with an LFO on
   * it is tape hiss, and no amount of shaping fixes that, because the problem
   * is not the spectrum - it is that nothing in it ever *happens*. What sells
   * a crowd is discrete events: a shout, four people clapping, someone
   * whistling, none of them related to each other. So the bed here is two
   * things. A wash of noise parked on the vowel formants, wandering slowly and
   * independently per band so the spectrum never settles; and a scheduler that
   * drops real voices and real claps into it at random, a few seconds apart.
   * The wash alone is still hiss. The events are what make it a ballpark.
   */
  private startBed() {
    const ctx = this.ctx;
    if (!ctx || !this.bright || !this.dry || this.bed) return;
    const now = ctx.currentTime;

    const gain = this.gate();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(BED_GAIN, now + 2.5);

    // The whole bed goes through this, and it is the single most important
    // number in the ambience. White noise carries equal energy per Hz, so
    // bands that look modest in the table below still put far more total
    // energy above 2kHz than below it, and a crowd whose energy sits up there
    // is a hiss - measured, the bed came out at a spectral centroid of 4.2kHz
    // against 1.8kHz for a cheer and 0.95kHz for a groan, which is to say it
    // was brighter than forty thousand people shouting at once. A resting
    // murmur heard from the field is darker than either.
    const roof = ctx.createBiquadFilter();
    roof.type = "lowpass";
    roof.frequency.value = 1500;
    roof.Q.value = 0.7;
    gain.connect(roof);
    this.sink(roof, 0.5);

    const sources: AudioScheduledSourceNode[] = [];
    // Rates are deliberately not round multiples of each other: the layers
    // loop the same six seconds of noise, and if their periods lined up the
    // loop would be audible as a loop.
    const layers = [
      { type: "lowpass", freq: 150, q: 0.7, level: 0.5, rate: 0.79, wander: 0.061 },
      { type: "bandpass", freq: 520, q: 0.9, level: 1, rate: 1.0, wander: 0.047 },
      { type: "bandpass", freq: 1150, q: 0.8, level: 0.34, rate: 1.17, wander: 0.083 },
      // Narrow and quiet: this layer is the suggestion of consonants a long
      // way off, not a band anyone should be able to pick out.
      { type: "bandpass", freq: 2600, q: 1.1, level: 0.05, rate: 1.43, wander: 0.109 },
    ] as const;

    for (const layer of layers) {
      const source = ctx.createBufferSource();
      source.buffer = this.bright;
      source.loop = true;
      source.playbackRate.value = layer.rate;

      const band = ctx.createBiquadFilter();
      band.type = layer.type as BiquadFilterType;
      band.frequency.value = layer.freq;
      band.Q.value = layer.q;

      const level = ctx.createGain();
      level.gain.value = layer.level;

      // Two slow wanders per layer, one on level and one on colour, at
      // unrelated rates. Between four layers that is eight drifts nobody can
      // pick apart, which is what "a lot of people talking" sounds like.
      const swell = ctx.createOscillator();
      swell.frequency.value = layer.wander;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = layer.level * 0.45;
      swell.connect(swellDepth).connect(level.gain);

      const colour = ctx.createOscillator();
      colour.frequency.value = layer.wander * 0.63;
      const colourDepth = ctx.createGain();
      colourDepth.gain.value = layer.freq * 0.14;
      colour.connect(colourDepth).connect(band.frequency);

      source.connect(band).connect(level).connect(gain);
      source.start(now, Math.random() * 5);
      swell.start(now);
      colour.start(now);
      sources.push(source, swell, colour);
    }

    this.bed = {
      gain,
      stop: () => {
        const at = ctx.currentTime;
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
        for (const source of sources) source.stop(at + 0.45);
      },
    };

    // The scheduler for everything that is not the wash. Runs on a timer
    // because it only decides *what* happens; the sounds themselves are
    // scheduled onto the audio clock a couple of seconds ahead, so a busy
    // frame cannot make the park stutter.
    this.bedTimer = setInterval(() => this.bedTick(), 2400);
    this.bedTick();
  }

  private stopBed() {
    if (this.bedTimer !== null) {
      clearInterval(this.bedTimer);
      this.bedTimer = null;
    }
    this.bed?.stop();
    this.bed = null;
  }

  /**
   * Decide what the park does in the next couple of seconds.
   *
   * These are deliberately louder than the wash they land on. An event that
   * sits under the murmur is not a quiet event, it is no event at all, and the
   * bed goes back to being the hiss this was written to avoid: measured, the
   * wash peaks near 0.038, so these aim at roughly 0.03-0.06 - clearly things
   * happening, still a long way from the 0.13 of a cheer.
   */
  private bedTick() {
    const ctx = this.ctx;
    if (!ctx || !this.bed || this.muted) return;
    const now = ctx.currentTime;
    const roll = Math.random();

    if (roll < 0.42) {
      // Someone, somewhere, saying something. Too far off to make out.
      const low = 105 + Math.random() * 90;
      this.voices({
        start: now + Math.random() * 2,
        length: 0.5 + Math.random() * 0.9,
        gain: 0.06 + Math.random() * 0.06,
        from: low,
        to: low * (0.82 + Math.random() * 0.3),
        vowel: (["oh", "ah", "ooh"] as const)[Math.floor(Math.random() * 3)],
        count: 2,
        attack: 0.12,
        spread: 30,
        space: 0.7,
      });
    } else if (roll < 0.68) {
      // A pocket of the park applauding something the rest of it missed.
      this.scatter({
        start: now + Math.random() * 1.8,
        length: 0.9 + Math.random(),
        count: 3 + Math.floor(Math.random() * 6),
        gain: 0.12,
        space: 0.65,
      });
    } else if (roll < 0.78) {
      // One voice carrying over the rest, the way one always does.
      const low = 190 + Math.random() * 110;
      this.voices({
        start: now + Math.random() * 2,
        length: 0.3 + Math.random() * 0.3,
        gain: 0.12,
        from: low,
        to: low * (1.05 + Math.random() * 0.2),
        vowel: "ah",
        count: 1,
        attack: 0.03,
        spread: 12,
        space: 0.75,
      });
    } else if (roll < 0.85) {
      this.fanWhistle(now + Math.random() * 1.8);
    }
    // Otherwise: nothing. A park that produces an event every two seconds on
    // schedule is its own kind of tell.
  }

  /** Two fingers and a lot of air, somewhere up in the deck. */
  private fanWhistle(start: number) {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    const base = 1700 + Math.random() * 900;
    const length = 0.22 + Math.random() * 0.2;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base, start);
    osc.frequency.exponentialRampToValueAtTime(base * 1.25, start + length * 0.4);
    osc.frequency.exponentialRampToValueAtTime(base * 1.1, start + length);

    const amp = this.gate();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(0.045, start + 0.04);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length);

    osc.connect(amp);
    this.sink(amp, 0.8);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  /**
   * Swell the park for a few seconds. A crowd that has just cheered does not
   * drop straight back to its resting murmur, and the tail is most of what
   * makes a big moment feel like it mattered.
   */
  private stir(amount: number) {
    const ctx = this.ctx;
    const bed = this.bed;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    const peak = BED_GAIN * (1 + amount * 1.6);
    bed.gain.gain.cancelScheduledValues(now);
    bed.gain.gain.setValueAtTime(Math.max(bed.gain.gain.value, 0.0001), now);
    bed.gain.gain.exponentialRampToValueAtTime(peak, now + 0.6);
    bed.gain.gain.exponentialRampToValueAtTime(BED_GAIN, now + 2.5 + amount * 4);
  }

  dispose() {
    this.stopBed();
    this.wantBed = false;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.dry = null;
    this.send = null;
    this.noise = null;
    this.bright = null;
  }
}

export const sfx = new Sfx();
