// Save system — all persistence goes through here (localStorage).

export type UpgradeId =
  | "damage"
  | "fireRate"
  | "moveSpeed"
  | "maxHp"
  | "bulletSpeed"
  | "crit"
  | "magnet";

export interface PermUpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  baseCost: number;
  growth: number;
  max: number;
  step: number; // fractional bonus per level
}

export const PERM_UPGRADES: PermUpgradeDef[] = [
  { id: "damage", name: "Damage", desc: "+10% bullet damage", baseCost: 50, growth: 1.35, max: 20, step: 0.1 },
  { id: "fireRate", name: "Fire Rate", desc: "+10% fire rate", baseCost: 60, growth: 1.35, max: 20, step: 0.1 },
  { id: "moveSpeed", name: "Move Speed", desc: "+10% movement speed", baseCost: 45, growth: 1.32, max: 20, step: 0.1 },
  { id: "maxHp", name: "Max HP", desc: "+10% maximum health", baseCost: 55, growth: 1.33, max: 20, step: 0.1 },
  { id: "bulletSpeed", name: "Bullet Speed", desc: "+10% projectile speed", baseCost: 40, growth: 1.3, max: 20, step: 0.1 },
  { id: "crit", name: "Critical Chance", desc: "+5% crit chance", baseCost: 80, growth: 1.4, max: 20, step: 0.05 },
  { id: "magnet", name: "Coin Magnet", desc: "+10% pickup radius", baseCost: 35, growth: 1.28, max: 20, step: 0.1 },
];

export interface SaveData {
  coins: number;
  upgrades: Record<string, number>;
  unlockedWeapons: string[];
  selectedWeapon: string;
  stats: { runs: number; kills: number; bestTime: number; bestWave: number; coinsEarned: number };
  settings: { sound: boolean; vibration: boolean };
  daily: { lastClaim: number; streak: number };
  scores: { time: number; wave: number; kills: number; date: number }[];
  achievements: string[];
  prestige: number;
}

const KEY = "ntd_save_v1";

const DEFAULT: SaveData = {
  coins: 0,
  upgrades: {},
  unlockedWeapons: ["pistol"],
  selectedWeapon: "pistol",
  stats: { runs: 0, kills: 0, bestTime: 0, bestWave: 0, coinsEarned: 0 },
  settings: { sound: true, vibration: true },
  daily: { lastClaim: 0, streak: 0 },
  scores: [],
  achievements: [],
  prestige: 0,
};

let cache: SaveData | null = null;

export function load(): SaveData {
  if (cache) return cache;
  if (typeof window === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
  } catch {
    cache = { ...DEFAULT };
  }
  return cache!;
}

export function save(data: SaveData) {
  cache = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full / blocked */
  }
}

export function update(fn: (d: SaveData) => void): SaveData {
  const d = { ...load() };
  fn(d);
  save(d);
  return d;
}

export function upgradeLevel(d: SaveData, id: UpgradeId) {
  return d.upgrades[id] ?? 0;
}

export function upgradeCost(def: PermUpgradeDef, level: number) {
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

/** Aggregated permanent multipliers used by the engine. */
export function bonuses(d: SaveData) {
  const lv = (id: UpgradeId) => d.upgrades[id] ?? 0;
  const p = 1 + d.prestige * 0.05;
  return {
    damage: (1 + lv("damage") * 0.1) * p,
    fireRate: 1 + lv("fireRate") * 0.1,
    moveSpeed: 1 + lv("moveSpeed") * 0.1,
    maxHp: (1 + lv("maxHp") * 0.1) * p,
    bulletSpeed: 1 + lv("bulletSpeed") * 0.1,
    crit: lv("crit") * 0.05,
    magnet: 1 + lv("magnet") * 0.1,
  };
}

export const ACHIEVEMENTS = [
  { id: "first_blood", name: "First Blood", desc: "Kill 1 dinosaur", test: (s: SaveData) => s.stats.kills >= 1 },
  { id: "slayer", name: "Slayer", desc: "Kill 500 dinosaurs", test: (s: SaveData) => s.stats.kills >= 500 },
  { id: "butcher", name: "Butcher", desc: "Kill 5000 dinosaurs", test: (s: SaveData) => s.stats.kills >= 5000 },
  { id: "survivor", name: "Survivor", desc: "Survive 5 minutes", test: (s: SaveData) => s.stats.bestTime >= 300 },
  { id: "dawn", name: "Till Dawn", desc: "Survive 20 minutes", test: (s: SaveData) => s.stats.bestTime >= 1200 },
  { id: "rich", name: "Rich", desc: "Earn 10,000 coins", test: (s: SaveData) => s.stats.coinsEarned >= 10000 },
  { id: "arsenal", name: "Arsenal", desc: "Unlock every weapon", test: (s: SaveData) => s.unlockedWeapons.length >= 6 },
];

export function syncAchievements(): string[] {
  const d = load();
  const unlocked = ACHIEVEMENTS.filter((a) => a.test(d)).map((a) => a.id);
  if (unlocked.length !== d.achievements.length) update((s) => (s.achievements = unlocked));
  return unlocked;
}
