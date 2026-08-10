import { Color, Vector3 } from "three";

/**
 * Celebration effects: confetti for runs, fireworks for the big ones.
 *
 * Plain arrays of particles updated on the animation clock. The renderer reads
 * them each frame and pushes them into instanced meshes, so nothing here
 * touches React or three.js objects beyond Vector3/Color.
 */

export interface Particle {
  pos: Vector3;
  vel: Vector3;
  color: Color;
  /** Seconds remaining. */
  life: number;
  maxLife: number;
  size: number;
  /** Tumble, radians per second, per axis. */
  spin: Vector3;
  rot: Vector3;
  gravity: number;
  drag: number;
  /** Confetti flutters side to side as it falls. */
  flutter: number;
  phase: number;
}

interface Shell {
  pos: Vector3;
  vel: Vector3;
  fuse: number;
  color: Color;
  sparks: number;
  spread: number;
}

const MAX_CONFETTI = 900;
const MAX_SPARKS = 1400;

const CONFETTI_EXTRA = ["#ffd447", "#ff6b6b", "#4ecdc4", "#f7f7f2", "#b388ff"];
const FIREWORK_BRIGHTS = ["#ffd447", "#ff5f8f", "#5ce1e6", "#b6ff5c", "#ffffff"];

/** Lift a color to something that reads as a firework against a bright sky. */
function brighten(hex: string): Color {
  const color = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return color.setHSL(hsl.h, Math.max(0.75, hsl.s), Math.max(0.6, hsl.l));
}

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class Fx {
  confetti: Particle[] = [];
  sparks: Particle[] = [];
  private shells: Shell[] = [];
  private lastUpdate = 0;
  /** Fired when a shell bursts, so audio can land with the flash. */
  onBurst?: (intensity: number) => void;

  get active(): boolean {
    return this.confetti.length > 0 || this.sparks.length > 0 || this.shells.length > 0;
  }

  clear() {
    this.lastUpdate = 0;
    this.confetti.length = 0;
    this.sparks.length = 0;
    this.shells.length = 0;
  }

  /** A burst of tumbling paper above a point. */
  burstConfetti(origin: Vector3, count: number, palette: string[]) {
    const colors = [...palette, ...CONFETTI_EXTRA].map((hex) => new Color(hex));
    for (let i = 0; i < count; i++) {
      if (this.confetti.length >= MAX_CONFETTI) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = randomIn(6, 26);
      this.confetti.push({
        pos: origin.clone().add(
          new Vector3(randomIn(-8, 8), randomIn(-2, 6), randomIn(-8, 8)),
        ),
        vel: new Vector3(
          Math.cos(angle) * speed * 0.45,
          randomIn(18, 40),
          Math.sin(angle) * speed * 0.45,
        ),
        color: colors[Math.floor(Math.random() * colors.length)].clone(),
        life: randomIn(2.6, 4.6),
        maxLife: 4.6,
        size: randomIn(0.85, 1.7),
        spin: new Vector3(randomIn(-8, 8), randomIn(-8, 8), randomIn(-8, 8)),
        rot: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        gravity: -26,
        drag: 0.6,
        flutter: randomIn(1.2, 3.2),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Launch a shell that climbs, then bursts into sparks. */
  launchFirework(origin: Vector3, color: string, opts: { sparks?: number; spread?: number; delay?: number } = {}) {
    const shell: Shell = {
      pos: origin.clone(),
      vel: new Vector3(randomIn(-5, 5), randomIn(38, 50), randomIn(-5, 5)),
      fuse: (opts.delay ?? 0) + randomIn(0.95, 1.2),
      color: brighten(color),
      sparks: opts.sparks ?? 90,
      spread: opts.spread ?? 34,
    };
    this.shells.push(shell);
  }

  /** A volley of shells spread across the outfield sky. */
  fireworkShow(center: Vector3, count: number, palette: string[]) {
    for (let i = 0; i < count; i++) {
      const offset = new Vector3(randomIn(-165, 165), 0, randomIn(-55, 55));
      // Alternate club colors with festival brights.
      const color =
        i % 2 === 0
          ? palette[Math.floor(i / 2) % palette.length]
          : FIREWORK_BRIGHTS[i % FIREWORK_BRIGHTS.length];
      this.launchFirework(center.clone().add(offset), color, {
        sparks: 80 + Math.floor(Math.random() * 60),
        spread: randomIn(28, 46),
        delay: i * randomIn(0.25, 0.6),
      });
    }
  }

  private burst(shell: Shell) {
    const count = Math.min(shell.sparks, MAX_SPARKS - this.sparks.length);
    for (let i = 0; i < count; i++) {
      // Even-ish distribution on a sphere.
      const theta = Math.random() * Math.PI * 2;
      const z = randomIn(-1, 1);
      const r = Math.sqrt(1 - z * z);
      const dir = new Vector3(r * Math.cos(theta), z, r * Math.sin(theta));
      const speed = shell.spread * randomIn(0.55, 1);
      this.sparks.push({
        pos: shell.pos.clone(),
        vel: dir.multiplyScalar(speed),
        color: shell.color.clone().offsetHSL(randomIn(-0.04, 0.04), 0, randomIn(-0.05, 0.12)),
        life: randomIn(1.6, 2.9),
        maxLife: 2.9,
        size: randomIn(1.1, 2.1),
        spin: new Vector3(),
        rot: new Vector3(),
        gravity: -16,
        drag: 1.5,
        flutter: 0,
        phase: 0,
      });
    }
    this.onBurst?.(Math.min(1, shell.sparks / 110));
  }

  /**
   * Advances on the wall clock rather than the frame delta, so a low frame
   * rate costs smoothness instead of leaving confetti hanging in mid-air. The
   * clamp keeps a backgrounded tab from teleporting everything on return.
   */
  update() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = this.lastUpdate === 0 ? 0.016 : (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    const step = Math.min(Math.max(elapsed, 0), 0.12);
    if (step <= 0) return;

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      shell.fuse -= step;
      if (shell.fuse > 0) {
        shell.pos.addScaledVector(shell.vel, step);
        shell.vel.y -= 20 * step;
        continue;
      }
      this.burst(shell);
      this.shells.splice(i, 1);
    }

    this.step(this.confetti, step, true);
    this.step(this.sparks, step, false);
  }

  private step(list: Particle[], dt: number, flutter: boolean) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0 || p.pos.y < -2) {
        list.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      const damping = Math.max(0, 1 - p.drag * dt);
      p.vel.x *= damping;
      p.vel.z *= damping;
      if (flutter) {
        p.phase += dt * p.flutter;
        p.vel.x += Math.cos(p.phase) * p.flutter * dt * 2.2;
        p.vel.z += Math.sin(p.phase * 0.8) * p.flutter * dt * 2.2;
        p.vel.y = Math.max(p.vel.y, -16);
        p.rot.addScaledVector(p.spin, dt);
      }
      p.pos.addScaledVector(p.vel, dt);
    }
  }
}
