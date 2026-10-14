// Level-up perks offered three at a time.
//
// 25 perks across three categories. The roller avoids re-offering what was
// shown in the last couple of level-ups, favours perks you don't own yet,
// and won't hand you three cards from the same category.

export type PerkCategory = "offense" | "support" | "defense";

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  icon: string;
  cat: PerkCategory;
}

export const PERKS: PerkDef[] = [
  // ---- offense: shooting ----
  { id: "multishot", name: "Multi-shot", desc: "+1 projectile per shot", max: 4, icon: "✶", cat: "offense" },
  { id: "bigbullets", name: "Bigger Bullets", desc: "+35% bullet size & damage", max: 4, icon: "◉", cat: "offense" },
  { id: "reload", name: "Faster Reload", desc: "+20% fire rate", max: 5, icon: "⟳", cat: "offense" },
  { id: "power", name: "Overcharge", desc: "+12% damage", max: 6, icon: "⚡", cat: "offense" },
  { id: "crit", name: "Sharpshooter", desc: "+8% crit chance (crits hit 2.2x)", max: 5, icon: "✦", cat: "offense" },
  { id: "pierce", name: "Piercing Rounds", desc: "Bullets pass through +1 enemy", max: 3, icon: "➤", cat: "offense" },
  { id: "ricochet", name: "Ricochet", desc: "Bullets bounce to another target", max: 3, icon: "⤵", cat: "offense" },
  { id: "frag", name: "Explosive Rounds", desc: "+12% chance a hit explodes", max: 3, icon: "✹", cat: "offense" },
  { id: "execute", name: "Executioner", desc: "+30% damage to enemies under 30% HP", max: 3, icon: "☠", cat: "offense" },
  { id: "bloodlust", name: "Bloodlust", desc: "Kills stack fire rate for a few seconds", max: 3, icon: "♨", cat: "offense" },
  // ---- offense: elemental ----
  { id: "burn", name: "Burn Damage", desc: "Hits set enemies on fire", max: 4, icon: "🔥", cat: "offense" },
  { id: "freeze", name: "Freeze", desc: "Hits slow enemies", max: 3, icon: "❄", cat: "offense" },
  { id: "poison", name: "Poison", desc: "Damage over time stacks", max: 4, icon: "☣", cat: "offense" },
  { id: "boom", name: "Explosion on Kill", desc: "Corpses detonate", max: 3, icon: "💥", cat: "offense" },
  // ---- support: companions & utility ----
  { id: "drone", name: "Drone Companion", desc: "An orbiting drone shoots too", max: 3, icon: "◐", cat: "support" },
  { id: "blades", name: "Plasma Blades", desc: "Blades orbit you and shred anything close", max: 3, icon: "✜", cat: "support" },
  { id: "shockwave", name: "Shockwave Pulse", desc: "Periodic blast that damages and shoves enemies back", max: 3, icon: "◎", cat: "support" },
  { id: "speed", name: "Adrenaline", desc: "+8% movement speed", max: 5, icon: "➠", cat: "support" },
  { id: "magnet", name: "Magnetism", desc: "+35% coin pickup radius", max: 3, icon: "⊛", cat: "support" },
  { id: "fortune", name: "Prospector", desc: "+20% coins from kills", max: 3, icon: "¤", cat: "support" },
  // ---- defense ----
  { id: "lifesteal", name: "Lifesteal", desc: "Heal on kill", max: 4, icon: "✚", cat: "defense" },
  { id: "vitality", name: "Vitality", desc: "+25 max HP and heal 25", max: 5, icon: "♥", cat: "defense" },
  { id: "regen", name: "Regeneration", desc: "+0.7 HP per second", max: 4, icon: "⟲", cat: "defense" },
  { id: "armor", name: "Armor Plating", desc: "-8% damage taken", max: 4, icon: "⬢", cat: "defense" },
  { id: "shield", name: "Phase Shield", desc: "Negates one hit, recharges over time", max: 3, icon: "◈", cat: "defense" },
];

/**
 * Roll `n` distinct perks.
 * - `recent` = ids shown in the last few level-ups; they're heavily down-weighted
 *   so you don't see the same cards over and over.
 * - perks you don't own yet are favoured so new options keep showing up.
 * - never all from one category (when other categories still have options).
 */
export function rollPerks(levels: Record<string, number>, n = 3, recent: string[] = []): PerkDef[] {
  const pool = PERKS.filter((p) => (levels[p.id] ?? 0) < p.max);
  const weight = (p: PerkDef) => {
    let w = 1;
    if (recent.includes(p.id)) w *= 0.12;
    if ((levels[p.id] ?? 0) === 0) w *= 1.6;
    return w;
  };
  const pick = (from: PerkDef[]): PerkDef => {
    const total = from.reduce((s, p) => s + weight(p), 0);
    let r = Math.random() * total;
    for (const p of from) {
      r -= weight(p);
      if (r <= 0) return p;
    }
    return from[from.length - 1]!;
  };

  const out: PerkDef[] = [];
  const left = [...pool];
  while (out.length < n && left.length) {
    const p = pick(left);
    out.push(p);
    left.splice(left.indexOf(p), 1);
  }

  // Variety guard: three of a kind -> swap the last card for another category.
  if (out.length === n && n >= 3 && out.every((p) => p.cat === out[0]!.cat)) {
    const other = left.filter((p) => p.cat !== out[0]!.cat);
    if (other.length) out[n - 1] = pick(other);
  }
  return out;
}
