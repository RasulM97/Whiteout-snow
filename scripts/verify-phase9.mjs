/**
 * Phase 9 localization checks and interface screenshots.
 * Static checks run against source. Browser checks serve dist/ with external
 * network requests blocked, so a font CDN cannot satisfy them.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = join(ROOT, "src/game/i18n.ts");
const CSS = readFileSync(join(ROOT, "src/index.css"), "utf8");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const SHOTS = "D:/Game/app/phase9-shots";
const REPORT = "D:/Game/reports/phase9-ui.json";
mkdirSync(SHOTS, { recursive: true });

const source = readFileSync(SRC, "utf8");
function sliceBetween(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`missing block ${start}`);
  return source.slice(a, b);
}
function pairs(block) {
  const map = new Map();
  const re = /"((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = re.exec(block))) map.set(match[1], match[2].replace(/\\"/g, '"'));
  return map;
}
function merge(...maps) {
  const out = new Map();
  for (const map of maps) for (const [key, value] of map) out.set(key, value);
  return out;
}
const enInit = pairs(sliceBetween("const en", "const fa"));
const faInit = pairs(sliceBetween("const fa", "const zh"));
const zhInit = pairs(sliceBetween("const zh", "Object.assign(en"));
const enAssign = pairs(sliceBetween("Object.assign(en", "Object.assign(fa"));
const faAssign = pairs(sliceBetween("Object.assign(fa", "Object.assign(zh"));
const zhAssign = pairs(sliceBetween("Object.assign(zh", "export const dictionaries"));
const en = merge(enInit, enAssign);
const fa = merge(enInit, faInit, faAssign);
const zh = merge(enInit, zhInit, zhAssign);
const problems = [];
const fail = (message) => problems.push(message);

const placeholders = (value) => [...value.matchAll(/\{[A-Za-z0-9]+\}/g)].map((item) => item[0]).sort().join(",");
for (const key of en.keys()) {
  if (!fa.has(key)) fail(`fa missing ${key}`);
  if (!zh.has(key)) fail(`zh missing ${key}`);
  if (fa.has(key) && placeholders(en.get(key)) !== placeholders(fa.get(key))) fail(`fa placeholders ${key}`);
  if (zh.has(key) && placeholders(en.get(key)) !== placeholders(zh.get(key))) fail(`zh placeholders ${key}`);
}
for (const [key, value] of fa) if (/[\u064A\u0643\u0629]/.test(value)) fail(`arabic form ${key}`);
for (const [key, value] of zh) if (/[\u4e00-\u9fff]\s+[\u4e00-\u9fff]/.test(value)) fail(`cjk space ${key}`);
const banned = ["کوئست", "تصفیه‌ساز", "یخ‌ساز", "铁路", "Mystery clues", "Current quest", "Draw maglev", "SEVERE STORM"];
for (const map of [en, fa, zh]) for (const [key, value] of map) for (const word of banned) if (value.includes(word)) fail(`banned ${word} in ${key}`);
if (fa.get("rail.draw") !== "رسم ریل" || zh.get("rail.draw") !== "绘制导轨") fail("rail button text drifted");
if (!en.get("quest.9.desc").includes("95%") || !fa.get("quest.9.desc").includes("۹۵٪") || !zh.get("quest.9.desc").includes("95%")) fail("95% mission text drifted");
if (!en.get("hud.cargoHelp").includes("42") || !zh.get("hud.cargoHelp").includes("42") || !fa.get("hud.cargoHelp").includes("۴۲")) fail("ice price text drifted");
const terms = {
  "building.purifier.name": ["Snow purifier", "تصفیه‌خانه", "净雪器"],
  "building.press.name": ["Ice block press", "پرس قالب یخ", "冰块压机"],
  "building.sweeper.name": ["Sweeper dock", "ایستگاه برف‌روب", "扫雪机器人基站"],
  "building.heater.name": ["Area heater", "گرمکن محوطه", "区域加热器"],
  "building.generator.name": ["Orbital generator", "ژنراتور مداری", "轨道发电机"],
  "building.hauler.name": ["Search & rescue dock", "ایستگاه جست‌وجو و نجات", "搜救机器人基站"],
  "robot.clearArea": ["Return to auto", "بازگشت به خودکار", "恢复自动"],
  "robot.zone": ["Work area", "ناحیه‌ی کاری", "工作区"],
  "storm.severe": ["Severe storm", "طوفان سهمگین", "特大暴雪"],
  "hud.power": ["Mission uplink", "شارژ ارتباط مأموریت", "任务链路"],
  "rail.merge": ["Merge", "ادغام", "合流"],
  "rail.split": ["Split", "تقسیم", "分流"],
  "rail.junction": ["Junction", "تقاطع", "岔口"],
  "hud.toolHealth": ["Tool condition", "وضعیت ابزار", "工具状态"],
  "action.repair": ["Repair", "تعمیر", "维修"],
};
for (const [key, expected] of Object.entries(terms)) {
  const got = [en.get(key), fa.get(key), zh.get(key)];
  if (got.some((value, index) => value !== expected[index])) fail(`${key} => ${got.join(" | ")}`);
}
if (CSS.includes("fonts.googleapis") || CSS.includes("fonts.gstatic") || HTML.includes("fonts.googleapis")) fail("font CDN reference");
for (const family of ["InterVariable.woff2", "Vazirmatn.woff2", "NotoSansSC.woff2"]) if (!CSS.includes(family)) fail(`css missing ${family}`);
for (const file of ["InterVariable.woff2", "Vazirmatn.woff2", "NotoSansSC.woff2", "Inter-LICENSE.txt", "Vazirmatn-OFL.txt", "NotoSansSC-OFL.txt"]) {
  const path = join(ROOT, "public/fonts", file);
  if (!existsSync(path)) fail(`missing ${file}`);
  else if (file.endsWith(".woff2")) {
    const magic = readFileSync(path).subarray(0, 4).toString("ascii");
    if (magic !== "wOF2") fail(`${file} is not woff2`);
  } else if (!readFileSync(path, "utf8").includes("SIL Open Font License")) fail(`${file} is not OFL`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`PASS static keys en ${en.size} fa ${fa.size} zh ${zh.size}`);

const DIST = join(ROOT, "dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error("VERIFY FAIL: build dist first");
  process.exit(1);
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".txt": "text/plain", ".md": "text/markdown", ".mp3": "audio/mpeg", ".webm": "audio/webm" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
for (const executablePath of [process.env.CHROMIUM_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean)) {
  try {
    browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    break;
  } catch { /* next browser */ }
}
if (!browser) { server.close(); throw new Error("Chrome was not found"); }

const notes = { origin, external: [], layout: [], shots: [], fonts: {} };
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

async function openPage(context, language) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const external = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("blob:") || url.startsWith("data:")) route.continue();
    else { external.push(url); notes.external.push(url); route.abort(); }
  });
  await page.addInitScript((lang) => {
    localStorage.removeItem("whiteout.career-v2");
    if (sessionStorage.getItem("phase9-keep-language") === "1") return;
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: lang, quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1 }));
  }, language);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  page.external = external;
  return page;
}
async function shot(page, name) {
  const path = join(SHOTS, name);
  await page.screenshot({ path, animations: "disabled" });
  notes.shots.push(path);
  const clipped = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#ui-overlay button, #quest-desc, .build-copy b, #prompt-text, #end-title, #end-copy, h1, h2")];
    return nodes.flatMap((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".hidden")) return [];
      const overflow = style.overflowX === "hidden" || style.overflowY === "hidden" || style.textOverflow === "ellipsis";
      if (!overflow) return [];
      if (el.scrollWidth > el.clientWidth + 12 || el.scrollHeight > el.clientHeight + 12) return [`${el.id || el.className}: ${el.textContent.trim().slice(0, 48)}`];
      return [];
    });
  });
  if (clipped.length) notes.layout.push({ name, clipped });
}
async function call(page, fn) {
  return page.evaluate(fn);
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const language of ["en", "fa", "zh"]) {
    const page = await openPage(desktop, language);
    notes.fonts[language] = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      family: getComputedStyle(document.documentElement).fontFamily,
      inter: document.fonts.check("16px Inter"),
      vazir: document.fonts.check("16px Vazirmatn"),
      noto: document.fonts.check('16px "Noto Sans SC"'),
      canvas: document.querySelector("#game-canvas")?.getAttribute("aria-label") || "",
      dock: document.querySelector("#build-dock")?.getAttribute("aria-label") || "",
    }));
    await shot(page, `${language}-1280-title.png`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(250);
    await shot(page, `${language}-1920-title.png`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.click("#title-settings-btn");
    await page.waitForTimeout(200);
    await shot(page, `${language}-1280-settings.png`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await shot(page, `${language}-1920-settings.png`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.click("#close-settings-btn");
    await call(page, () => window.__whiteoutDebug.start());
    await page.waitForTimeout(300);
    await call(page, () => window.__whiteoutDebug.lose());
    await page.waitForSelector("#end-screen:not(.hidden)");
    await shot(page, `${language}-1280-gameover.png`);
    await call(page, () => window.__whiteoutDebug.start());
    await page.waitForTimeout(400);
    await shot(page, `${language}-1280-hud.png`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(200);
    await shot(page, `${language}-1920-hud.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await shot(page, `${language}-narrow-hud.png`);
    await page.setViewportSize({ width: 1280, height: 720 });
    const placed = await page.evaluate(() => {
      const debug = window.__whiteoutDebug;
      const place = (type) => {
        for (let x = -30; x <= 30; x += 6) for (let z = -12; z <= 30; z += 6) {
          const id = debug.build(type, x, z);
          if (id) return { id, x, z };
        }
        return null;
      };
      return { purifier: place("purifier"), press: place("press"), sweeper: place("sweeper") };
    });
    assert(placed.purifier && placed.press && placed.sweeper, `${language} factory cards can be opened`);
    await page.evaluate((spot) => window.__whiteoutDebug.teleport(spot.x, spot.z), placed.purifier);
    await page.waitForTimeout(350);
    await shot(page, `${language}-1280-purifier.png`);
    await page.evaluate((spot) => window.__whiteoutDebug.teleport(spot.x, spot.z), placed.press);
    await page.waitForTimeout(350);
    await shot(page, `${language}-1280-press.png`);
    await page.evaluate((spot) => window.__whiteoutDebug.teleport(spot.x, spot.z), placed.sweeper);
    await page.waitForTimeout(350);
    await shot(page, `${language}-1280-work-area.png`);
    await page.evaluate(() => window.__whiteoutDebug.openUpgrades());
    await page.waitForTimeout(300);
    await shot(page, `${language}-1280-tools.png`);
    await page.click("#close-upgrades-btn");
    await page.evaluate(() => window.__whiteoutDebug.selectRail());
    await page.waitForTimeout(300);
    await shot(page, `${language}-1280-rail.png`);
    await page.evaluate(() => window.__whiteoutDebug.storm(true));
    await page.waitForTimeout(300);
    await shot(page, `${language}-1280-storm.png`);
    await page.evaluate(() => window.__whiteoutDebug.win());
    await page.waitForSelector("#end-screen:not(.hidden)");
    await shot(page, `${language}-1280-victory.png`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await shot(page, `${language}-1920-victory.png`);
    await page.close();
  }

  const touch = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  for (const language of ["en", "fa", "zh"]) {
    const page = await openPage(touch, language);
    await shot(page, `${language}-touch-land-title.png`);
    await page.evaluate(() => window.__whiteoutDebug.start());
    await page.waitForTimeout(400);
    await shot(page, `${language}-touch-land-hud.png`);
    await page.evaluate(() => window.__whiteoutDebug.openUpgrades());
    await page.waitForTimeout(250);
    await shot(page, `${language}-touch-land-tools.png`);
    await page.click("#close-upgrades-btn");
    await page.evaluate(() => window.__whiteoutDebug.storm(true));
    await page.waitForTimeout(250);
    await shot(page, `${language}-touch-land-storm.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await shot(page, `${language}-touch-port-lock.png`);
    await page.close();
  }
  await touch.close();

  const persist = await openPage(desktop, "en");
  await persist.click("#title-settings-btn");
  await persist.selectOption("#set-language", "fa");
  await persist.waitForFunction(() => document.documentElement.dir === "rtl");
  const saved = await persist.evaluate(() => {
    sessionStorage.setItem("phase9-keep-language", "1");
    return JSON.parse(localStorage.getItem("whiteout.settings-v2") || "{}").language;
  });
  if (saved !== "fa") throw new Error(`language control did not save fa (${saved})`);
  await persist.reload({ waitUntil: "domcontentloaded" });
  await persist.waitForFunction(() => window.__GAME_READY__ === true);
  const kept = await persist.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    start: document.querySelector("#start-btn")?.textContent || "",
    family: getComputedStyle(document.documentElement).fontFamily,
  }));
  notes.persist = kept;
  assert(kept.dir === "rtl" && kept.lang === "fa" && /[\u0600-\u06FF]/.test(kept.start), "Persian stays selected after reload");
  assert(kept.family.includes("Vazirmatn"), "Persian uses the bundled Vazirmatn face");
  await persist.close();
  await desktop.close();

  const fonts = notes.fonts;
  assert(fonts.en.dir === "ltr" && fonts.en.lang === "en" && fonts.en.inter && fonts.en.family.includes("Inter"), "English is LTR in Inter");
  assert(fonts.fa.dir === "rtl" && fonts.fa.lang === "fa" && fonts.fa.vazir, "Persian is RTL and Vazirmatn loaded");
  assert(fonts.zh.dir === "ltr" && fonts.zh.lang === "zh-CN" && fonts.zh.noto, "Chinese is LTR and Noto Sans SC loaded");
  assert(fonts.en.canvas.includes("Whiteout") && /[\u0600-\u06FF]/.test(fonts.fa.canvas) && /[\u4e00-\u9fff]/.test(fonts.zh.canvas), "canvas label follows the language");
  assert(notes.external.length === 0, "no request left the local build");
  assert(notes.layout.length === 0, `no clipped controls ${JSON.stringify(notes.layout)}`);
  writeFileSync(REPORT, JSON.stringify(notes, null, 2));
  console.log(`PASS screenshots ${notes.shots.length}`);
} finally {
  await browser.close();
  server.close();
}
