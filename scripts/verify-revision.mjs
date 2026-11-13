import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "verification-revision");
mkdirSync(SHOTS, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
let browser;
for (const executablePath of [process.env.CHROMIUM_PATH, "/opt/ms-playwright/chromium-1234/chrome-linux64/chrome", "/usr/bin/chromium", "/opt/gchrome/opt/google/chrome/chrome"].filter(Boolean)) {
  try { browser = await chromium.launch({headless:!process.env.DISPLAY, executablePath, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-angle=swiftshader","--enable-unsafe-swiftshader"] }); break; } catch { /* next browser */ }
}
if (!browser) { server.close(); throw new Error("No usable Chromium browser found"); }
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0.2, muted: true, cameraShake: true, particles: true, uiScale: 1 }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  });
  const debug = (expression, ...args) => page.evaluate(({ expression, args }) => {
    const parts = expression.split("."); let target = window.__whiteoutDebug;
    for (const part of parts) target = target[part];
    return typeof target === "function" ? target(...args) : target;
  }, { expression, args });
  const snap = () => debug("snapshot");
  const setCredits = async (amount) => { const current = (await snap()).credits; await debug("giveCredits", amount - current); };
  const fresh = async (credits = 1000) => { await debug("start"); await debug("setQuest", 8); await setCredits(credits); await debug("teleport", 0, 10); };
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ && !!window.__whiteoutDebug, null, { timeout: 90000 });
  await fresh(20000);

  // Shared tool progression: all tiers improve every useful dimension.
  const progression = await page.evaluate(() => {
    const d = window.__whiteoutDebug; const ids = ["hands", "shovel", "brush", "blower", "vacuum"];
    return Object.fromEntries(ids.map((id) => [id, [1, 2, 3, 4].map((level) => d.toolStats(id, level))]));
  });
  for (const [id, tiers] of Object.entries(progression)) {
    for (let i = 1; i < tiers.length; i++) {
      const before = tiers[i - 1], after = tiers[i];
      assert(after.rate > before.rate && after.radius > before.radius && after.area > before.area && after.yield > before.yield && after.distance > before.distance && after.capacity > before.capacity, `${id} tier ${i + 1} improves speed, radius, area, recovery, reach and capacity`);
    }
  }
  for (let level = 1; level <= 4; level++) {
    const brush = progression.brush[level - 1], vacuum = progression.vacuum[level - 1];
    assert(vacuum.rate > brush.rate && vacuum.radius > brush.radius && vacuum.area > brush.area && vacuum.distance > brush.distance && vacuum.capacity > brush.capacity && vacuum.yield > brush.yield, `vacuum tier ${level} is strictly stronger than the same-tier brush`);
  }
  await debug("setQuest", 6); await page.click("#shop-btn");
  assert(await page.locator(".tool-tier-stats").count() === 5 && await page.locator(".tool-tier-stats").evaluateAll((nodes) => nodes.every((n) => n.textContent.trim().length > 20)) && (await page.locator("#tool-stats-hands").innerText()).includes("→"), "shop displays live statistics for every tool and current-to-next values for owned upgrades");
  await page.locator('[data-buy-tool="brush"]').click(); await page.locator('[data-buy-tool="vacuum"]').click();
  assert((await snap()).tools.brush === 1 && (await snap()).tools.vacuum === 1 && (await snap()).selectedTool === "vacuum", "real shop buttons purchase brush and final vacuum through the same progression");
  await page.screenshot({ path: join(SHOTS, "01-tool-progression.png") });
  await page.click("#close-upgrades-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");

  // Grounding on visible snow and on freshly cleared, gently undulating terrain.
  const grounding = await page.evaluate(() => {
    const d = window.__whiteoutDebug; const results = [];
    for (const [x, z] of [[25, 25], [35, 20], [-30, 28], [45, -20]]) {
      d.teleport(x, z); d.step(1.2);
      const snowy = d.grounding();
      d.clearAt(x, z, 5); d.step(1.2);
      const cleared = d.grounding();
      results.push({ x, z, snowy, cleared });
    }
    return results;
  });
  for (const sample of grounding) {
    assert(Math.abs(sample.snowy.soleY - sample.snowy.snowHeight) < 0.035 && sample.snowy.soleY >= sample.snowy.groundHeight, `boots rest on visible snow at ${sample.x},${sample.z} (${JSON.stringify(sample.snowy)})`);
    assert(Math.abs(sample.cleared.soleY - sample.cleared.physicsFootY) < 0.025 && sample.cleared.soleY >= sample.cleared.groundHeight && Math.abs(sample.cleared.physicsFootY - sample.cleared.groundHeight - 0.025) < 0.001, `boots remain on the matching physical surface after clearing at ${sample.x},${sample.z} (${JSON.stringify(sample.cleared)})`);
  }
  await debug("teleport", 36, 30); await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, "02-ground-and-trees.png") });

  // Manual rescue rejects insufficient funds and charges exactly 150 through real E input.
  await fresh(0); const manualSweeper = await debug("build", "sweeper", 12, 12);
  await debug("freezeRobot", manualSweeper); const frozenManual = (await debug("robotStates")).find((r) => r.id === manualSweeper);
  await debug("teleport", frozenManual.x, frozenManual.z); await page.keyboard.press("KeyE"); await page.waitForTimeout(180);
  assert((await snap()).credits === 0 && (await debug("robotStates")).find((r) => r.id === manualSweeper).frozen, "manual rescue with zero credits neither starts nor charges");
  await setCredits(149); await page.keyboard.press("KeyE"); await page.waitForTimeout(180);
  assert((await snap()).credits === 149 && (await debug("robotStates")).find((r) => r.id === manualSweeper).frozen, "149 credits is still insufficient for manual rescue");
  await setCredits(150); await page.keyboard.press("KeyE"); await page.waitForTimeout(180);
  assert((await snap()).credits === 0 && (await debug("robotStates")).find((r) => r.id === manualSweeper).thaw >= 0, "real E interaction starts paid manual rescue and deducts exactly 150");
  await debug("step", 3.2);
  assert(!(await debug("robotStates")).find((r) => r.id === manualSweeper).frozen, "paid three-second manual warming completes");

  // Autonomous rescue cannot bypass the 75-credit requirement.
  await fresh(74); const paidSweeper = await debug("build", "sweeper", 12, 12); await debug("build", "hauler", -12, 12);
  await debug("freezeRobot", paidSweeper); await debug("step", 20);
  assert((await snap()).credits === 74 && (await debug("robotStates")).find((r) => r.id === paidSweeper).frozen, "autonomous rescue leaves the target frozen when only 74 credits are available");
  await setCredits(75);
  const autonomous = await page.evaluate(({ paidSweeper }) => {
    const d = window.__whiteoutDebug; let assisted = false;
    for (let i = 0; i < 360; i++) {
      d.step(0.25); const hauler = d.robotStates().find((r) => r.kind === "hauler");
      if (["rescue", "rescue-return"].includes(hauler.mode)) assisted = true;
      if (!d.robotStates().find((r) => r.id === paidSweeper).frozen) return { assisted, rescued: true, credits: d.snapshot().credits };
    }
    return { assisted, rescued: false, credits: d.snapshot().credits };
  }, { paidSweeper });
  assert(autonomous.assisted && autonomous.rescued && autonomous.credits === 0, `autonomous robot rescue charges exactly 75 once funding becomes available (${JSON.stringify(autonomous)})`);

  // A rescue unit can freeze and another rescue unit can paid-thaw it.
  await fresh(0); const coldHauler = await debug("build", "hauler", 30, 30); await debug("step", 232);
  assert((await debug("robotStates")).find((r) => r.id === coldHauler).frozen, "search-and-rescue robot has real cold endurance and can freeze outdoors");
  await fresh(75); const rescuedHauler = await debug("build", "hauler", 12, 12); const secondHauler = await debug("build", "hauler", -12, 12);
  await debug("freezeRobot", rescuedHauler); await debug("step", 70);
  assert(!(await debug("robotStates")).find((r) => r.id === rescuedHauler).frozen && (await snap()).credits === 0 && (await debug("robotStates")).some((r) => r.id === secondHauler), "one rescue robot performs rescue-on-rescue for exactly 75 credits");

  // Independent repair permission is a real UI control and survives its immediate save.
  await fresh(2000); const repairHauler = await debug("build", "hauler", -12, 12); const damagedPurifier = await debug("build", "purifier", 3, -2);
  await page.click("#robots-btn"); const repairToggle = page.locator(`[data-repair-allowed="${repairHauler}:0"]`);
  assert(await repairToggle.isChecked() && (await page.locator(".rescue-costs").innerText()).includes("150") && (await page.locator(".rescue-costs").innerText()).includes("75"), "robot panel exposes independent repair permission and both rescue prices");
  await repairToggle.uncheck(); await page.click("#close-robots-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn"); await debug("damageBuilding", damagedPurifier);
  const disabledCredits = (await snap()).credits; await debug("step", 25);
  assert((await snap()).buildings.find((b) => b.id === damagedPurifier).damaged && (await snap()).credits === disabledCredits, "repair-disabled rescue robot never repairs or charges for the damaged building");
  await page.click("#robots-btn"); assert(!(await page.locator(`[data-repair-allowed="${repairHauler}:0"]`).isChecked()), "repair permission remains off when the live robot panel reopens");
  await page.locator(`[data-repair-allowed="${repairHauler}:0"]`).check(); await page.click("#close-robots-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  const repairCost = (await snap()).buildings.find((b) => b.id === damagedPurifier).repairCost; const enabledCredits = (await snap()).credits;
  const enabledRepair = await page.evaluate(({ damagedPurifier }) => {
    const d = window.__whiteoutDebug; let welded = false; const samples = [];
    for (let i = 0; i < 360; i++) {
      d.step(0.25); const r = d.robotStates().find((it) => it.kind === "hauler");
      if (i % 40 === 0) samples.push({ i, x: r.x, z: r.z, mode: r.mode, energy: r.energy, progress: r.rescueProgress });
      if (["repair", "repair-return"].includes(r.mode)) welded = true;
      if (!d.snapshot().buildings.find((b) => b.id === damagedPurifier).damaged) return { welded, repaired: true, credits: d.snapshot().credits, samples };
    }
    return { welded, repaired: false, credits: d.snapshot().credits, samples };
  }, { damagedPurifier });
  assert(enabledRepair.welded && enabledRepair.repaired && enabledRepair.credits === enabledCredits - repairCost, `repair-enabled robot welds and deducts the exact building-specific cost (${JSON.stringify({ ...enabledRepair, enabledCredits, repairCost, robots: await debug("robotStates") })})`);
  await debug("setRepairAllowed", repairHauler, 0, false); await debug("save");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => window.__GAME_READY__ && !!window.__whiteoutDebug, null, { timeout: 90000 }); await page.click("#continue-btn");
  assert((await debug("robotStates")).find((r) => r.id === repairHauler).repairAllowed === false, "schema-9 restoration preserves each rescue robot's independent repair permission");
  await page.click("#robots-btn"); await page.screenshot({ path: join(SHOTS, "03-rescue-permission.png") }); await page.click("#close-robots-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");

  // Structural repair restores durability but never grants a free thaw.
  await fresh(500); const structuralSweeper = await debug("build", "sweeper", 12, 12); await debug("freezeRobot", structuralSweeper); await debug("damageBuilding", structuralSweeper);
  const structuralCost = (await snap()).buildings.find((b) => b.id === structuralSweeper).repairCost; const structuralCredits = (await snap()).credits;
  assert(await debug("repairBuilding", structuralSweeper), "damaged robot dock accepts paid structural repair");
  const structuralRobot = (await debug("robotStates")).find((r) => r.id === structuralSweeper);
  assert(structuralRobot.health === 100 && structuralRobot.frozen && structuralRobot.temperature === 0 && (await snap()).credits === structuralCredits - structuralCost, "structural repair restores health but preserves frozen state and separate thaw economics");

  assert(errors.length === 0, `zero browser console, page and asset errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log("REVISION VERIFY OK: tools, grounding, paid rescue, repair permission and freezing");
} finally { await browser.close(); server.close(); }
