export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  damage: number;
  fireRate: number; // shots per second
  speed: number; // px/s
  spread: number; // radians
  count: number; // projectiles per shot
  size: number;
  pierce: number;
  color: string;
  kind: "bullet" | "laser" | "rocket" | "lightning";
  explosive?: number; // explosion radius
  chain?: number; // lightning chains
  scale: number; // damage scaling per weapon level
}

export const WEAPONS: WeaponDef[] = [
  {
    id: "pistol", name: "Pistol", desc: "Reliable all-rounder.", cost: 0,
    damage: 12, fireRate: 4, speed: 620, spread: 0.03, count: 1, size: 4, pierce: 0,
    color: "#7ff5ff", kind: "bullet", scale: 1,
  },
  {
    id: "shotgun", name: "Shotgun", desc: "Six pellets, brutal up close.", cost: 800,
    damage: 8, fireRate: 1.4, speed: 560, spread: 0.42, count: 6, size: 4, pierce: 0,
    color: "#ffb347", kind: "bullet", scale: 1.1,
  },
  {
    id: "smg", name: "SMG", desc: "Shreds with sheer volume.", cost: 1200,
    damage: 6, fireRate: 11, speed: 700, spread: 0.14, count: 1, size: 3, pierce: 0,
    color: "#b6ff6b", kind: "bullet", scale: 0.9,
  },
  {
    id: "laser", name: "Laser", desc: "Piercing beam of light.", cost: 2200,
    damage: 16, fireRate: 3, speed: 1200, spread: 0, count: 1, size: 3, pierce: 4,
    color: "#ff5edb", kind: "laser", scale: 1.2,
  },
  {
    id: "rocket", name: "Rocket Launcher", desc: "Big, slow, explosive.", cost: 3500,
    damage: 45, fireRate: 0.8, speed: 380, spread: 0.05, count: 1, size: 7, pierce: 0,
    color: "#ff6b4a", kind: "rocket", explosive: 95, scale: 1.4,
  },
  {
    id: "lightning", name: "Lightning Staff", desc: "Arcs between enemies.", cost: 5000,
    damage: 22, fireRate: 2, speed: 900, spread: 0, count: 1, size: 5, pierce: 0,
    color: "#9d7bff", kind: "lightning", chain: 4, scale: 1.25,
  },
];

export function getWeapon(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0]!;
}
