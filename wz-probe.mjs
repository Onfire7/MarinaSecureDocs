import { chromium } from "playwright";
const APP = "https://beta2.marinasecure.com";
const AUDIT = "e6b87100-573d-448a-ac94-0a58e6ad7947";
const OUT = "/tmp/pw-test/screenshots";
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/Sync error/.test(m.text()) && errors.push("console: " + m.text().slice(0, 200)));
page.on("response", async (r) => { if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)}`); });
const say = (k, ok, d = "") => console.log(`${ok ? "ok " : "NOT ok"} ${k}${d ? " — " + d : ""}`);
const col = () => page.evaluate(() => { const c = document.querySelector(".wz-d-col:not([class*=wz-out])"); return { top: Math.round(c.scrollTop), h: c.clientHeight, n: c.querySelectorAll("[data-page]").length, ov: getComputedStyle(c).overflowY }; });
const at = () => page.evaluate(() => ({ loc: document.querySelector('[data-testid="wz-location"]')?.innerText, page: [...document.querySelectorAll('[data-testid="wz-pip"]')].findIndex((p) => p.classList.contains("now")), focus: document.activeElement?.tagName }));
const cdp = await ctx.newCDPSession(page);
const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
const watch = () => page.evaluate(() => { window.__t = []; const c = document.querySelector(".wz-d-col:not([class*=wz-out])"); window.__iv = setInterval(() => window.__t.push(Math.round(c.scrollTop)), 16); });
const stop = () => page.evaluate(() => { clearInterval(window.__iv); return window.__t; });
const drag = async (from, to, stepPx = 10) => {
  await touch("touchStart", from);
  const s = from > to ? -stepPx : stepPx;
  for (let y = from + s; s < 0 ? y >= to : y <= to; y += s) { await touch("touchMove", y); await page.waitForTimeout(8); }
  await touch("touchEnd", to);
};

await page.goto(`${APP}/audits/${AUDIT}/wizard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/wz-setup.png` });
console.log((await page.innerText(".wz-footer")).replace(/\n/g, " | "));
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-pip"]', { timeout: 60000 });
await page.waitForTimeout(1800);
const c0 = await col();
say("column is overflow hidden with N pages", c0.ov === "hidden" && c0.n > 1, JSON.stringify(c0));
console.log("start:", JSON.stringify(await at()));
await page.screenshot({ path: `${OUT}/wz-p0.png` });

// 1. short swipe: 50px of thumb = 250px of page, short of half -> goes back
await watch(); await drag(600, 550); await page.waitForTimeout(900);
let t = await stop(); let c = await col();
say("1 a 50px swipe (under half a page at 5x) goes back", c.top === 0 && Math.max(...t) > 150, `peak ${Math.max(...t)}, rest ${c.top}, page ${(await at()).page}`);

// 2. a 100px swipe = 500px > 40% -> one page
await watch(); await drag(600, 500); await page.waitForTimeout(900);
t = await stop(); c = await col();
say("2 a 100px swipe turns exactly one page", Math.abs(c.top - c.h) <= 1 && (await at()).page === 1, `peak ${Math.max(...t)}, rest ${c.top}, h ${c.h}, page ${(await at()).page}`);

// 3. a huge 400px swipe still turns exactly one page (hard stop)
await watch(); await drag(700, 300); await page.waitForTimeout(900);
t = await stop(); c = await col();
say("3 a 400px swipe is clamped at the next page", Math.max(...t) <= c.h * 2 + 2 && Math.abs(c.top - c.h * 2) <= 2 && (await at()).page === 2, `peak ${Math.max(...t)}, rest ${c.top}, 2h ${c.h * 2}, page ${(await at()).page}`);
await page.screenshot({ path: `${OUT}/wz-p2.png` });

// 4. swipe back up
await watch(); await drag(300, 420); await page.waitForTimeout(900);
t = await stop(); c = await col();
say("4 a swipe up goes back one page", Math.abs(c.top - c.h) <= 1 && (await at()).page === 1, `rest ${c.top}, page ${(await at()).page}`);

// 5. wheel burst = one page
await page.mouse.move(200, 400); await page.mouse.wheel(0, 1600); await page.waitForTimeout(900);
c = await col();
say("5 a wheel burst of 1600 turns one page", Math.abs(c.top - c.h * 2) <= 2 && (await at()).page === 2, `rest ${c.top}, page ${(await at()).page}`);

// 6. the Next button on a typed page
const pips = await page.locator('[data-testid="wz-pip"]').evaluateAll((els) => els.map((e) => e.getAttribute("title")));
console.log("items:", pips.join(" | "));
const nextCount = await page.locator('[data-testid="wz-item-next"]').count();
const typed = await page.locator(".wz-d-page input:not([type=checkbox])").count();
say("6 pages with a field have a Next button", typed === 0 ? nextCount === 0 : nextCount > 0, `${typed} typed inputs, ${nextCount} Next buttons`);
if (nextCount) {
  const idx = await page.locator(".wz-d-page").evaluateAll((els) => els.findIndex((e) => e.querySelector('[data-testid="wz-item-next"]')));
  await page.locator('[data-testid="wz-pip"]').nth(idx).click(); await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/wz-next.png` });
  const before = (await at()).page;
  await page.locator(".wz-d-page").nth(idx).getByTestId("wz-item-next").click(); await page.waitForTimeout(900);
  say("7 tapping Next moves to the next item", (await at()).page === before + 1, `${before} → ${(await at()).page}`);
}

// 8. roll over: go to the last page, push past it
await page.locator('[data-testid="wz-pip"]').last().click(); await page.waitForTimeout(900);
const locBefore = (await at()).loc;
await drag(700, 250); await page.waitForTimeout(1200);
say("8 pushing past the last page rolls into the next location", (await at()).loc !== locBefore && (await at()).page === 0, `${locBefore} → ${(await at()).loc}, page ${(await at()).page}`);
await page.screenshot({ path: `${OUT}/wz-rolled.png` });
// 9. and back
await drag(300, 750); await page.waitForTimeout(1200);
say("9 pushing past the first page rolls back to the previous location's last item", (await at()).loc === locBefore, `${(await at()).loc}, page ${(await at()).page}`);

console.log("errors:", errors.length ? errors : "(none)");
await browser.close();
