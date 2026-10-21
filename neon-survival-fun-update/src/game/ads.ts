// Ad layer. The game talks to ONE small interface; the right provider is picked at runtime from
// whichever platform SDK is on the page (each portal build ships only its own SDK):
//   CrazyGames  -> window.CrazyGames.SDK     (rewarded + midgame, v3 SDK)
//   Poki        -> window.PokiSDK            (rewardedBreak + commercialBreak)
//   YouTube     -> window.ytgame             (Playables SDK; rewarded is experimental)
//   GameMonetize-> window.SDK_OPTIONS / sdk  (showBanner only)
//   AdSense H5  -> only if VITE_ADSENSE_CLIENT is set (needs an approved domain)
// Plain web builds (e.g. Vercel) have no provider: no fake ads, buttons are hidden, nothing is paid.
// A reward is only granted when the result is "rewarded".
import { audio } from "./audio";

export type AdResult = "rewarded" | "dismissed" | "no-fill";

export interface AdProvider {
  name: string;
  /** true when the SDK draws its own full-screen ad UI (we only show a small "loading" cover) */
  usesOwnUi: boolean;
  init?(): void;
  /** false when rewarded ads cannot work in this setup (e.g. YouTube without a reward id) */
  canReward?(): boolean;
  /** opt-in ad: resolve "rewarded" only if the player really got the reward */
  show(onTick: (secondsLeft: number) => void): Promise<AdResult>;
  /** ad at a natural break (between runs). Never blocks play if it fails. */
  midgame?(): Promise<void>;
  /** tell the platform when real gameplay starts/stops (Poki, CrazyGames need this) */
  gameplay?(active: boolean): void;
}

// ---------- shared helpers ----------
let savedAudio = true;
let muted = false;
function muteForAd(on: boolean) {
  if (on && !muted) { savedAudio = audio.enabled; audio.enabled = false; muted = true; }
  else if (!on && muted) { audio.enabled = savedAudio; muted = false; }
}
const w = () => window as any;
const env = (k: string) => (import.meta as any).env?.[k] as string | undefined;

// ---------- dev only ----------
export const simulatedAdProvider: AdProvider = {
  name: "simulated",
  usesOwnUi: false,
  show(onTick) {
    return new Promise((resolve) => {
      let left = 15;
      onTick(left);
      const iv = setInterval(() => {
        left -= 1;
        onTick(left);
        if (left <= 0) { clearInterval(iv); resolve("rewarded"); }
      }, 1000);
    });
  },
};

const noAdProvider: AdProvider = { name: "none", usesOwnUi: true, show: () => Promise.resolve("no-fill") };

// ---------- CrazyGames (SDK v3) ----------
function crazyGamesProvider(): AdProvider {
  const sdk = () => w().CrazyGames?.SDK;
  let ready: Promise<unknown> | null = null;
  const request = (type: "rewarded" | "midgame") =>
    new Promise<AdResult>(async (resolve) => {
      await ready;
      const s = sdk();
      if (!s?.ad) return resolve("no-fill");
      let started = false;
      try {
        s.ad.requestAd(type, {
          adStarted: () => { started = true; muteForAd(true); },
          adFinished: () => { muteForAd(false); resolve("rewarded"); },
          adError: () => { muteForAd(false); resolve(started ? "dismissed" : "no-fill"); },
        });
      } catch { resolve("no-fill"); }
      setTimeout(() => { muteForAd(false); resolve("no-fill"); }, 130000);
    });
  return {
    name: "crazygames",
    usesOwnUi: true,
    init() { ready ||= Promise.resolve().then(() => sdk()?.init?.()).catch(() => {}); },
    gameplay(active) { try { active ? sdk()?.game?.gameplayStart() : sdk()?.game?.gameplayStop(); } catch { /* ignore */ } },
    show: () => request("rewarded"),
    midgame: () => request("midgame").then(() => {}),
  };
}

// ---------- Poki ----------
function pokiProvider(): AdProvider {
  const P = () => w().PokiSDK;
  return {
    name: "poki",
    usesOwnUi: true,
    init() { try { P()?.init?.().then(() => P().gameLoadingFinished()).catch(() => {}); } catch { /* ignore */ } },
    gameplay(active) { try { active ? P()?.gameplayStart() : P()?.gameplayStop(); } catch { /* ignore */ } },
    async show() {
      if (!P()?.rewardedBreak) return "no-fill";
      muteForAd(true);
      try { return (await P().rewardedBreak()) ? "rewarded" : "dismissed"; }
      catch { return "no-fill"; }
      finally { muteForAd(false); }
    },
    async midgame() {
      if (!P()?.commercialBreak) return;
      muteForAd(true);
      try { await P().commercialBreak(); } catch { /* ignore */ } finally { muteForAd(false); }
    },
  };
}

// ---------- YouTube Playables ----------
function youtubeProvider(): AdProvider {
  const yt = () => w().ytgame;
  return {
    name: "youtube",
    usesOwnUi: true,
    canReward: () => !!env("VITE_YT_REWARD_ID"),
    init() { try { yt().game.firstFrameReady(); yt().game.gameReady(); } catch { /* ignore */ } },
    async show() {
      // requestRewardedAd is marked experimental by YouTube and needs a reward id from your Playables setup.
      const id = env("VITE_YT_REWARD_ID");
      if (!id || !yt()?.ads?.requestRewardedAd) return "no-fill";
      muteForAd(true);
      try { return (await yt().ads.requestRewardedAd(id)) ? "rewarded" : "dismissed"; }
      catch { return "no-fill"; }
      finally { muteForAd(false); }
    },
    async midgame() {
      if (!yt()?.ads?.requestInterstitialAd) return;
      muteForAd(true);
      try { await yt().ads.requestInterstitialAd(); } catch { /* ignore */ } finally { muteForAd(false); }
    },
  };
}

// ---------- GameMonetize ----------
/** Its SDK only has sdk.showBanner() plus PAUSE/START events. PAUSE then START = an ad really played.
 *  It cannot tell a skipped ad from a finished one. */
function gameMonetizeProvider(): AdProvider {
  let started = false;
  let pending: ((r: AdResult) => void) | null = null;
  const run = () =>
    new Promise<AdResult>((resolve) => {
      const sdk = w().sdk;
      if (!sdk || typeof sdk.showBanner !== "function") return resolve("no-fill");
      started = false;
      pending = resolve;
      sdk.showBanner();
      setTimeout(() => { if (pending === resolve && !started) { pending = null; resolve("no-fill"); } }, 15000);
      setTimeout(() => { if (pending === resolve) { pending = null; muteForAd(false); resolve("dismissed"); } }, 120000);
    });
  return {
    name: "gamemonetize",
    usesOwnUi: true,
    init() {
      w().__gmEvent = (a: { name: string }) => {
        if (a.name === "SDK_GAME_PAUSE") { started = true; muteForAd(true); }
        else if (a.name === "SDK_GAME_START") {
          muteForAd(false);
          if (pending) { const r = pending; pending = null; r(started ? "rewarded" : "no-fill"); }
          started = false;
        }
      };
    },
    show: run,
    midgame: () => run().then(() => {}),
  };
}

// ---------- AdSense H5 Games Ads (needs an approved domain) ----------
function adsenseProvider(client: string): AdProvider {
  type Fn = (o: Record<string, unknown>) => void;
  let ready = false;
  return {
    name: "adsense",
    usesOwnUi: true,
    init() {
      if (typeof document === "undefined" || ready) return;
      ready = true;
      const s = document.createElement("script");
      s.async = true;
      s.crossOrigin = "anonymous";
      s.setAttribute("data-ad-client", client);
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      if (env("VITE_ADSENSE_TEST") !== "off") s.setAttribute("data-adbreak-test", "on");
      document.head.appendChild(s);
      const g = w();
      g.adsbygoogle = g.adsbygoogle || [];
      const push: Fn = (o) => g.adsbygoogle.push(o);
      g.adBreak = g.adConfig = push;
      g.adConfig({ preloadAdBreaks: "on", sound: "on" });
    },
    show() {
      return new Promise<AdResult>((resolve) => {
        let result: AdResult = "no-fill";
        let settled = false;
        const done = (r: AdResult) => { if (!settled) { settled = true; resolve(r); } };
        setTimeout(() => done(result), 20000);
        try {
          w().adBreak({
            type: "reward",
            name: "rewarded-ad",
            beforeReward: (showAdFn: () => void) => showAdFn(),
            adViewed: () => { result = "rewarded"; },
            adDismissed: () => { result = "dismissed"; },
            adBreakDone: () => done(result),
          });
        } catch { done("no-fill"); }
      });
    },
  };
}

// ---------- provider selection ----------
let override: AdProvider | null = null;
const cache: Record<string, AdProvider> = {};
const once = (k: string, make: () => AdProvider) => (cache[k] ||= make());

function current(): AdProvider {
  if (override) return override;
  if (typeof window === "undefined") return noAdProvider; // server render
  const g = w();
  if (g.CrazyGames?.SDK) return once("cg", crazyGamesProvider);
  if (g.PokiSDK) return once("poki", pokiProvider);
  if (typeof g.ytgame !== "undefined" && g.ytgame?.IN_PLAYABLES_ENV) return once("yt", youtubeProvider);
  if (g.SDK_OPTIONS) return once("gm", gameMonetizeProvider);
  const client = env("VITE_ADSENSE_CLIENT");
  if (client) return once("adsense", () => adsenseProvider(client));
  return env("DEV") ? simulatedAdProvider : noAdProvider;
}

export function setAdProvider(p: AdProvider) { override = p; }
export function initAds() { current().init?.(); }
export function adUsesOwnUi() { return current().usesOwnUi; }
/** false on plain web builds: the UI hides the Watch Ad buttons instead of faking ads */
export function adsAvailable() { const p = current(); return p.name !== "none" && (p.canReward ? p.canReward() : true); }

let lastAdAt = typeof Date !== "undefined" ? Date.now() : 0;
export function showRewardedAd(onTick: (s: number) => void) {
  return current().show(onTick).then((r) => { lastAdAt = Date.now(); return r; });
}

/** Ad at a natural break (before a new run). At most one every 2 minutes, never blocks on failure. */
export async function showMidgameAd() {
  const p = current();
  if (!p.midgame || Date.now() - lastAdAt < 120000) return;
  lastAdAt = Date.now();
  try { await p.midgame(); } catch { /* never block the game */ }
  lastAdAt = Date.now();
}

let gameplayOn: boolean | null = null;
export function setGameplayActive(active: boolean) {
  if (gameplayOn === active) return;
  gameplayOn = active;
  try { current().gameplay?.(active); } catch { /* ignore */ }
}

export const AD_COIN_REWARD = 500;
