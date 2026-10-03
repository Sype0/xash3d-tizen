// Headless smoke test: drive the launcher the way a TV would, through each
// way of getting the game data, and check the engine starts on it.
//
// Usage: node smoke-test.mjs <site url> <game data zip url> <game data zip file>
//
// CI has no Half-Life data, so the zip only holds a stub game folder. The
// engine is expected to initialize, mount the data and then stop because
// gfx.wad is missing: this covers the launcher, the streamed unzip, the TV
// cache, the phone relay, library loading and engine start-up, not the game.
import { chromium } from "playwright";

const [siteUrl, dataUrl, dataFile] = process.argv.slice(2);
const browser = await chromium.launch();
// one context, so the cached game data survives from one scenario to the next
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
let failed = false;

// Simulates a TV remote key (TV keys have keyCodes but no event.code).
async function remoteKey(page, keyCode) {
   const fire = (type) => page.evaluate(([type, keyCode]) => {
      const e = new KeyboardEvent(type, { bubbles: true });
      Object.defineProperty(e, "keyCode", { get: () => keyCode });
      window.dispatchEvent(e);
   }, [type, keyCode]);
   await fire("keydown");
   await page.waitForTimeout(150);
   await fire("keyup");
}

async function scenario(name, query, dataLog, steps) {
   const page = await context.newPage();
   const logs = [];
   page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
   page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
   const shot = (n) => page.screenshot({ path: `shot-${name}-${n}.png` });
   const sawLog = (re) => logs.some((l) => re.test(l));
   try {
      await page.goto(siteUrl + "?args=-dev%202" + query);
      await page.waitForSelector("#btn-play.focused");
      await steps(page, shot);
      // the engine got as far as it can without real game data
      await page.waitForFunction(() => /gfx\.wad/.test(document.getElementById("errors").textContent), null, { timeout: 180000 });
      await shot("engine");
      if (!sawLog(dataLog)) throw new Error("game data was not loaded as expected: " + dataLog);
      if (!sawLog(/Adding ZIP: valve\/extras\.pk3/)) throw new Error("engine did not mount the game folder");
      // any key goes back to the launcher
      await remoteKey(page, 13);
      await page.waitForSelector("#btn-play.focused");
      console.log(`PASS ${name}`);
   } catch (e) {
      failed = true;
      console.error(`FAIL ${name}: ${e.stack || e}`);
      await shot("error").catch(() => {});
   }
   console.log(`--- ${name} log (tail) ---\n` + logs.slice(-30).join("\n"));
   await page.close();
}

// download from a network address; the stub's hl.dll must be filtered out
await scenario("http", "&data=" + encodeURIComponent(dataUrl), /game data: 1 files, /, async (page, shot) => {
   await shot("launcher");
   await remoteKey(page, 13); // OK on "start"
});

// second start: no address, the data comes from the TV's own storage
await scenario("cached", "", /game data: 1 files \(cached\)/, async (page) => {
   await remoteKey(page, 13);
});

// zip sent from a phone through the TizenBrew service
await scenario("phone", "", /game data: 1 files, /, async (page, shot) => {
   await page.waitForSelector("#phone-panel svg", { timeout: 20000 });
   await shot("qr");
   const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
   // the QR points at the TV's LAN address; in CI that is this runner
   await phone.goto(await page.$eval("#phone-url", (e) => e.textContent));
   await phone.setInputFiles("#file", dataFile);
   await phone.click("#send");
   await phone.waitForSelector("#status.ok", { timeout: 30000 });
   await phone.screenshot({ path: "shot-phone-sent.png" });
   await phone.close();
});

await browser.close();
process.exit(failed ? 1 : 0);
