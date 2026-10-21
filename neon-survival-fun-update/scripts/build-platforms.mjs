// Builds one static folder per platform in dist-platforms/. Zip the CONTENTS of a folder
// (index.html must be at the root of the zip) and upload it to that platform.
import { build } from "vite";
const all = ["gamemonetize", "crazygames", "poki", "youtube"];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const p of targets) {
  process.env.PLATFORM = p;
  await build({ configFile: "vite.static.config.ts", logLevel: "warn" });
  console.log(`built dist-platforms/${p}`);
}
