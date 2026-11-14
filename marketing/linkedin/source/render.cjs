const { chromium } = require("playwright-core");
const [,, page_, out] = process.argv;
(async () => {
  const b = await chromium.launch({ executablePath: "/Users/santiagopetean/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", args: ["--allow-file-access-from-files"] });
  const p = await b.newPage({ viewport: { width: 1300, height: 1500 }, deviceScaleFactor: 2 });
  await p.goto("file://" + page_); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  for (const id of await p.$$eval("section.frame", els => els.map(e => e.id))) {
    await p.locator("#" + id).screenshot({ path: `${out}/${id}.png` });
  }
  await b.close();
})();
