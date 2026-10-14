import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Joystick } from "@/components/game/Joystick";
import { Bar, NeonButton, Panel, formatTime } from "@/components/game/ui";
import { AD_COIN_REWARD, showRewardedAd } from "@/game/ads";
import { audio } from "@/game/audio";
import { Game, stageKillTarget, type HudState } from "@/game/engine";
import { type PerkDef } from "@/game/perks";
import {
  ACHIEVEMENTS,
  PERM_UPGRADES,
  load,
  syncAchievements,
  update,
  upgradeCost,
  type SaveData,
} from "@/game/save";
import { WEAPONS } from "@/game/weapons";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Neon Dusk — Survive Till Dawn | Browser Survival Shooter" },
      {
        name: "description",
        content:
          "Neon Dusk is a fast, free browser survival shooter: auto-fire through endless dinosaur hordes, level up perks, unlock weapons and buy permanent upgrades.",
      },
      { property: "og:title", content: "Neon Dusk — Survive Till Dawn" },
      {
        property: "og:description",
        content: "Endless neon dinosaur hordes, six weapons, ten perks. Playable on desktop and mobile.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Screen = "menu" | "upgrades" | "weapons" | "settings" | "stats" | "playing";

const EMPTY_HUD: HudState = {
  hp: 100, maxHp: 100, xp: 0, xpNeed: 140, level: 1, coins: 0,
  time: 0, wave: 1, fps: 60, kills: 0, weapon: "Pistol", perks: {},
  stageEndsIn: 0, stageProgress: 0, bossIn: 0, bossActive: false,
  stageKills: 0, killsToNext: stageKillTarget(1), bossWave: false,
  enemies: 0, boosts: 0, bossHp: 0, bossName: "",
};


function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [data, setData] = useState<SaveData | null>(null);
  const [perkChoices, setPerkChoices] = useState<PerkDef[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState<null | { time: number; wave: number; kills: number; coins: number }>(null);
  const [ad, setAd] = useState<null | { left: number; reward: "coins" | "revive" }>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(() => setData({ ...load() }), []);

  useEffect(() => {
    refresh();
    syncAchievements();
  }, [refresh]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // ---- engine lifecycle ----
  useEffect(() => {
    if (!canvasRef.current) return;
    const game = new Game(canvasRef.current, {
      onHud: setHud,
      onLevelUp: (choices) => setPerkChoices(choices),
      onGameOver: (r) => {
        setGameOver(r);
        refresh();
        syncAchievements();
      },
    });
    gameRef.current = game;

    const onResize = () => game.resize();
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      game.keys.add(k);
      if (k === "escape" || k === "p") setPaused((p) => !p);
    };
    const onKeyUp = (e: KeyboardEvent) => game.keys.delete(e.key.toLowerCase());
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      game.destroy();
    };
  }, [refresh]);

  // pause is driven by React state so overlays always stop the sim
  useEffect(() => {
    const g = gameRef.current;
    if (!g || !g.running) return;
    g.setPaused(paused || !!perkChoices || !!gameOver || !!ad);
  }, [paused, perkChoices, gameOver, ad]);

  const play = () => {
    audio.resume();
    audio.enabled = load().settings.sound;
    setGameOver(null);
    setPerkChoices(null);
    setPaused(false);
    setScreen("playing");
    requestAnimationFrame(() => {
      gameRef.current?.resize();
      gameRef.current?.start();
    });
  };

  const quitToMenu = () => {
    gameRef.current?.syncCoins(0);
    gameRef.current?.destroy();
    setScreen("menu");
    setPaused(false);
    setGameOver(null);
    setPerkChoices(null);
    refresh();
  };

  // ---- rewarded ad (simulated; swap provider in src/game/ads.ts) ----
  const watchAd = async (reward: "coins" | "revive") => {
    setAd({ left: 15, reward });
    await showRewardedAd((left) => setAd((a) => (a ? { ...a, left } : a)));
    setAd(null);
    if (reward === "coins") {
      if (gameRef.current?.running && screen === "playing") gameRef.current.syncCoins(AD_COIN_REWARD);
      else update((s) => { s.coins += AD_COIN_REWARD; s.stats.coinsEarned += AD_COIN_REWARD; });
      refresh();
      say(`+${AD_COIN_REWARD} coins granted`);
    } else {
      setGameOver(null);
      gameRef.current?.revive();
      say("Revived · +25% damage & fire rate");
    }
  };

  const buyUpgrade = (id: string) => {
    const d = load();
    const def = PERM_UPGRADES.find((u) => u.id === id)!;
    const lvl = d.upgrades[id] ?? 0;
    if (lvl >= def.max) return;
    const cost = upgradeCost(def, lvl);
    if (d.coins < cost) return say("Not enough coins");
    update((s) => { s.coins -= cost; s.upgrades[id] = lvl + 1; });
    audio.play("levelup", 0.4);
    refresh();
  };

  const selectWeapon = (id: string) => {
    const d = load();
    const w = WEAPONS.find((x) => x.id === id)!;
    if (!d.unlockedWeapons.includes(id)) {
      if (d.coins < w.cost) return say("Not enough coins");
      update((s) => { s.coins -= w.cost; s.unlockedWeapons.push(id); s.selectedWeapon = id; });
      say(`${w.name} unlocked!`);
    } else {
      update((s) => { s.selectedWeapon = id; });
    }
    audio.play("coin", 0.5);
    refresh();
    syncAchievements();
  };

  const claimDaily = () => {
    const d = load();
    const today = new Date().toDateString();
    if (new Date(d.daily.lastClaim).toDateString() === today) return say("Already claimed today");
    const yesterday = new Date(Date.now() - 864e5).toDateString();
    const streak = new Date(d.daily.lastClaim).toDateString() === yesterday ? d.daily.streak + 1 : 1;
    const reward = 100 * Math.min(streak, 7);
    update((s) => { s.coins += reward; s.stats.coinsEarned += reward; s.daily = { lastClaim: Date.now(), streak }; });
    refresh();
    say(`Daily reward: +${reward} coins (day ${streak})`);
  };

  const prestige = () => {
    const d = load();
    const total = Object.values(d.upgrades).reduce((a, b) => a + b, 0);
    if (total < 40) return say("Need 40 total upgrade levels to prestige");
    update((s) => { s.prestige += 1; s.upgrades = {}; s.coins += 1000; });
    refresh();
    say("Prestiged! +5% permanent power");
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const move = useCallback((x: number, y: number) => {
    if (gameRef.current) gameRef.current.input = { x, y };
  }, []);

  const unlockedAchievements = useMemo(() => new Set(data?.achievements ?? []), [data]);
  const inGame = screen === "playing";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background select-none">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />

      {/* ---------------- HUD ---------------- */}
      {inGame && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 flex flex-col gap-2 p-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1.5">
                <Bar value={hud.hp} max={hud.maxHp} color="oklch(0.66 0.23 20)" label={`${hud.hp} / ${hud.maxHp}`} />
                <Bar value={hud.xp} max={hud.xpNeed} color="oklch(0.82 0.16 195)" />
              </div>
              <button
                onClick={() => watchAd("coins")}
                className="pointer-events-auto rounded-lg border border-gold/60 bg-gold/15 px-2 py-1.5 font-display text-[10px] uppercase tracking-wider text-gold"
              >
                ▶ Ad +{AD_COIN_REWARD}
              </button>
              <button
                onClick={() => setPaused(true)}
                className="pointer-events-auto rounded-lg border border-border bg-card px-3 py-2 font-display text-xs"
              >
                ❚❚
              </button>
            </div>
            {/* wave progression */}
            <div className="space-y-1">
              <div className="flex items-center justify-between font-display text-[10px] uppercase tracking-widest">
                <span className="text-accent">
                  Wave {hud.wave} · {hud.stageKills}/{stageKillTarget(hud.wave)} kills
                </span>
                <span className={hud.bossActive || (hud.bossWave && hud.killsToNext <= 5) ? "text-destructive" : "text-muted-foreground"}>
                  {hud.bossActive ? "Boss active" : hud.bossWave ? `${hud.killsToNext} kills to boss` : `${hud.killsToNext} kills to next wave`}
                </span>
              </div>
              <Bar value={hud.stageProgress} max={1} color={hud.bossActive || (hud.bossWave && hud.killsToNext <= 5) ? "oklch(0.66 0.23 20)" : "oklch(0.68 0.24 330)"} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-display text-[11px] uppercase tracking-widest text-muted-foreground">
              <span className="text-gold">◈ {hud.coins}</span>
              <span className="text-foreground">{formatTime(hud.time)}</span>
              <span>Lv {hud.level}</span>
              <span>Kills {hud.kills}</span>
              <span className="text-destructive">☣ {hud.enemies}</span>
              {hud.boosts > 0 && <span className="text-gold">Boost x{hud.boosts}</span>}
              <span className="ml-auto">{hud.fps} FPS</span>
            </div>
          </div>

          {/* boss countdown alert */}
          {!hud.bossActive && hud.bossWave && hud.killsToNext <= 5 && (
            <div className="absolute inset-x-0 top-1/4 flex flex-col items-center gap-1">
              <span className="animate-pulse-glow font-display text-3xl uppercase tracking-widest text-destructive">
                Boss incoming · {hud.killsToNext} kills
              </span>
            </div>
          )}
          {hud.bossActive && (
            <div className="absolute inset-x-0 top-1/4 flex justify-center">
              <span className="font-display text-xl uppercase tracking-[0.3em] text-destructive">Boss Wave {hud.wave}</span>
            </div>
          )}
          {hud.bossActive && hud.bossHp > 0 && (
            <div className="absolute inset-x-0 top-[34%] mx-auto w-full max-w-xs px-6">
              <div className="mb-1 text-center font-display text-[10px] uppercase tracking-widest text-destructive">{hud.bossName}</div>
              <Bar value={hud.bossHp} max={1} color="oklch(0.66 0.23 20)" />
            </div>
          )}
          <Joystick onMove={move} />
        </div>

      )}

      {/* ---------------- MENUS ---------------- */}
      {!inGame && data && (
        <div className="absolute inset-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-5 p-5">
            {screen === "menu" && (
              <>
                <header className="text-center">
                  <h1 className="font-display neon-text text-4xl font-black uppercase sm:text-6xl">Neon Dusk</h1>
                  <p className="mt-2 text-sm uppercase tracking-[0.3em] text-muted-foreground">
                    Survive till dawn
                  </p>
                  <p className="mt-4 font-display text-lg text-gold">◈ {data.coins.toLocaleString()}</p>
                  {data.prestige > 0 && (
                    <p className="text-xs uppercase tracking-widest text-accent">Prestige {data.prestige}</p>
                  )}
                </header>
                <Panel className="grid gap-3">
                  <NeonButton onClick={play}>▶ Play</NeonButton>
                  <div className="grid grid-cols-2 gap-3">
                    <NeonButton variant="ghost" onClick={() => setScreen("upgrades")}>Upgrades</NeonButton>
                    <NeonButton variant="ghost" onClick={() => setScreen("weapons")}>Weapons</NeonButton>
                    <NeonButton variant="ghost" onClick={() => setScreen("stats")}>Statistics</NeonButton>
                    <NeonButton variant="ghost" onClick={() => setScreen("settings")}>Settings</NeonButton>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NeonButton variant="gold" onClick={() => watchAd("coins")}>▶ Watch Ad · +500</NeonButton>
                    <NeonButton variant="ghost" onClick={claimDaily}>Daily Reward</NeonButton>
                  </div>
                </Panel>
                <p className="text-center text-xs text-muted-foreground">
                  WASD to move · auto-fire · ESC to pause · touch joystick on mobile
                </p>
              </>
            )}

            {screen === "upgrades" && (
              <Panel className="space-y-3">
                <Header title="Permanent Upgrades" coins={data.coins} onBack={() => setScreen("menu")} />
                <div className="grid gap-2">
                  {PERM_UPGRADES.map((u) => {
                    const lvl = data.upgrades[u.id] ?? 0;
                    const cost = upgradeCost(u, lvl);
                    const maxed = lvl >= u.max;
                    return (
                      <div key={u.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/25 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-sm uppercase">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.desc}</p>
                          <div className="mt-1.5"><Bar value={lvl} max={u.max} color="oklch(0.68 0.24 330)" /></div>
                        </div>
                        <div className="w-24 shrink-0 text-right">
                          <p className="font-display text-xs text-muted-foreground">{lvl}/{u.max}</p>
                          <button
                            disabled={maxed || data.coins < cost}
                            onClick={() => buyUpgrade(u.id)}
                            className="mt-1 w-full rounded-lg bg-gold px-2 py-1.5 font-display text-xs text-primary-foreground disabled:opacity-35"
                          >
                            {maxed ? "MAX" : `◈ ${cost}`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <NeonButton variant="gold" onClick={() => watchAd("coins")}>▶ Watch Ad · +500 coins</NeonButton>
                <NeonButton variant="ghost" onClick={prestige}>Prestige (reset upgrades, +5% power)</NeonButton>
              </Panel>
            )}

            {screen === "weapons" && (
              <Panel className="space-y-3">
                <Header title="Weapons" coins={data.coins} onBack={() => setScreen("menu")} />
                <div className="grid gap-2">
                  {WEAPONS.map((w) => {
                    const owned = data.unlockedWeapons.includes(w.id);
                    const active = data.selectedWeapon === w.id;
                    return (
                      <button
                        key={w.id}
                        onClick={() => selectWeapon(w.id)}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                          active ? "border-primary bg-primary/10 glow-primary" : "border-border bg-secondary/25 hover:bg-secondary/45"
                        }`}
                      >
                        <span className="size-3 shrink-0 rounded-full" style={{ background: w.color, boxShadow: `0 0 12px ${w.color}` }} />
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-sm uppercase">{w.name}</p>
                          <p className="text-xs text-muted-foreground">{w.desc}</p>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                            DMG {w.damage} · RATE {w.fireRate}/s · SPD {w.speed} · x{w.count}
                          </p>
                        </div>
                        <span className="font-display text-xs">
                          {active ? "EQUIPPED" : owned ? "SELECT" : `◈ ${w.cost}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}

            {screen === "stats" && (
              <Panel className="space-y-4">
                <Header title="Statistics" coins={data.coins} onBack={() => setScreen("menu")} />
                <div className="grid grid-cols-2 gap-2 font-display text-xs uppercase">
                  <Stat label="Runs" value={data.stats.runs} />
                  <Stat label="Total kills" value={data.stats.kills} />
                  <Stat label="Best time" value={formatTime(data.stats.bestTime)} />
                  <Stat label="Best wave" value={data.stats.bestWave} />
                  <Stat label="Coins earned" value={data.stats.coinsEarned} />
                  <Stat label="Prestige" value={data.prestige} />
                </div>
                <div>
                  <p className="mb-2 font-display text-xs uppercase tracking-widest text-muted-foreground">Leaderboard (local)</p>
                  <div className="space-y-1">
                    {data.scores.length === 0 && <p className="text-xs text-muted-foreground">No runs recorded yet.</p>}
                    {data.scores.map((s, i) => (
                      <div key={s.date} className="flex justify-between rounded-lg bg-secondary/25 px-3 py-1.5 font-mono text-xs">
                        <span>#{i + 1}</span>
                        <span>{formatTime(s.time)}</span>
                        <span>Wave {s.wave}</span>
                        <span>{s.kills} kills</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-display text-xs uppercase tracking-widest text-muted-foreground">Achievements</p>
                  <div className="grid gap-1.5">
                    {ACHIEVEMENTS.map((a) => (
                      <div
                        key={a.id}
                        className={`rounded-lg px-3 py-2 text-xs ${unlockedAchievements.has(a.id) ? "bg-toxic/15 text-toxic" : "bg-secondary/25 text-muted-foreground"}`}
                      >
                        <span className="font-display uppercase">{a.name}</span> — {a.desc}
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            )}

            {screen === "settings" && (
              <Panel className="space-y-3">
                <Header title="Settings" coins={data.coins} onBack={() => setScreen("menu")} />
                <Toggle
                  label="Sound effects"
                  on={data.settings.sound}
                  onClick={() => { update((s) => { s.settings.sound = !s.settings.sound; }); audio.enabled = load().settings.sound; refresh(); }}
                />
                <Toggle
                  label="Vibration (mobile)"
                  on={data.settings.vibration}
                  onClick={() => { update((s) => { s.settings.vibration = !s.settings.vibration; }); refresh(); }}
                />
                <NeonButton variant="ghost" onClick={toggleFullscreen}>Toggle Fullscreen</NeonButton>
                <NeonButton
                  variant="danger"
                  onClick={() => {
                    if (confirm("Erase all progress?")) {
                      localStorage.removeItem("ntd_save_v1");
                      location.reload();
                    }
                  }}
                >
                  Reset all progress
                </NeonButton>
              </Panel>
            )}
          </div>
        </div>
      )}

      {/* ---------------- LEVEL UP ---------------- */}
      {perkChoices && !gameOver && (
        <Overlay>
          <Panel className="w-full max-w-md space-y-3">
            <h2 className="font-display neon-text text-center text-2xl uppercase">Level {hud.level}</h2>
            <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">Choose an upgrade</p>
            {perkChoices.map((p) => (
              <button
                key={p.id}
                onClick={() => { setPerkChoices(null); gameRef.current?.addPerk(p.id); }}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3 text-left transition-colors hover:border-primary hover:bg-primary/10"
              >
                <span className="text-xl">{p.icon}</span>
                <span className="min-w-0">
                  <span className="block font-display text-sm uppercase">
                    {p.name}{" "}
                    <span className="text-[10px] tracking-widest text-primary">
                      {hud.perks[p.id] ? `LV ${hud.perks[p.id]} → ${(hud.perks[p.id] ?? 0) + 1}` : "NEW"}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{p.desc}</span>
                </span>
              </button>
            ))}
          </Panel>
        </Overlay>
      )}

      {/* ---------------- PAUSE ---------------- */}
      {paused && inGame && !gameOver && (
        <Overlay>
          <Panel className="w-full max-w-sm space-y-3">
            <h2 className="font-display text-center text-2xl uppercase neon-text">Paused</h2>
            <p className="text-center font-display text-xs uppercase tracking-widest text-muted-foreground">
              {formatTime(hud.time)} · Wave {hud.wave} · {hud.kills} kills
            </p>
            <NeonButton onClick={() => setPaused(false)}>Resume</NeonButton>
            <NeonButton variant="gold" onClick={() => watchAd("coins")}>▶ Watch Ad · +500 coins</NeonButton>
            <NeonButton variant="ghost" onClick={quitToMenu}>Quit to menu</NeonButton>
          </Panel>
        </Overlay>
      )}

      {/* ---------------- GAME OVER ---------------- */}
      {gameOver && (
        <Overlay>
          <Panel className="w-full max-w-sm space-y-3">
            <h2 className="font-display text-center text-3xl uppercase text-destructive">You Died</h2>
            <div className="grid grid-cols-2 gap-2 font-display text-xs uppercase">
              <Stat label="Survived" value={formatTime(gameOver.time)} />
              <Stat label="Wave" value={gameOver.wave} />
              <Stat label="Kills" value={gameOver.kills} />
              <Stat label="Coins" value={gameOver.coins} />
            </div>
            <NeonButton variant="gold" onClick={() => watchAd("revive")}>▶ Watch Ad · Revive + Boost</NeonButton>
            <NeonButton onClick={play}>Play again</NeonButton>
            <NeonButton variant="ghost" onClick={quitToMenu}>Main menu</NeonButton>
          </Panel>
        </Overlay>
      )}

      {/* ---------------- REWARDED AD ---------------- */}
      {ad && (
        <Overlay>
          <Panel className="w-full max-w-sm space-y-4 text-center">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">Advertisement</p>
            <div className="flex h-40 items-center justify-center rounded-xl bg-secondary/40 animate-pulse-glow">
              <span className="font-display neon-text text-2xl uppercase">Your Ad Here</span>
            </div>
            <p className="font-display text-3xl tabular-nums">{ad.left}s</p>
            <p className="text-xs text-muted-foreground">
              Reward: {ad.reward === "coins" ? `+${AD_COIN_REWARD} coins` : "revive + 25% boost"} · skipping disabled
            </p>
          </Panel>
        </Overlay>
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-50 flex justify-center">
          <span className="panel animate-rise px-4 py-2 font-display text-xs uppercase tracking-widest">{toast}</span>
        </div>
      )}
    </main>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-background/80 p-5 backdrop-blur-sm">
      {children}
    </div>
  );
}

function Header({ title, coins, onBack }: { title: string; coins: number; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button onClick={onBack} className="font-display text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        ‹ Back
      </button>
      <h2 className="font-display text-lg uppercase neon-text">{title}</h2>
      <span className="font-display text-sm text-gold">◈ {coins}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-secondary/25 px-3 py-2">
      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
      <p className="font-display text-base normal-case text-foreground">{value}</p>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-border bg-secondary/25 px-4 py-3"
    >
      <span className="font-display text-sm uppercase">{label}</span>
      <span className={`h-6 w-11 rounded-full p-0.5 transition-colors ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`block size-5 rounded-full bg-background transition-transform ${on ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}
