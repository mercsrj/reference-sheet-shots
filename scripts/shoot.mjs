// Usage: node scripts/shoot.mjs queue/2026-10-17.json
// Queue file: { "date": "YYYY-MM-DD", "items": [ { "id": "lpas-com", "url": "https://lpas.com/" } ] }
// Output: shots/<date>/<id>-hero.jpg (1440x900), shots/<date>/<id>-full.jpg (whole page, capped), manifest.json
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const W = 1440, H = 900, MAX_FULL = 14000, FULL_WIDTH_OUT = 1200;

const HIDE_OVERLAYS = `
  [id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],
  #onetrust-banner-sdk,#onetrust-consent-sdk,.cc-window,.cky-consent-container,#CybotCookiebotDialog,
  [id*="gdpr" i],[class*="gdpr" i],#usercentrics-root,.osano-cm-window,#hs-eu-cookie-confirmation
  { display:none !important; visibility:hidden !important; }
  html,body{ overflow: auto !important; }
  iframe[src*="vimeo.com"],iframe[src*="youtube.com"],iframe[src*="youtube-nocookie.com"]{ visibility:hidden !important; }
`;

const queueFile = process.argv[2];
const queue = JSON.parse(await fs.readFile(queueFile, "utf8"));
const date = queue.date || path.basename(queueFile, ".json");
const outDir = path.join("shots", date);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const results = [];

for (const item of queue.items || []) {
  const r = { id: item.id, url: item.url, hero: null, full: null, ok: false, error: null };
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.addStyleTag({ content: HIDE_OVERLAYS }).catch(() => {});
    await page.waitForTimeout(8000); // let intro loaders and 3D scenes finish

    // Hero (first screen)
    const heroPath = path.join(outDir, `${item.id}-hero.jpg`);
    const heroPng = await page.screenshot({ type: "png" });
    await sharp(heroPng).jpeg({ quality: 82, mozjpeg: true }).toFile(heroPath);
    r.hero = heroPath;

    // Full page: scroll through to trigger lazy images and scroll animations
    const scrollH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    let fullBuf;
    if (scrollH > H * 1.3) {
      for (let y = 0; y < Math.min(scrollH, MAX_FULL); y += 700) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(400);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1200);
      const h = Math.min(scrollH, MAX_FULL);
      fullBuf = await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: W, height: h } });
    } else {
      // Smooth-scroll sites (Lenis, Locomotive...) keep the document one screen tall:
      // scroll with the wheel and stitch viewport frames.
      const frames = [heroPng];
      let last = heroPng.toString("base64").slice(-2000);
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(W / 2, H / 2);
        await page.mouse.wheel(0, H - 120);
        await page.waitForTimeout(1300);
        const f = await page.screenshot({ type: "png" });
        const sig = f.toString("base64").slice(-2000);
        if (sig === last) break;
        frames.push(f);
        last = sig;
      }
      const step = H - 120;
      const totalH = Math.min(H + (frames.length - 1) * step, MAX_FULL);
      fullBuf = await sharp({ create: { width: W, height: totalH, channels: 3, background: "#ffffff" } })
        .composite(frames.map((f, i) => ({ input: f, top: Math.min(i * step, totalH - H), left: 0 })))
        .png()
        .toBuffer();
    }
    const fullPath = path.join(outDir, `${item.id}-full.jpg`);
    await sharp(fullBuf).resize({ width: FULL_WIDTH_OUT }).jpeg({ quality: 72, mozjpeg: true }).toFile(fullPath);
    r.full = fullPath;
    r.ok = true;
  } catch (e) {
    r.error = String(e && e.message ? e.message : e).slice(0, 300);
  } finally {
    await ctx.close().catch(() => {});
  }
  results.push(r);
  console.log(`${r.ok ? "OK  " : "FAIL"} ${item.id} ${r.error || ""}`);
}

await browser.close();
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify({ date, items: results }, null, 2));
