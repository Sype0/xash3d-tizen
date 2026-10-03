// Headless smoke test: start the engine through the launcher the way a TV
// would and make sure it initializes and keeps rendering frames.
//
// Usage: node smoke-test.mjs <site url> <game data zip url>
//
// CI has no Half-Life data, so the zip only holds a stub game folder: this
// checks the launcher, the streamed unzip, library loading and engine
// start-up, not the game itself.
import { chromium } from "playwright";

const [siteUrl, dataUrl] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (n) => page.screenshot({ path: `shot-${n}.png` });

// Simulates a TV remote key (TV keys have keyCodes but no event.code).
async function remoteKey(keyCode) {
   const fire = (type) => page.evaluate(([type, keyCode]) => {
      const e = new KeyboardEvent(type, { bubbles: true });
      Object.defineProperty(e, "keyCode", { get: () => keyCode });
      window.dispatchEvent(e);
   }, [type, keyCode]);
   await fire("keydown");
   await page.waitForTimeout(150);
   await fire("keyup");
}

let failed = false;
try {
   await page.goto(siteUrl + "?args=-dev%202&data=" + encodeURIComponent(dataUrl));
   await page.waitForSelector("#btn-play.focused");
   await shot("1-launcher");
   await remoteKey(13); // OK on "start"
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(10000);
   await shot("2-engine");

   const errors = await page.$eval("#errors", (e) => e.textContent);
   if (errors.trim()) throw new Error("on-screen errors:\n" + errors);
   if (!logs.some((l) => /game data: \d+ files/.test(l))) throw new Error("game data was not unpacked");

   // the filter must have dropped the native library and kept the rest
   const fsState = await page.evaluate(() => {
      const FS = window.__xash.FS;
      const has = (p) => { try { FS.stat(p); return true; } catch (e) { return false; } };
      return { gam: has("/rodir/valve/liblist.gam"), dll: has("/rodir/valve/dlls/hl.dll"), extras: has("/rodir/valve/extras.pk3") };
   });
   if (!fsState.gam || fsState.dll || !fsState.extras) throw new Error("unexpected filesystem: " + JSON.stringify(fsState));

   // frames keep coming and remote keys reach the engine without errors
   const before = await page.screenshot();
   await remoteKey(40);
   await remoteKey(13);
   await page.waitForTimeout(3000);
   await shot("3-after-keys");
   if (!(await page.$("body.playing"))) throw new Error("engine stopped");
   const errors2 = await page.$eval("#errors", (e) => e.textContent);
   if (errors2.trim()) throw new Error("on-screen errors:\n" + errors2);
   console.log("screen changed after keys:", !before.equals(await page.screenshot()));
   console.log("PASS");
} catch (e) {
   failed = true;
   console.error(`FAIL: ${e.stack || e}`);
   await shot("error").catch(() => {});
}
console.log("--- log (tail) ---\n" + logs.slice(-80).join("\n"));
await browser.close();
process.exit(failed ? 1 : 0);
