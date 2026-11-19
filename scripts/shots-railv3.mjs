import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const phase = process.argv[2] === "after" ? "after" : "before";
const port = Number(process.argv[3] || 3000);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, "railv3-shots", phase);
await mkdir(OUT, { recursive: true });
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome");
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(40000);
await page.addInitScript(() => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
});
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
const layout = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10); d.setAzimuth(0.4);
  d.build("sweeper", -8, 16); d.build("purifier", 6, 18); d.build("press", 16, 8); d.step(0.3);
  const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
  return { purifier: { x: purifier.x, z: purifier.z, radius: purifier.radius ?? null }, buttons: ["rail-merge", "rail-split", "rail-shared", "rail-draw"].map((id) => ({ id, exists: !!document.getElementById(id) })) };
});
await page.screenshot({ path: join(OUT, "01-base.png") });
await page.evaluate(() => window.__whiteoutDebug.selectRail());
await page.waitForTimeout(200);
await page.screenshot({ path: join(OUT, "02-rail-tools.png") });
if (phase === "before") {
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.netPlace("merge", 0, 14);
    const sweeper = d.snapshot().buildings.find((b) => b.type === "sweeper");
    const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
    d.netLink({ buildingId: sweeper.id, port: "out" }, { nodeId: d.netState().junctions[0].id });
    d.netLink({ nodeId: d.netState().junctions[0].id }, { buildingId: purifier.id, port: "in" });
    d.step(1.2);
  });
  await page.screenshot({ path: join(OUT, "03-junction.png") });
}
if (phase === "after") {
  const drag = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 12); d.setAzimuth(0.5); d.selectRail();
    const sweeper = d.build("sweeper", -6, 16);
    const purifier = d.build("purifier", 12, 16);
    d.step(0.2);
    return { start: d.worldToScreen(sweeper ? -6 : -6, 16), mid: d.worldToScreen(3, 22), end: d.worldToScreen(12, 16) };
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.mid.x, drag.mid.y, { steps: 12 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, "03-drawing.png") });
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "04-draw-confirm.png") });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const button = document.getElementById("rail-confirm");
    if (button && !button.disabled) button.click();
    d.build("sweeper", -6, 6);
    d.commitStroke([{ x: -6, z: 6 }, { x: 3, z: 16 }]);
    d.build("sweeper", 4, 4);
    d.build("purifier", 4, 26);
    d.commitStroke([{ x: 4, z: 4 }, { x: 4, z: 26 }]);
    d.step(0.4);
  });
  await page.screenshot({ path: join(OUT, "05-junctions.png") });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const edge = d.netState().edges[0];
    if (edge) d.reshapeEdge(edge.id, [{ x: -6, z: 16 }, { x: 2, z: 20 }, { x: 8, z: 14 }, { x: 12, z: 16 }]);
    d.selectRail();
  });
  const edgeHit = await page.evaluate(() => window.__whiteoutDebug.worldToScreen(2, 18));
  await page.mouse.click(edgeHit.x, edgeHit.y);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, "06-edit-menu.png") });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const edges = d.netState().edges;
    const extra = edges[edges.length - 1];
    if (extra) d.deleteEdge(extra.id);
    const junction = d.netState().junctions[0];
    if (junction) {
      const spot = d.worldToScreen(junction.x, junction.z);
      return spot;
    }
    return null;
  });
  await page.screenshot({ path: join(OUT, "07-after-delete.png") });
  const junctionSpot = await page.evaluate(() => {
    const junction = window.__whiteoutDebug.netState().junctions[0];
    return junction ? window.__whiteoutDebug.worldToScreen(junction.x, junction.z) : null;
  });
  if (junctionSpot && !junctionSpot.behind) {
    await page.mouse.click(junctionSpot.x, junctionSpot.y);
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: join(OUT, "08-junction-controls.png") });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const sweeper = d.snapshot().buildings.find((b) => b.type === "sweeper");
    if (sweeper) d.setOutput(sweeper.id, 30);
    d.step(1.4);
  });
  await page.screenshot({ path: join(OUT, "09-capsules.png") });
}
await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
  d.teleport(purifier.x, purifier.z + 6); d.setAzimuth(0.2); d.step(0.4);
});
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, phase === "after" ? "10-purifier.png" : "04-purifier.png") });
console.log(JSON.stringify({ phase, port, layout }, null, 2));
await browser.close();
