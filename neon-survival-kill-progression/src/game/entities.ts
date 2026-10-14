// Entity classes + object pool. All entities are poolable: `active` + `reset()`.

export class Pool<T extends { active: boolean }> {
  items: T[] = [];
  constructor(private factory: () => T, prealloc = 0) {
    for (let i = 0; i < prealloc; i++) this.items.push(this.factory());
  }
  obtain(): T {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      if (!it.active) {
        it.active = true;
        return it;
      }
    }
    const it = this.factory();
    it.active = true;
    this.items.push(it);
    return it;
  }
  forEachActive(fn: (it: T) => void) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      if (it.active) fn(it);
    }
  }
  countActive() {
    let n = 0;
    for (const it of this.items) if (it.active) n++;
    return n;
  }
  clear() {
    for (const it of this.items) it.active = false;
  }
}

export class Bullet {
  active = false;
  x = 0; y = 0; vx = 0; vy = 0;
  damage = 0; size = 4; life = 0; pierce = 0;
  color = "#fff"; kind: "bullet" | "laser" | "rocket" | "lightning" = "bullet";
  explosive = 0; chain = 0; crit = false; ricochet = 0;
  hitIds: number[] = [];
  trail: number[] = [];
}

// Every enemy is a species of dinosaur. "raptor"/"compy"/"anky"/"spitter"/"ptero"
// are swarming rank-and-file types; "rex" and "spino" are stage-ending bosses
// (spino joins rex as a second boss in later, harder boss battles).
export type ZombieKind = "raptor" | "compy" | "anky" | "spitter" | "ptero" | "rex" | "spino";

export const BOSS_KINDS: ZombieKind[] = ["rex", "spino"];
export function isBossKind(k: ZombieKind) {
  return k === "rex" || k === "spino";
}

export interface ZombieSpec {
  hp: number; speed: number; damage: number; radius: number; color: string; xp: number; coin: number;
  label: string;
}

// Stats pushed up across the board vs. the old "easy" baseline so every
// species hits harder and swarms faster — difficulty now comes from the
// dinosaurs themselves, not just from spawn counts.
export const ZOMBIE_SPECS: Record<ZombieKind, ZombieSpec> = {
  // Velociraptor — the common pack hunter. Moves in numbers and closes fast.
  raptor:  { hp: 46,   speed: 82,  damage: 12, radius: 13, color: "#5ef08a", xp: 8,   coin: 2,   label: "Raptor" },
  // Compsognathus — tiny, extremely fast, spawns in dense flocks to swarm the player.
  compy:   { hp: 22,   speed: 182, damage: 8,  radius: 8,  color: "#7ff5ff", xp: 7,   coin: 2,   label: "Compy" },
  // Ankylosaurus — armored tank, slow but soaks and hits hard.
  anky:    { hp: 320,  speed: 44,  damage: 28, radius: 23, color: "#c58cff", xp: 20,  coin: 6,  label: "Ankylo" },
  // Dilophosaurus — spits/bursts with acid on death, same "suicide" role as before.
  spitter: { hp: 68,   speed: 100, damage: 34, radius: 15, color: "#ff7a4a", xp: 12,  coin: 4,   label: "Spitter" },
  // Pterosaur — flies in erratically, fast and fragile, unlocked mid-run to thicken swarms.
  ptero:   { hp: 32,   speed: 196, damage: 10, radius: 11, color: "#ffdd57", xp: 9,   coin: 3,   label: "Ptero" },
  // Tyrannosaurus Rex — primary stage boss.
  rex:     { hp: 3800, speed: 62,  damage: 48, radius: 44, color: "#ff3d7f", xp: 260, coin: 150, label: "Rex" },
  // Spinosaurus — secondary boss that joins Rex in later, harder boss battles.
  spino:   { hp: 2800, speed: 68,  damage: 44, radius: 40, color: "#4ad8ff", xp: 230, coin: 130, label: "Spino" },
};


let zid = 1;

export class Zombie {
  active = false;
  id = 0;
  kind: ZombieKind = "raptor";
  x = 0; y = 0; vx = 0; vy = 0;
  hp = 1; maxHp = 1; speed = 0; damage = 0; radius = 12; color = "#fff";
  xp = 0; coin = 0;
  hitFlash = 0; burn = 0; poison = 0; slow = 0; wobble = 0;
  attackCd = 0;
  // elites: tougher, bigger, golden-ringed versions of normal enemies
  elite = false;
  bladeCd = 0;
  // boss brain (only used when isBossKind(kind))
  bState: "chase" | "windup" | "charge" | "recover" = "chase";
  bAbility: "charge" | "stomp" | "spit" | "roar" = "charge";
  bLast = "";
  bT = 0; bTotal = 1; bCd = 2.5;
  bDirX = 1; bDirY = 0; bHit = false;
  phase = 1;

  spawn(kind: ZombieKind, x: number, y: number, mult: number) {
    const s = ZOMBIE_SPECS[kind];
    this.id = zid++;
    this.kind = kind;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.maxHp = this.hp = s.hp * mult;
    this.speed = s.speed * (1 + Math.min(0.6, (mult - 1) * 0.12));
    this.damage = s.damage * (1 + (mult - 1) * 0.3);
    this.radius = s.radius;
    this.color = s.color;
    this.xp = s.xp; this.coin = s.coin;
    this.hitFlash = 0; this.burn = 0; this.poison = 0; this.slow = 0;
    this.attackCd = 0;
    this.elite = false; this.bladeCd = 0;
    this.bState = "chase"; this.bAbility = "charge"; this.bLast = "";
    this.bT = 0; this.bTotal = 1; this.bCd = 2.5; this.bHit = false; this.phase = 1;
    this.wobble = Math.random() * Math.PI * 2;
    this.active = true;
  }
}

export class EnemyShot {
  active = false;
  x = 0; y = 0; vx = 0; vy = 0;
  damage = 0; radius = 7; life = 0; color = "#9dff4a";
}

export class Coin {
  active = false;
  x = 0; y = 0; vx = 0; vy = 0; value = 1; life = 0; t = 0;
}

export class Particle {
  active = false;
  x = 0; y = 0; vx = 0; vy = 0; life = 0; maxLife = 1; size = 3; color = "#fff"; glow = false;
}

export class FloatText {
  active = false;
  x = 0; y = 0; vy = -40; life = 0; text = ""; color = "#fff"; size = 14;
}
