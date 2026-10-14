import { audio } from "./audio";
import { Bullet, Coin, EnemyShot, FloatText, Particle, Pool, Zombie, isBossKind, type ZombieKind } from "./entities";
import { bonuses, load, update } from "./save";
import { getWeapon, type WeaponDef } from "./weapons";
import { rollPerks, type PerkDef } from "./perks";
import { ZOMBIE_SPECS } from "./entities";

export interface HudState {
  hp: number; maxHp: number; xp: number; xpNeed: number; level: number;
  coins: number; time: number; wave: number; fps: number; kills: number;
  weapon: string; perks: Record<string, number>;
  stageEndsIn: number; stageProgress: number; bossIn: number; bossActive: boolean;
  stageKills: number; killsToNext: number; bossWave: boolean;
  enemies: number; boosts: number;
  bossHp: number; bossName: string; // 0..1 combined boss health while a boss fight is on
}

export interface GameCallbacks {
  onHud: (s: HudState) => void;
  onLevelUp: (choices: PerkDef[]) => void;
  onGameOver: (r: { time: number; wave: number; kills: number; coins: number }) => void;
}

/** Approximate time-to-clear target: about 2–3 minutes at each stage's pace. */
export function stageKillTarget(stage: number) {
  return Math.round(90 + Math.min(30, Math.max(0, stage - 1) * 2));
}
export function isBossWave(stage: number) { return stage % 5 === 0; }
/** Compatibility for existing HUD imports; stages are kill-gated now. */
export function stageDuration(_stage: number) { return 150; }
export const STAGE_SECONDS = 150;

/**
 * XP pacing. The old curve (20 xp, x1.28 +6) was cleared by one swarm, so
 * perks arrived every few seconds. Now the first level-up takes ~20-25s and
 * each later one takes noticeably longer, so every pick actually matters.
 */
export const XP_FIRST = 140;
export const XP_GROWTH = 1.36;
export const XP_FLAT = 40;
export const nextXpNeed = (cur: number) => Math.round(cur * XP_GROWTH + XP_FLAT);

const rand = (a: number, b: number) => a + Math.random() * (b - a);


export class Game {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private fpsSmooth = 60;
  private hudT = 0;

  W = 0; H = 0; dpr = 1;

  // world state
  running = false;
  paused = false;
  over = false;
  time = 0;
  wave = 1;
  kills = 0;
  coins = 0;
  runCoins = 0;
  shake = 0;
  spawnT = 0;
  bossT = 0;
  surgeT = 0;
  bossWarned = false;
  bossAlive = false;
  stageT = 0; // seconds elapsed inside the current stage
  stageStartKills = 0;
  stageKills = 0;
  boosts = 0;
  curDiff = 1;

  // perk-driven state
  pendingPicks = 0;
  choosing = false;
  perkHistory: string[] = [];
  bladeAngle = 0;
  swT = 0;
  shieldReady = false;
  shieldCd = 0;
  lustStacks = 0;
  lustT = 0;

  camX = 0; camY = 0;

  // player
  px = 0; py = 0; pr = 14;
  hp = 100; maxHp = 100;
  moveSpeed = 210;
  level = 1; xp = 0; xpNeed = XP_FIRST;
  invuln = 0;
  fireCd = 0;
  facing = 0;
  droneAngle = 0;
  freeRevive = false;

  weapon: WeaponDef;
  perks: Record<string, number> = {};
  bonus = bonuses(load());

  input = { x: 0, y: 0 };
  keys = new Set<string>();

  bullets = new Pool<Bullet>(() => new Bullet(), 200);
  zombies = new Pool<Zombie>(() => new Zombie(), 150);
  coinPool = new Pool<Coin>(() => new Coin(), 150);
  particles = new Pool<Particle>(() => new Particle(), 400);
  texts = new Pool<FloatText>(() => new FloatText(), 80);
  shots = new Pool<EnemyShot>(() => new EnemyShot(), 40);

  constructor(private canvas: HTMLCanvasElement, private cb: GameCallbacks) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    const d = load();
    this.weapon = getWeapon(d.selectedWeapon);
    this.coins = d.coins;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = rect.width; this.H = rect.height;
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start() {
    const d = load();
    this.bonus = bonuses(d);
    this.weapon = getWeapon(d.selectedWeapon);
    this.coins = d.coins;
    this.runCoins = 0;
    this.maxHp = Math.round(100 * this.bonus.maxHp);
    this.hp = this.maxHp;
    this.moveSpeed = 210 * this.bonus.moveSpeed;
    this.time = 0; this.wave = 1; this.kills = 0; this.level = 1; this.xp = 0; this.xpNeed = XP_FIRST;
    this.px = 0; this.py = 0; this.spawnT = 0; this.surgeT = 20; this.shake = 0;
    this.stageT = 0; this.stageStartKills = 0; this.stageKills = 0; this.bossT = 0;
    this.bossWarned = false; this.bossAlive = false; this.boosts = 0;
    this.perks = {}; this.over = false; this.paused = false; this.freeRevive = false;
    this.pendingPicks = 0; this.choosing = false; this.perkHistory = [];
    this.bladeAngle = 0; this.swT = 0; this.shieldReady = false; this.shieldCd = 0;
    this.lustStacks = 0; this.lustT = 0; this.curDiff = 1;
    this.shots.clear();

    this.bullets.clear(); this.zombies.clear(); this.coinPool.clear();
    this.particles.clear(); this.texts.clear();
    this.running = true;
    this.lastT = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    update((s) => { s.stats.runs++; });
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.lastT = performance.now();
  }

  addPerk(id: string) {
    this.perks[id] = (this.perks[id] ?? 0) + 1;
    if (id === "vitality") { this.maxHp += 25; this.hp = Math.min(this.maxHp, this.hp + 25); }
    if (id === "shield") { this.shieldReady = true; this.shieldCd = 0; }
    this.choosing = false;
    this.pendingPicks = Math.max(0, this.pendingPicks - 1);
    // several level-ups banked (e.g. from a boss kill)? show the next card set
    if (this.pendingPicks > 0) {
      this.offerPerks();
      if (this.choosing) return;
    }
    this.paused = false;
    this.lastT = performance.now();
  }

  private offerPerks() {
    if (this.choosing) return;
    while (this.pendingPicks > 0) {
      const choices = rollPerks(this.perks, 3, this.perkHistory);
      if (!choices.length) {
        // every perk is maxed: convert the level-up into a heal + coins instead of soft-locking
        this.pendingPicks--;
        this.heal(this.maxHp * 0.25);
        this.syncCoins(75);
        this.floatText(this.px, this.py - 50, "BUILD MAXED +75", "#ffd166", 16);
        continue;
      }
      this.perkHistory.push(...choices.map((c) => c.id));
      if (this.perkHistory.length > 6) this.perkHistory.splice(0, this.perkHistory.length - 6);
      this.choosing = true;
      this.paused = true;
      this.cb.onLevelUp(choices);
      return;
    }
  }

  /** Ad revive: back to full health, field cleared, plus one permanent run boost. */
  revive() {
    this.over = false;
    this.hp = this.maxHp;
    this.invuln = 3;
    this.paused = false;
    this.boosts += 1;
    this.lastT = performance.now();
    // clear the field so the revive is meaningful
    this.zombies.forEachActive((z) => {
      if (!isBossKind(z.kind)) { this.deathBurst(z); z.active = false; }
    });
    this.shots.clear();
    this.floatText(this.px, this.py - 40, "BOOST +25%", "#ffd166", 20);
    audio.play("levelup");
    audio.vibrate(60);
    this.shake = 14;
    if (!this.running) { this.running = true; this.raf = requestAnimationFrame(this.loop); }
  }

  private get boostMul() {
    return 1 + this.boosts * 0.25;
  }


  private loop = (t: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switch
    this.fpsSmooth += (1 / Math.max(dt, 0.0001) - this.fpsSmooth) * 0.1;
    if (!this.paused && !this.over) this.update(dt);
    this.render();
    this.hudT += dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.emitHud(); }
  };

  private bossHud() {
    let hp = 0, max = 0, name = "";
    this.zombies.forEachActive((z) => {
      if (!isBossKind(z.kind)) return;
      hp += Math.max(0, z.hp); max += z.maxHp;
      name = name ? name + " + " + ZOMBIE_SPECS[z.kind].label : ZOMBIE_SPECS[z.kind].label;
    });
    return { bossHp: max > 0 ? hp / max : 0, bossName: name };
  }

  private emitHud() {
    this.cb.onHud({
      hp: Math.max(0, Math.round(this.hp)), maxHp: Math.round(this.maxHp),
      xp: this.xp, xpNeed: this.xpNeed, level: this.level,
      coins: this.coins, time: this.time, wave: this.wave,
      fps: Math.round(this.fpsSmooth), kills: this.kills,
      weapon: this.weapon.name, perks: { ...this.perks },
      stageEndsIn: 0,
      stageProgress: Math.min(1, this.stageKills / stageKillTarget(this.wave)),
      bossIn: Math.max(0, this.bossT),
      bossActive: this.bossAlive,
      stageKills: this.stageKills,
      killsToNext: Math.max(0, stageKillTarget(this.wave) - this.stageKills),
      bossWave: isBossWave(this.wave),
      enemies: this.zombies.countActive(),
      boosts: this.boosts,
      ...this.bossHud(),
    });
  }

  // ---------------- update ----------------
  private update(dt: number) {
    this.time += dt;
    this.stageT += dt; // display/telegraph clock only; kills control stage progression
    const s = this.time / 60; // minutes survived
    // Harder curve than before: opens rougher and accelerates faster within
    // a stage, and every stage multiplies on top so later levels are
    // meaningfully harder, not just longer.
    const stageMul = 1 + (this.wave - 1) * 0.22;
    const diff = (1 + s * 0.42 + s * s * 0.16) * stageMul;
    this.curDiff = diff;


    this.updatePlayer(dt);
    this.updateSpawns(dt, diff);
    this.updateFiring(dt);
    this.updateBullets(dt);
    this.updateZombies(dt);
    this.updateShots(dt);
    this.updatePerkEffects(dt);
    this.updateCoins(dt);
    this.updateFx(dt);

    this.camX += (this.px - this.camX) * Math.min(1, dt * 8);
    this.camY += (this.py - this.camY) * Math.min(1, dt * 8);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
  }

  private updatePlayer(dt: number) {
    let dx = this.input.x, dy = this.input.y;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const spd = this.moveSpeed * (1 + (this.perks["speed"] ?? 0) * 0.08);
    this.px += dx * spd * dt;
    this.py += dy * spd * dt;
    if (len > 0.05) this.facing = Math.atan2(dy, dx);
    if (this.invuln > 0) this.invuln -= dt;
    this.droneAngle += dt * 2.2;
  }

  private updateSpawns(dt: number, diff: number) {
    const stage = this.wave;
    const t = this.time;
    // ramp: 0 in the first seconds -> 1 around 3 min -> keeps climbing after
    const ramp = t / 180;
    // Bigger cap, faster interval, more per burst: the horde swarms the
    // shooter harder and sooner as both time and level climb.
    const cap = Math.min(560, 60 + ramp * 190 + stage * 85);
    this.spawnT -= dt;
    const interval = Math.max(0.045, 0.95 * Math.pow(0.56, ramp) * Math.pow(0.86, stage - 1));
    // Once a boss battle is underway, stop feeding in regular swarm spawns
    // so the boss fight itself is the focus and doesn't get diluted further.
    if (!this.bossAlive) {
      if (this.spawnT <= 0 && this.zombies.countActive() < cap) {
        this.spawnT = interval;
        const n = Math.max(1, Math.floor(2 + ramp * 2 + (stage - 1) * 0.8));
        for (let i = 0; i < n; i++) this.spawnZombie(this.pickKind(), diff);
      }

      // periodic encirclement: a full ring closes in on the player from every
      // side at once. Starts earlier and repeats more often at higher levels
      // so the horde regularly swarms and surrounds the shooter.
      if (t > 55) {
        this.surgeT -= dt;
        if (this.surgeT <= 0 && this.zombies.countActive() < cap) {
          this.surgeT = Math.max(5, 26 - ramp * 7 - stage * 2.6);
          const ring = Math.floor(Math.min(48, 10 + ramp * 6 + stage * 3));
          const base = Math.random() * Math.PI * 2;
          for (let i = 0; i < ring; i++) {
            this.spawnZombie(this.pickKind(), diff, base + (i / ring) * Math.PI * 2, 0.5);
          }
          this.shake = Math.max(this.shake, 6);
        }
      }
    }

    const target = stageKillTarget(stage);
    this.stageKills = this.kills - this.stageStartKills;
    this.bossT = isBossWave(stage) ? Math.max(0, target - this.stageKills) : 0;
    if (!this.bossAlive) {
      if (isBossWave(stage) && !this.bossWarned && this.bossT <= 5) {
        this.bossWarned = true;
        audio.play("boss", 0.5);
        audio.vibrate(40);
      }
      if (this.stageKills >= target && isBossWave(stage)) {
        // Boss HP is tied to the stage (not the run clock) so a fight lasts a
        // fair 40-70s; the bosses are dangerous because of their attacks.
        this.spawnBoss("rex", 1);
        // Spino joins Rex on later milestone battles.
        if (stage >= 10) this.spawnBoss("spino", 0.85);
        // Escort wave mixes every other dinosaur type, not just one — a real
        // horde alongside the boss(es), scaling with stage.
        const escortCount = Math.min(36, stage * 2);
        for (let i = 0; i < escortCount; i++) {
          const escortKind: ZombieKind =
            i % 4 === 0 ? "anky" : i % 4 === 1 ? "spitter" : i % 4 === 2 ? "ptero" : "raptor";
          this.spawnZombie(escortKind, diff);
        }
        this.bossAlive = true;
        audio.play("boss");
        audio.vibrate(200);
        this.shake = 22;
      }
    } else {
      // Boss milestone stages advance only after every boss is defeated.
      let any = false;
      this.zombies.forEachActive((z) => { if (isBossKind(z.kind)) any = true; });
      if (!any) {
        this.bossAlive = false;
        this.bossWarned = false;
        this.wave += 1;
        this.stageT = 0;
        this.stageStartKills = this.kills;
        this.stageKills = 0;
        this.floatText(this.px, this.py - 50, `WAVE ${this.wave}`, "#ffd166", 22);
        audio.play("levelup", 0.8);
        audio.vibrate(80);
        this.shake = Math.max(this.shake, 10);
      }
    }
    // Regular stages advance as soon as their kill quota is met.
    if (!this.bossAlive && !isBossWave(stage) && this.stageKills >= target) {
      this.wave += 1;
      this.stageT = 0;
      this.stageStartKills = this.kills;
      this.stageKills = 0;
      this.floatText(this.px, this.py - 50, `WAVE ${this.wave}`, "#ffd166", 22);
      audio.play("levelup", 0.8);
      audio.vibrate(60);
      this.shake = Math.max(this.shake, 8);
    }
  }

  private pickKind(): ZombieKind {
    const t = this.time;
    const stage = this.wave;
    // Higher stages pull every harder-species threshold earlier and raise
    // their odds, so later levels are dinosaur-diverse and dangerous fast.
    const push = (stage - 1) * 20;
    const r = Math.random();
    if (t + push > 130 && r < 0.09 + Math.min(0.3, (t + push) / 950)) return "anky";
    if (t + push > 80 && r < 0.22 + Math.min(0.18, stage * 0.025)) return "spitter";
    if (t + push > 50 && r < 0.20 + Math.min(0.2, stage * 0.03)) return "ptero";
    if (t + push > 20 && r < 0.62) return "compy";
    return "raptor";
  }


  private spawnBoss(kind: ZombieKind, hpScale: number) {
    const stage = this.wave;
    const a = Math.random() * Math.PI * 2;
    const rad = Math.max(this.W, this.H) * 0.6 + 80;
    const z = this.zombies.obtain();
    z.spawn(kind, this.px + Math.cos(a) * rad, this.py + Math.sin(a) * rad, 1);
    z.maxHp = z.hp = ZOMBIE_SPECS[kind].hp * (1.8 + stage * 1.4) * hpScale;
    z.damage = ZOMBIE_SPECS[kind].damage * (1 + (stage - 1) * 0.2);
    z.bCd = 2 + (kind === "spino" ? 1.2 : 0);
  }

  private spawnAt(kind: ZombieKind, x: number, y: number, mult: number) {
    const z = this.zombies.obtain();
    z.spawn(kind, x, y, mult);
  }

  private spawnZombie(kind: ZombieKind, mult: number, angle?: number, radiusScale = 1) {
    const a = angle ?? Math.random() * Math.PI * 2;
    const rad = (Math.max(this.W, this.H) * 0.6 + rand(30, 140)) * radiusScale;
    const z = this.zombies.obtain();
    z.spawn(kind, this.px + Math.cos(a) * rad, this.py + Math.sin(a) * rad, mult);
    // Elites: from ~1 minute on, some enemies show up much tougher, worth more.
    if (!isBossKind(kind) && this.time > 60) {
      const chance = Math.min(0.08, 0.015 + (this.wave - 1) * 0.01 + this.time / 7000);
      if (Math.random() < chance) {
        z.elite = true;
        z.maxHp = z.hp = z.hp * 3.5;
        z.damage *= 1.3;
        z.radius *= 1.3;
        z.xp *= 4; z.coin *= 4;
      }
    }

  }

  private nearestZombie(x: number, y: number, exclude: number[] = []) {
    let best: Zombie | null = null;
    let bd = Infinity;
    this.zombies.forEachActive((z) => {
      if (exclude.includes(z.id)) return;
      const d = (z.x - x) ** 2 + (z.y - y) ** 2;
      if (d < bd) { bd = d; best = z; }
    });
    return best as Zombie | null;
  }

  private updateFiring(dt: number) {
    const lust = this.lustStacks * 0.015 * (this.perks["bloodlust"] ?? 0);
    const rateMul = this.bonus.fireRate * this.boostMul * (1 + (this.perks["reload"] ?? 0) * 0.2) * (1 + lust);
    this.fireCd -= dt;
    if (this.fireCd > 0) return;
    const target = this.nearestZombie(this.px, this.py);
    if (!target) return;
    this.fireCd = 1 / (this.weapon.fireRate * rateMul);
    const ang = Math.atan2(target.y - this.py, target.x - this.px);
    this.facing = ang;
    this.shoot(this.px, this.py, ang);
    // drone companion
    const drones = this.perks["drone"] ?? 0;
    for (let i = 0; i < drones; i++) {
      const a = this.droneAngle + (i * Math.PI * 2) / drones;
      const dx = this.px + Math.cos(a) * 44, dy = this.py + Math.sin(a) * 44;
      const dt2 = this.nearestZombie(dx, dy);
      if (dt2) this.shoot(dx, dy, Math.atan2(dt2.y - dy, dt2.x - dx), 0.5);
    }
    audio.play("shoot", 0.8);
  }

  private shoot(x: number, y: number, ang: number, dmgMul = 1) {
    const w = this.weapon;
    const big = 1 + (this.perks["bigbullets"] ?? 0) * 0.35;
    const count = w.count + (this.perks["multishot"] ?? 0);
    const speed = w.speed * this.bonus.bulletSpeed;
    for (let i = 0; i < count; i++) {
      const spread = w.spread * (count > 1 ? 1 : 0.6);
      const off = count > 1 ? (i / (count - 1) - 0.5) * spread * 2 : rand(-spread, spread);
      const a = ang + off + rand(-0.02, 0.02);
      const b = this.bullets.obtain();
      const crit = Math.random() < this.bonus.crit + (this.perks["crit"] ?? 0) * 0.08;
      b.x = x; b.y = y;
      b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed;
      b.damage = w.damage * this.bonus.damage * this.boostMul * big * dmgMul * (1 + (this.perks["power"] ?? 0) * 0.12) * (crit ? 2.2 : 1);
      b.crit = crit;
      b.size = w.size * big;
      b.life = w.kind === "laser" ? 0.6 : 1.6;
      b.pierce = w.pierce + (this.perks["pierce"] ?? 0);
      b.color = w.color;
      b.kind = w.kind;
      b.explosive = w.explosive ?? 0;
      b.chain = w.chain ?? 0;
      b.ricochet = this.perks["ricochet"] ?? 0;
      b.hitIds.length = 0;
      b.trail.length = 0;
    }
    this.spawnParticles(x + Math.cos(ang) * 16, y + Math.sin(ang) * 16, 3, w.color, 90, 0.18);
  }

  private updateBullets(dt: number) {
    this.bullets.forEachActive((b) => {
      b.life -= dt;
      if (b.life <= 0) { b.active = false; return; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.trail.push(b.x, b.y);
      if (b.trail.length > 8) b.trail.splice(0, 2);
      let hit: Zombie | null = null;
      this.zombies.forEachActive((z) => {
        if (hit || b.hitIds.includes(z.id)) return;
        const r = z.radius + b.size;
        if ((z.x - b.x) ** 2 + (z.y - b.y) ** 2 < r * r) hit = z;
      });
      if (!hit) return;
      const z = hit as Zombie;
      b.hitIds.push(z.id);
      this.damage(z, b.damage, b.crit);
      if (b.explosive) this.explode(b.x, b.y, b.explosive, b.damage * 0.8);
      const frag = this.perks["frag"] ?? 0;
      if (frag && Math.random() < frag * 0.12) this.explode(b.x, b.y, 55, b.damage * 0.6);
      if (b.chain > 0) {
        let src = z;
        for (let c = 0; c < b.chain; c++) {
          const nx = this.nearestZombie(src.x, src.y, b.hitIds);
          if (!nx || Math.hypot(nx.x - src.x, nx.y - src.y) > 220) break;
          b.hitIds.push(nx.id);
          this.damage(nx, b.damage * 0.7, false);
          this.lightningFx(src.x, src.y, nx.x, nx.y);
          src = nx;
        }
      }
      if (this.perks["burn"]) z.burn = Math.max(z.burn, 2 + (this.perks["burn"] ?? 0));
      if (this.perks["poison"]) z.poison = Math.max(z.poison, 3 + (this.perks["poison"] ?? 0));
      if (this.perks["freeze"]) z.slow = 1 + (this.perks["freeze"] ?? 0) * 0.4;
      if (b.pierce > 0) { b.pierce--; return; }
      if (b.ricochet > 0) {
        const nx = this.nearestZombie(b.x, b.y, b.hitIds);
        if (nx) {
          b.ricochet--;
          const a = Math.atan2(nx.y - b.y, nx.x - b.x);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
          return;
        }
      }
      b.active = false;
    });
  }

  private damage(z: Zombie, amount: number, crit: boolean) {
    const ex = this.perks["execute"] ?? 0;
    if (ex && z.hp <= z.maxHp * 0.3) amount *= 1 + ex * 0.3;
    z.hp -= amount;
    z.hitFlash = 0.12;
    this.floatText(z.x, z.y - z.radius, Math.round(amount).toString(), crit ? "#ffd166" : "#ffffff", crit ? 20 : 14);
    this.spawnParticles(z.x, z.y, crit ? 6 : 3, z.color, 130, 0.25);
    audio.play("hit", 0.5);
    if (z.hp <= 0) this.kill(z);
  }

  private kill(z: Zombie) {
    if (!z.active) return;
    z.active = false;
    this.kills++;
    this.deathBurst(z);
    // satisfying but restrained kill feedback: louder + a short buzz for big enemies only
    const boss = isBossKind(z.kind);
    const heavy = boss || z.kind === "anky";
    audio.play("death", boss ? 1 : z.kind === "anky" ? 0.7 : 0.45);
    if (heavy) audio.play("hit", 0.6);
    if (boss) { this.shake = 26; audio.vibrate(140); }
    else if (z.kind === "anky") { this.shake = Math.max(this.shake, 6); audio.vibrate(25); }
    else if (this.kills % 6 === 0) audio.vibrate(8);

    if (z.kind === "spitter") this.explode(z.x, z.y, 70, z.damage * 0.6, true);
    if (this.perks["boom"]) this.explode(z.x, z.y, 60 + (this.perks["boom"] ?? 0) * 20, 18 * (this.perks["boom"] ?? 0));
    if (this.perks["lifesteal"]) this.heal((this.perks["lifesteal"] ?? 0) * 0.6);
    if (this.perks["bloodlust"]) { this.lustT = 3; this.lustStacks = Math.min(15, this.lustStacks + 1); }
    // coins
    const drops = boss ? 8 : Math.random() < 0.55 ? 1 : 0;
    for (let i = 0; i < drops; i++) {
      const c = this.coinPool.obtain();
      c.x = z.x + rand(-10, 10); c.y = z.y + rand(-10, 10);
      c.vx = rand(-60, 60); c.vy = rand(-60, 60);
      c.value = Math.max(1, Math.round((z.coin / Math.max(1, drops)) * (1 + this.time / 300) * (1 + (this.perks["fortune"] ?? 0) * 0.2)));
      c.life = 26; c.t = 0;
    }
    this.gainXp(z.xp);
  }

  private deathBurst(z: Zombie) {
    this.spawnParticles(z.x, z.y, isBossKind(z.kind) ? 40 : 10, z.color, 200, 0.5);
  }

  private explode(x: number, y: number, radius: number, dmg: number, hurtPlayer = false) {
    this.shake = Math.max(this.shake, 8);
    this.spawnParticles(x, y, 22, "#ff9d4a", 320, 0.45, true);
    this.zombies.forEachActive((z) => {
      if ((z.x - x) ** 2 + (z.y - y) ** 2 < (radius + z.radius) ** 2) this.damage(z, dmg, false);
    });
    if (hurtPlayer && (this.px - x) ** 2 + (this.py - y) ** 2 < radius * radius) this.hurt(dmg);
    audio.vibrate(30);
  }

  private lightningFx(x1: number, y1: number, x2: number, y2: number) {
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = this.particles.obtain();
      p.x = x1 + (x2 - x1) * t + rand(-8, 8);
      p.y = y1 + (y2 - y1) * t + rand(-8, 8);
      p.vx = 0; p.vy = 0;
      p.life = p.maxLife = 0.16; p.size = 3; p.color = "#9d7bff"; p.glow = true;
    }
  }

  private updateZombies(dt: number) {
    this.zombies.forEachActive((z) => {
      const slowMul = z.slow > 0 ? 0.5 : 1;
      if (z.slow > 0) z.slow -= dt;
      if (z.hitFlash > 0) z.hitFlash -= dt;
      if (z.burn > 0) { z.burn -= dt; z.hp -= 8 * dt; if (Math.random() < dt * 8) this.spawnParticles(z.x, z.y, 1, "#ff8a3d", 40, 0.3); }
      if (z.poison > 0) { z.poison -= dt; z.hp -= 6 * dt; if (Math.random() < dt * 5) this.spawnParticles(z.x, z.y, 1, "#8cff5e", 30, 0.4); }
      if (z.hp <= 0) { this.kill(z); return; }

      z.wobble += dt * 6;
      if (z.bladeCd > 0) z.bladeCd -= dt;
      const boss = isBossKind(z.kind);
      if (boss) {
        this.updateBoss(z, dt, slowMul);
      } else {
        const a = Math.atan2(this.py - z.y, this.px - z.x);
        const sp = z.speed * slowMul;
        z.x += Math.cos(a) * sp * dt;
        z.y += Math.sin(a) * sp * dt;
      }

      const dist = Math.hypot(this.px - z.x, this.py - z.y);
      z.attackCd -= dt;
      if (dist < z.radius + this.pr && !(boss && z.bState === "charge")) {
        if (z.kind === "spitter") { this.kill(z); return; }
        if (z.attackCd <= 0) { z.attackCd = 0.8; this.hurt(z.damage); }
      }
    });
    // simple separation so zombies don't fully stack
    const list = this.zombies.items.filter((z) => z.active);
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      for (let j = i + 1; j < Math.min(list.length, i + 8); j++) {
        const b = list[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = a.radius + b.radius;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.5;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }

  private hurt(amount: number) {
    if (this.invuln > 0 || this.over) return;
    if (this.shieldReady) {
      this.shieldReady = false;
      this.shieldCd = Math.max(5, 15 - (this.perks["shield"] ?? 1) * 3);
      this.invuln = 0.6;
      this.spawnParticles(this.px, this.py, 14, "#7ff5ff", 220, 0.4, true);
      this.floatText(this.px, this.py - 28, "BLOCKED", "#7ff5ff", 16);
      audio.play("hit", 0.7);
      return;
    }
    amount *= 1 - Math.min(0.6, (this.perks["armor"] ?? 0) * 0.08);
    this.hp -= amount;
    this.invuln = 0.5;
    this.shake = Math.max(this.shake, 7);
    audio.play("hurt");
    audio.vibrate(40);
    this.floatText(this.px, this.py - 24, `-${Math.round(amount)}`, "#ff5d6c", 16);
    if (this.hp <= 0) this.endRun();
  }

  private heal(v: number) {
    this.hp = Math.min(this.maxHp, this.hp + v);
  }

  private gainXp(v: number) {
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = nextXpNeed(this.xpNeed);
      this.heal(this.maxHp * 0.1);
      audio.play("levelup");
      this.pendingPicks++;
    }
    if (this.pendingPicks > 0) this.offerPerks();
  }

  // ---------------- boss brain ----------------
  private bossAbilities(kind: ZombieKind, phase: number): ("charge" | "stomp" | "spit" | "roar")[] {
    if (kind === "rex") {
      if (phase === 1) return ["charge", "stomp"];
      if (phase === 2) return ["charge", "stomp", "roar"];
      return ["charge", "stomp", "roar", "charge"];
    }
    // spino
    if (phase === 1) return ["spit", "charge"];
    if (phase === 2) return ["spit", "stomp", "charge"];
    return ["spit", "spit", "stomp", "charge"];
  }

  private updateBoss(z: Zombie, dt: number, slowMul: number) {
    const ratio = z.hp / z.maxHp;
    const phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (phase !== z.phase) {
      z.phase = phase;
      this.floatText(z.x, z.y - z.radius - 24, phase === 3 ? "ENRAGED!" : "PHASE 2", "#ff3d7f", 24);
      this.shake = Math.max(this.shake, 16);
      audio.play("boss", 0.6);
      z.bCd = Math.min(z.bCd, 1.2);
    }
    const rage = phase === 3 ? 1.3 : phase === 2 ? 1.12 : 1;
    const cdMul = phase === 3 ? 0.6 : phase === 2 ? 0.8 : 1;
    const dx = this.px - z.x, dy = this.py - z.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (z.bState === "chase") {
      z.x += (dx / dist) * z.speed * rage * slowMul * dt;
      z.y += (dy / dist) * z.speed * rage * slowMul * dt;
      z.bCd -= dt;
      if (z.bCd <= 0) {
        const opts = this.bossAbilities(z.kind, phase).filter((a) => a !== z.bLast);
        const ab = opts[Math.floor(Math.random() * opts.length)] ?? "charge";
        z.bAbility = ab; z.bLast = ab; z.bState = "windup";
        z.bTotal = z.bT = ab === "spit" ? 0.65 : ab === "roar" ? 0.85 : 0.95;
        z.bDirX = dx / dist; z.bDirY = dy / dist;
        const label = ab === "charge" ? "CHARGE!" : ab === "stomp" ? "STOMP!" : ab === "spit" ? "ACID!" : "ROAR!";
        this.floatText(z.x, z.y - z.radius - 20, label, "#ff5d6c", 20);
        audio.play("boss", 0.35);
      }
    } else if (z.bState === "windup") {
      z.bT -= dt;
      // keep tracking the player until the last moment, then lock the charge lane
      if (z.bAbility === "charge" && z.bT > 0.3) { z.bDirX = dx / dist; z.bDirY = dy / dist; }
      if (z.bT <= 0) {
        if (z.bAbility === "charge") {
          z.bState = "charge"; z.bT = 0.75; z.bHit = false;
        } else if (z.bAbility === "stomp") {
          const R = this.stompRadius(z);
          if (dist < R + this.pr) this.hurt(z.damage * 0.9);
          this.spawnParticles(z.x, z.y, 40, z.color, 420, 0.5, true);
          this.shake = Math.max(this.shake, 18);
          audio.play("hit", 0.9);
          z.bState = "recover"; z.bT = 0.7;
        } else if (z.bAbility === "spit") {
          const n = 5 + phase * 2;
          const base = Math.atan2(dy, dx);
          for (let i = 0; i < n; i++) {
            const sh = this.shots.obtain();
            const a = base + (i / (n - 1) - 0.5) * 1.15;
            sh.x = z.x; sh.y = z.y;
            sh.vx = Math.cos(a) * 250; sh.vy = Math.sin(a) * 250;
            sh.damage = z.damage * 0.4; sh.radius = 7; sh.life = 4; sh.color = "#9dff4a";
          }
          audio.play("shoot", 0.6);
          z.bState = "recover"; z.bT = 0.5;
        } else {
          // roar: call in the pack
          const n = Math.min(18, 6 + this.wave * 2);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const kind: ZombieKind = phase === 3 && i % 4 === 0 ? "spitter" : i % 3 === 0 ? "compy" : "raptor";
            this.spawnAt(kind, z.x + Math.cos(a) * 110, z.y + Math.sin(a) * 110, this.curDiff);
          }
          this.shake = Math.max(this.shake, 14);
          audio.play("boss", 0.5);
          z.bState = "recover"; z.bT = 0.8;
        }
      }
    } else if (z.bState === "charge") {
      z.x += z.bDirX * 480 * rage * dt;
      z.y += z.bDirY * 480 * rage * dt;
      z.bT -= dt;
      if (!z.bHit && dist < z.radius + this.pr + 6) { z.bHit = true; this.hurt(z.damage * 1.3); }
      if (Math.random() < dt * 40) this.spawnParticles(z.x, z.y, 2, z.color, 120, 0.3, true);
      if (z.bT <= 0) { z.bState = "recover"; z.bT = 0.9; this.shake = Math.max(this.shake, 10); }
    } else {
      // recover: standing still = the window to punish
      z.bT -= dt;
      if (z.bT <= 0) { z.bState = "chase"; z.bCd = (3 + Math.random() * 1.5) * cdMul; }
    }
  }

  private stompRadius(z: Zombie) { return 150 + z.phase * 20; }

  private updateShots(dt: number) {
    this.shots.forEachActive((s) => {
      s.life -= dt;
      if (s.life <= 0) { s.active = false; return; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if ((this.px - s.x) ** 2 + (this.py - s.y) ** 2 < (s.radius + this.pr) ** 2) {
        s.active = false;
        this.spawnParticles(s.x, s.y, 6, s.color, 140, 0.25);
        this.hurt(s.damage);
      }
    });
  }

  // ---------------- perk effects that tick over time ----------------
  private updatePerkEffects(dt: number) {
    const stageDmg = this.bonus.damage * this.boostMul * (1 + (this.perks["power"] ?? 0) * 0.12) * (1 + (this.wave - 1) * 0.15);

    const regen = this.perks["regen"] ?? 0;
    if (regen) this.heal(regen * 0.7 * dt);

    if (this.perks["shield"] && !this.shieldReady) {
      this.shieldCd -= dt;
      if (this.shieldCd <= 0) this.shieldReady = true;
    }

    if (this.lustT > 0) { this.lustT -= dt; if (this.lustT <= 0) this.lustStacks = 0; }

    // Plasma Blades
    const bl = this.perks["blades"] ?? 0;
    this.bladeAngle += dt * 3.4;
    if (bl) {
      const n = bl + 1;
      const dmg = (14 + bl * 9) * stageDmg;
      for (let i = 0; i < n; i++) {
        const a = this.bladeAngle + (i * Math.PI * 2) / n;
        const bx = this.px + Math.cos(a) * 68, by = this.py + Math.sin(a) * 68;
        this.zombies.forEachActive((z) => {
          if (z.bladeCd > 0) return;
          const r = z.radius + 10;
          if ((z.x - bx) ** 2 + (z.y - by) ** 2 < r * r) {
            z.bladeCd = 0.35;
            this.damage(z, dmg, false);
          }
        });
      }
    }

    // Shockwave Pulse
    const sw = this.perks["shockwave"] ?? 0;
    if (sw) {
      this.swT -= dt;
      if (this.swT <= 0) {
        this.swT = Math.max(3.5, 8 - sw * 1.2);
        const R = 130 + sw * 25;
        const dmg = (40 + sw * 25) * stageDmg;
        this.zombies.forEachActive((z) => {
          const d = Math.hypot(z.x - this.px, z.y - this.py);
          if (d < R + z.radius) {
            this.damage(z, dmg, false);
            if (z.active && !isBossKind(z.kind) && d > 0.01) {
              z.x += ((z.x - this.px) / d) * 70;
              z.y += ((z.y - this.py) / d) * 70;
            }
          }
        });
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const p = this.particles.obtain();
          p.x = this.px + Math.cos(a) * R * 0.5; p.y = this.py + Math.sin(a) * R * 0.5;
          p.vx = Math.cos(a) * R * 1.4; p.vy = Math.sin(a) * R * 1.4;
          p.life = p.maxLife = 0.35; p.size = 4; p.color = "#7ff5ff"; p.glow = true;
        }
      }
    }
  }


  private updateCoins(dt: number) {
    const magnet = 90 * this.bonus.magnet * (1 + (this.perks["magnet"] ?? 0) * 0.35);
    this.coinPool.forEachActive((c) => {
      c.life -= dt; c.t += dt;
      if (c.life <= 0) { c.active = false; return; }
      const dx = this.px - c.x, dy = this.py - c.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < magnet) {
        const pull = 400 * (1 - d / magnet) + 120;
        c.vx += (dx / d) * pull * dt * 6;
        c.vy += (dy / d) * pull * dt * 6;
      }
      c.vx *= 0.94; c.vy *= 0.94;
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (d < this.pr + 8) {
        c.active = false;
        this.coins += c.value;
        this.runCoins += c.value;
        audio.play("coin", 0.4);
        this.floatText(c.x, c.y, `+${c.value}`, "#ffd166", 12);
      }
    });
  }

  private updateFx(dt: number) {
    this.particles.forEachActive((p) => {
      p.life -= dt;
      if (p.life <= 0) { p.active = false; return; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.93; p.vy *= 0.93;
    });
    this.texts.forEachActive((t) => {
      t.life -= dt;
      if (t.life <= 0) { t.active = false; return; }
      t.y += t.vy * dt;
      t.vy *= 0.94;
    });
  }

  private spawnParticles(x: number, y: number, n: number, color: string, speed: number, life: number, glow = false) {
    for (let i = 0; i < n; i++) {
      const p = this.particles.obtain();
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.3, speed);
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.life = p.maxLife = life * rand(0.6, 1.2);
      p.size = rand(2, 4.5);
      p.color = color; p.glow = glow;
    }
  }

  private floatText(x: number, y: number, text: string, color: string, size: number) {
    const t = this.texts.obtain();
    t.x = x + rand(-6, 6); t.y = y; t.vy = -46; t.life = 0.75;
    t.text = text; t.color = color; t.size = size;
  }

  private endRun() {
    this.over = true;
    this.hp = 0;
    this.shake = 20;
    const res = { time: this.time, wave: this.wave, kills: this.kills, coins: this.runCoins };
    update((s) => {
      s.coins = this.coins;
      s.stats.kills += this.kills;
      s.stats.coinsEarned += this.runCoins;
      s.stats.bestTime = Math.max(s.stats.bestTime, this.time);
      s.stats.bestWave = Math.max(s.stats.bestWave, this.wave);
      s.scores = [...s.scores, { time: this.time, wave: this.wave, kills: this.kills, date: Date.now() }]
        .sort((a, b) => b.time - a.time)
        .slice(0, 10);
    });
    this.emitHud();
    this.cb.onGameOver(res);
  }

  /** Persist coins mid-run (used by ad rewards / quitting). */
  syncCoins(delta = 0) {
    this.coins += delta;
    this.runCoins += delta;
    update((s) => { s.coins = this.coins; if (delta > 0) s.stats.coinsEarned += delta; });
    this.emitHud();
  }

  // ---------------- render ----------------
  private render() {
    const ctx = this.ctx;
    const sx = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
    const sy = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
    ctx.fillStyle = "#08070f";
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(this.W / 2 - this.camX + sx, this.H / 2 - this.camY + sy);

    this.drawGrid();

    // coins
    this.coinPool.forEachActive((c) => {
      const pulse = 1 + Math.sin(c.t * 8) * 0.15;
      ctx.beginPath();
      ctx.fillStyle = "#ffd166";
      ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 12;
      ctx.arc(c.x, c.y, 5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // boss telegraphs sit under everything so the danger zone is readable
    this.zombies.forEachActive((z) => { if (isBossKind(z.kind) && z.bState === "windup") this.drawTelegraph(z); });

    // zombies
    this.zombies.forEachActive((z) => this.drawZombie(z));

    // enemy acid shots
    this.shots.forEachActive((sh) => {
      ctx.beginPath();
      ctx.fillStyle = sh.color;
      ctx.shadowColor = sh.color; ctx.shadowBlur = 14;
      ctx.arc(sh.x, sh.y, sh.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // bullets
    this.bullets.forEachActive((b) => {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.size * 0.8;
      ctx.lineCap = "round";
      ctx.shadowColor = b.color; ctx.shadowBlur = 10;
      ctx.beginPath();
      if (b.trail.length >= 4) {
        ctx.moveTo(b.trail[0]!, b.trail[1]!);
        for (let i = 2; i < b.trail.length; i += 2) ctx.lineTo(b.trail[i]!, b.trail[i + 1]!);
      } else {
        ctx.moveTo(b.x - b.vx * 0.01, b.y - b.vy * 0.01);
      }
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = b.color;
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    this.drawPlayer();

    // particles
    this.particles.forEachActive((p) => {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    // damage numbers
    ctx.textAlign = "center";
    this.texts.forEachActive((t) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / 0.5));
      ctx.fillStyle = t.color;
      ctx.font = `700 ${t.size}px ui-monospace, monospace`;
      ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // vignette
    const g = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  private drawTelegraph(z: Zombie) {
    const ctx = this.ctx;
    const prog = 1 - z.bT / z.bTotal; // 0 -> 1 as the attack winds up
    ctx.save();
    ctx.fillStyle = `rgba(255,61,127,${0.10 + prog * 0.25})`;
    ctx.strokeStyle = `rgba(255,93,108,${0.5 + prog * 0.5})`;
    ctx.lineWidth = 2;
    if (z.bAbility === "charge") {
      const len = 480 * 0.75 * (z.phase === 3 ? 1.3 : z.phase === 2 ? 1.12 : 1);
      ctx.translate(z.x, z.y);
      ctx.rotate(Math.atan2(z.bDirY, z.bDirX));
      ctx.fillRect(0, -z.radius, len, z.radius * 2);
      ctx.strokeRect(0, -z.radius, len, z.radius * 2);
    } else if (z.bAbility === "stomp") {
      const R = this.stompRadius(z);
      ctx.beginPath(); ctx.arc(z.x, z.y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(z.x, z.y, R * prog, 0, Math.PI * 2); ctx.fill();
    } else if (z.bAbility === "spit") {
      const a = Math.atan2(this.py - z.y, this.px - z.x);
      ctx.strokeStyle = `rgba(157,255,74,${0.4 + prog * 0.5})`;
      for (const off of [-0.575, 0, 0.575]) {
        ctx.beginPath();
        ctx.moveTo(z.x, z.y);
        ctx.lineTo(z.x + Math.cos(a + off) * 420, z.y + Math.sin(a + off) * 420);
        ctx.stroke();
      }
    } else {
      ctx.beginPath(); ctx.arc(z.x, z.y, 110 * (0.6 + prog * 0.4), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawGrid() {
    const ctx = this.ctx;
    const step = 80;
    const x0 = Math.floor((this.camX - this.W / 2) / step) * step;
    const y0 = Math.floor((this.camY - this.H / 2) / step) * step;
    ctx.strokeStyle = "rgba(120,90,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < this.camX + this.W; x += step) {
      ctx.moveTo(x, y0); ctx.lineTo(x, y0 + this.H + step * 2);
    }
    for (let y = y0; y < this.camY + this.H; y += step) {
      ctx.moveTo(x0, y); ctx.lineTo(x0 + this.W + step * 2, y);
    }
    ctx.stroke();
  }

  private drawZombie(z: Zombie) {
    const ctx = this.ctx;
    const boss = isBossKind(z.kind);
    const w = Math.sin(z.wobble) * (z.kind === "ptero" ? 4 : 2);
    ctx.save();
    ctx.translate(z.x, z.y + w);
    ctx.shadowColor = boss && z.phase === 3 ? "#ff2d2d" : z.color;
    ctx.shadowBlur = boss ? 30 : 12;

    // Species silhouette, drawn behind the body so the body reads on top.
    ctx.fillStyle = z.hitFlash > 0 ? "#ffffff" : z.color;
    ctx.globalAlpha = 0.9;
    if (z.kind === "ptero") {
      // wide swept wings for the flying swarmer
      const wa = Math.sin(z.wobble * 3) * 0.5 + 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-z.radius * 2.1, -z.radius * 0.9 * wa);
      ctx.lineTo(-z.radius * 0.6, z.radius * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(z.radius * 2.1, -z.radius * 0.9 * wa);
      ctx.lineTo(z.radius * 0.6, z.radius * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (z.kind === "anky") {
      // armored plates along the back
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * z.radius * 0.55 - z.radius * 0.22, -z.radius * 0.85);
        ctx.lineTo(i * z.radius * 0.55, -z.radius * 1.35);
        ctx.lineTo(i * z.radius * 0.55 + z.radius * 0.22, -z.radius * 0.85);
        ctx.closePath();
        ctx.fill();
      }
    } else if (z.kind === "raptor" || z.kind === "compy") {
      // small dorsal spikes for the pack hunters
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * z.radius * 0.5, -z.radius * 0.9, z.radius * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (z.kind === "spitter") {
      // frill either side of the head
      ctx.beginPath();
      ctx.moveTo(-z.radius * 0.9, -z.radius * 0.2);
      ctx.lineTo(-z.radius * 1.6, -z.radius * 0.9);
      ctx.lineTo(-z.radius * 0.5, -z.radius * 0.7);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(z.radius * 0.9, -z.radius * 0.2);
      ctx.lineTo(z.radius * 1.6, -z.radius * 0.9);
      ctx.lineTo(z.radius * 0.5, -z.radius * 0.7);
      ctx.closePath(); ctx.fill();
    } else if (boss) {
      // jagged back spikes for the two bosses
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * z.radius * 0.4 - z.radius * 0.16, -z.radius * 0.9);
        ctx.lineTo(i * z.radius * 0.4, -z.radius * 1.5);
        ctx.lineTo(i * z.radius * 0.4 + z.radius * 0.16, -z.radius * 0.9);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // body
    ctx.beginPath();
    ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // eyes
    ctx.fillStyle = "rgba(8,7,15,0.85)";
    ctx.beginPath();
    ctx.arc(-z.radius * 0.32, -z.radius * 0.18, z.radius * 0.16, 0, Math.PI * 2);
    ctx.arc(z.radius * 0.32, -z.radius * 0.18, z.radius * 0.16, 0, Math.PI * 2);
    ctx.fill();
    if (z.burn > 0 || z.poison > 0) {
      ctx.strokeStyle = z.burn > 0 ? "#ff8a3d" : "#8cff5e";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, z.radius + 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (z.elite) {
      ctx.strokeStyle = "#ffd166";
      ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 14;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, z.radius + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (z.hp < z.maxHp || z.elite) {
      const w2 = z.radius * 2;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(-z.radius, -z.radius - 9, w2, 4);
      ctx.fillStyle = boss ? "#ff3d7f" : "#5ef08a";
      ctx.fillRect(-z.radius, -z.radius - 9, w2 * (z.hp / z.maxHp), 4);
    }
    ctx.restore();
  }

  private drawPlayer() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.px, this.py);
    if (this.invuln > 0) ctx.globalAlpha = 0.5 + Math.sin(this.time * 40) * 0.3;
    ctx.shadowColor = "#7ff5ff"; ctx.shadowBlur = 22;
    ctx.fillStyle = "#e9fbff";
    ctx.beginPath();
    ctx.arc(0, 0, this.pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(this.facing);
    ctx.fillStyle = this.weapon.color;
    ctx.fillRect(this.pr - 3, -3, 16, 6);
    ctx.restore();

    if (this.shieldReady) {
      ctx.strokeStyle = "rgba(127,245,255,0.8)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#7ff5ff"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(this.px, this.py, this.pr + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    const bl = this.perks["blades"] ?? 0;
    for (let i = 0; i < (bl ? bl + 1 : 0); i++) {
      const a = this.bladeAngle + (i * Math.PI * 2) / (bl + 1);
      ctx.beginPath();
      ctx.fillStyle = "#ff5edb";
      ctx.shadowColor = "#ff5edb"; ctx.shadowBlur = 16;
      ctx.arc(this.px + Math.cos(a) * 68, this.py + Math.sin(a) * 68, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const drones = this.perks["drone"] ?? 0;
    for (let i = 0; i < drones; i++) {
      const a = this.droneAngle + (i * Math.PI * 2) / drones;
      ctx.beginPath();
      ctx.fillStyle = "#9d7bff";
      ctx.shadowColor = "#9d7bff"; ctx.shadowBlur = 14;
      ctx.arc(this.px + Math.cos(a) * 44, this.py + Math.sin(a) * 44, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
