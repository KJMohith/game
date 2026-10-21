// Portal builds: PLATFORM=gamemonetize|crazygames|poki|youtube|web  ->  dist-platforms/<platform>/
// Each build includes ONLY that platform's ad SDK (portals forbid other ad networks).
// Run all with `npm run build:portal`, or one with `npm run build:portal -- poki`.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const platform = process.env.PLATFORM ?? "gamemonetize";
// Game ID from your GameMonetize dashboard (Game Management > My games > your game)
const GM_ID = process.env.GAMEMONETIZE_ID ?? "ck3565mv2biq45e2iuw9icwnb962tyvh";

const SDK: Record<string, string> = {
  gamemonetize: `<script type="text/javascript">
      window.SDK_OPTIONS = {
        gameId: "${GM_ID}",
        onEvent: function (a) { if (window.__gmEvent) window.__gmEvent(a); }
      };
      (function (a, b, c) {
        var d = a.getElementsByTagName(b)[0];
        a.getElementById(c) || ((a = a.createElement(b)), (a.id = c), (a.src = "https://api.gamemonetize.com/sdk.js"), d.parentNode.insertBefore(a, d));
      })(document, "script", "gamemonetize-sdk");
    </script>`,
  crazygames: `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>`,
  poki: `<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>`,
  youtube: `<script src="https://www.youtube.com/game_api/v1"></script>`,
  web: ``,
};
if (!(platform in SDK)) throw new Error(`Unknown PLATFORM "${platform}"`);

export default defineConfig({
  root: "static",
  base: "./",
  publicDir: path.resolve(process.cwd(), "public"),
  plugins: [
    react(),
    tailwindcss(),
    { name: "platform-sdk", transformIndexHtml: (html) => html.replace("<!--PLATFORM_SDK-->", SDK[platform]!) },
  ],
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  build: { outDir: path.resolve(process.cwd(), "dist-platforms", platform), emptyOutDir: true },
});
