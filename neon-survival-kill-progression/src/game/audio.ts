// Lightweight WebAudio placeholders. Swap `play()` for real samples later.

type Sfx = "shoot" | "hit" | "death" | "levelup" | "coin" | "boss" | "hurt";

const SPECS: Record<Sfx, { f: number; f2: number; d: number; type: OscillatorType; g: number }> = {
  shoot: { f: 620, f2: 180, d: 0.07, type: "square", g: 0.05 },
  hit: { f: 320, f2: 160, d: 0.05, type: "triangle", g: 0.04 },
  death: { f: 180, f2: 50, d: 0.22, type: "sawtooth", g: 0.06 },
  levelup: { f: 440, f2: 1100, d: 0.35, type: "sine", g: 0.09 },
  coin: { f: 900, f2: 1500, d: 0.09, type: "sine", g: 0.05 },
  boss: { f: 120, f2: 40, d: 0.9, type: "sawtooth", g: 0.12 },
  hurt: { f: 260, f2: 90, d: 0.14, type: "square", g: 0.07 },
};

class AudioManager {
  ctx: AudioContext | null = null;
  enabled = true;
  private last: Record<string, number> = {};

  resume() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  play(name: Sfx, volume = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? 0) < 0.03) return; // throttle
    this.last[name] = now;
    const s = SPECS[name];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = s.type;
    osc.frequency.setValueAtTime(s.f, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, s.f2), now + s.d);
    gain.gain.setValueAtTime(s.g * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + s.d);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + s.d + 0.02);
  }

  vibrate(ms: number) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  }
}

export const audio = new AudioManager();
