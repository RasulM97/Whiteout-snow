import { chromium } from "playwright";
import { existsSync } from "node:fs";

const origin = process.env.RAIL_ORIGIN || "http://127.0.0.1:3020/";
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
const boot = () => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
};

async function openPage(viewport, hasTouch = false) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(boot);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  return page;
}

async function sample(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const stamps = [];
    const tick = (now) => {
      stamps.push(now);
      if (stamps.length < 90) requestAnimationFrame(tick);
      else {
        const dts = stamps.slice(1).map((value, index) => value - stamps[index]);
        dts.sort((a, b) => a - b);
        const at = (q) => dts[Math.min(dts.length - 1, Math.floor(q * (dts.length - 1)))];
        const stats = window.__whiteoutDebug.stats();
        resolve({
          avg: dts.reduce((sum, value) => sum + value, 0) / dts.length,
          p95: at(0.95), p99: at(0.99), frames: dts.length,
          calls: stats.calls, triangles: stats.triangles, fps: stats.fps,
        });
      }
    };
    requestAnimationFrame(tick);
  }));
}

const page = await openPage({ width: 1280, height: 720 });
await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 12);
  const a = d.build("sweeper", -8, 18); const b = d.build("sweeper", 8, 18);
  const purifier = d.build("purifier", 0, 8); const press = d.build("press", 14, 4);
  d.buyRail(a, purifier); d.buyRail(b, purifier); d.buyRail(purifier, press); d.buyRail(purifier, 0); d.buyRail(press, 0);
  d.setOutput(a, 40); d.setOutput(b, 40); d.step(1);
});
const perfLegacy = await sample(page);

await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 12);
  const a = d.build("sweeper", -8, 18); const b = d.build("sweeper", 8, 18);
  const purifier = d.build("purifier", 0, 8); const press = d.build("press", 14, 4);
  const merge = d.netPlace("merge", 0, 14);
  const split = d.netPlace("split", 7, 8);
  d.netLink({ buildingId: a, port: "out" }, { nodeId: merge });
  d.netLink({ buildingId: b, port: "out" }, { nodeId: merge });
  d.netLink({ nodeId: merge }, { buildingId: purifier, port: "in" });
  d.netLink({ buildingId: purifier, port: "out" }, { nodeId: split });
  d.netLink({ nodeId: split }, { buildingId: press, port: "in" });
  d.netLink({ nodeId: split }, { buildingId: 0, port: "in" });
  d.netLink({ buildingId: press, port: "out" }, { buildingId: 0, port: "in" });
  d.setOutput(a, 40); d.setOutput(b, 40); d.step(1);
});
const perfNetwork = await sample(page);
const perfVisual = await page.evaluate(() => window.__whiteoutDebug.netVisual());

const report = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const near = (value, expected, slack = 0.05) => Math.abs(value - expected) <= slack;

  d.start(); d.setQuest(8); d.giveCredits(4000);
  const legacySource = d.build("sweeper", 4, 16);
  const legacyDest = d.build("purifier", 14, 16);
  const legacyBuy = d.buyRail(legacySource, legacyDest);
  const legacy = d.railState()[0];
  check(!!legacyBuy && d.railState().length === 1 && legacy.path.length === 2 && legacy.total >= 8 && legacy.total <= 12, `legacy direct rail ${legacy?.path.length} ${legacy?.total}`);

  d.start(); d.setQuest(8); d.giveCredits(5);
  const poorSource = d.build("sweeper", 0, 12);
  const poorDest = d.build("purifier", 10, 12);
  const poor = d.netLink({ buildingId: poorSource, port: "out" }, { buildingId: poorDest, port: "in" });
  check(!poor.ok && poor.reason === "credits" && d.snapshot().credits === 5 && d.netState().edges.length === 0, `unpaid link must not build track ${JSON.stringify(poor)} credits ${d.snapshot().credits}`);

  d.start(); d.setQuest(8); d.giveCredits(40000); d.step(0.2);
  const left = d.build("sweeper", -10, 16);
  const right = d.build("sweeper", -10, 8);
  const purifier = d.build("purifier", 12, 12);
  const merge = d.netPlace("merge", 0, 12);
  const branchA = d.netLink({ buildingId: left, port: "out" }, { nodeId: merge });
  const branchB = d.netLink({ buildingId: right, port: "out" }, { nodeId: merge });
  const trunk = d.netLink({ nodeId: merge }, { buildingId: purifier, port: "in" });
  const creditsBeforeReuse = d.snapshot().credits;
  const reuse = d.netLink({ nodeId: merge }, { buildingId: purifier, port: "in" });
  check(branchA.ok && branchB.ok && trunk.ok && trunk.cost > 0, `merge links ${JSON.stringify({ branchA, branchB, trunk })}`);
  check(reuse.ok && reuse.reason === "reuse" && reuse.cost === 0 && d.snapshot().credits === creditsBeforeReuse, `reusing a trunk does not charge again ${JSON.stringify(reuse)}`);
  const trunkEdge = d.netState().edges.find((edge) => edge.id === trunk.edgeId);
  check(trunkEdge && trunkEdge.role === "trunk" && d.netState().edges.filter((edge) => edge.from === merge).length === 1, "both sources share one trunk edge");
  d.setOutput(left, 30); d.setOutput(right, 30);
  let arrival = null;
  const origins = new Set();
  for (let frame = 0; frame < 700; frame++) {
    d.step(1 / 60);
    const state = d.netState();
    const incoming = state.edges.filter((edge) => edge.to === merge).map((edge) => edge.id);
    for (const capsule of state.capsules) if (capsule.edgeId === trunk.edgeId) origins.add(capsule.origin);
    const just = state.capsules.filter((capsule) => capsule.edgeId === trunk.edgeId && capsule.distance < 0.4);
    const waiting = state.capsules.filter((capsule) => incoming.includes(capsule.edgeId) && capsule.hold);
    if (!arrival && just.length === 1 && waiting.length >= 1) {
      d.step(1 / 60);
      const next = d.netState();
      const still = next.capsules.filter((capsule) => incoming.includes(capsule.edgeId) && capsule.hold).length;
      arrival = { just: just.length, waiting: waiting.length, still };
    }
  }
  check(origins.has(left) && origins.has(right), `both sweepers use the trunk ${[...origins].join(",")}`);
  check(!!arrival && arrival.still >= 1, `one capsule waits while the other enters ${JSON.stringify(arrival)}`);

  d.setInput(purifier, d.snapshot().buildings.find((building) => building.id === purifier).inputCapacity);
  d.setOutput(left, 60); d.setOutput(right, 60);
  let spaced = null;
  for (let frame = 0; frame < 500; frame++) {
    d.step(1 / 60);
    const riding = d.netState().capsules.filter((capsule) => capsule.edgeId === trunk.edgeId).sort((a, b) => b.distance - a.distance);
    if (riding.length >= 2 && riding[0].hold && riding[0].distance - riding[1].distance >= 2.7) { spaced = { gap: riding[0].distance - riding[1].distance, cargo: riding[0].cargo }; break; }
  }
  check(!!spaced, `blocked buffer keeps a gap ${JSON.stringify(spaced)}`);
  const occupiedCredits = d.snapshot().credits;
  const occupiedTotal = d.netState().edges.find((edge) => edge.id === trunk.edgeId).total;
  const occupiedCargo = d.netState().cargo;
  const occupied = d.netReshape(trunk.edgeId, [{ x: 0, z: 12 }, { x: 6, z: 20 }, { x: 12, z: 12 }]);
  check(!occupied.ok && occupied.reason === "occupied" && d.snapshot().credits === occupiedCredits && d.netState().edges.find((edge) => edge.id === trunk.edgeId).total === occupiedTotal && near(d.netState().cargo, occupiedCargo), `occupied edit changes nothing ${JSON.stringify(occupied)}`);

  const third = d.build("sweeper", 0, 20);
  const degree = d.netLink({ buildingId: third, port: "out" }, { nodeId: merge });
  check(!degree.ok && degree.reason === "degree", `third merge input rejected ${degree.reason}`);
  const rawPress = d.build("press", 20, 16);
  const rawSource = d.build("sweeper", -18, 16);
  const cargo = d.netLink({ buildingId: rawSource, port: "out" }, { buildingId: rawPress, port: "in" });
  check(!cargo.ok && cargo.reason === "cargo", `raw cannot enter a press ${cargo.reason}`);
  const missing = d.netLink({ nodeId: 999 }, { buildingId: purifier, port: "in" });
  check(!missing.ok && missing.reason === "missing", `missing node rejected ${missing.reason}`);

  d.start(); d.setQuest(8); d.giveCredits(40000); d.step(0.2);
  const sourceA = d.build("sweeper", -8, 16);
  const sourceB = d.build("sweeper", -8, 8);
  const sourceC = d.build("sweeper", -18, 12);
  const sink = d.build("purifier", 10, 12);
  const firstMerge = d.netPlace("merge", -2, 12);
  const secondMerge = d.netPlace("merge", 3, 12);
  const three = [
    d.netLink({ buildingId: sourceA, port: "out" }, { nodeId: firstMerge }),
    d.netLink({ buildingId: sourceB, port: "out" }, { nodeId: firstMerge }),
    d.netLink({ nodeId: firstMerge }, { nodeId: secondMerge }),
    d.netLink({ buildingId: sourceC, port: "out" }, { nodeId: secondMerge }),
    d.netLink({ nodeId: secondMerge }, { buildingId: sink, port: "in" }),
  ];
  check(three.every((link) => link.ok), `three-source chain ${three.map((link) => link.reason).join(",")}`);
  const shared = d.netState().edges.find((edge) => edge.from === secondMerge);
  check(!!shared && d.netState().edges.filter((edge) => edge.from === secondMerge).length === 1, "three routes share one outgoing trunk");
  if (shared) {
    d.setOutput(sourceA, 40); d.setOutput(sourceB, 40); d.setOutput(sourceC, 40);
    const seen = new Set();
    for (let frame = 0; frame < 500; frame++) {
      d.step(1 / 60);
      for (const capsule of d.netState().capsules) if (capsule.edgeId === shared.id) seen.add(capsule.origin);
    }
    check(seen.has(sourceA) && seen.has(sourceB) && seen.has(sourceC), `three origins reached the shared trunk ${[...seen].join(",")}`);
  }

  d.start(); d.setQuest(8); d.giveCredits(40000); d.step(0.2);
  const maker = d.build("purifier", 0, 14);
  const press = d.build("press", 16, 14);
  d.build("generator", 22, 10);
  const split = d.netPlace("split", 8, 14);
  const feed = d.netLink({ buildingId: maker, port: "out" }, { nodeId: split });
  const toPress = d.netLink({ nodeId: split }, { buildingId: press, port: "in" });
  const toDepot = d.netLink({ nodeId: split }, { buildingId: 0, port: "in" });
  check(feed.ok && toPress.ok && toDepot.ok, `split links ${feed.reason},${toPress.reason},${toDepot.reason}`);
  check(d.netPolicy(split, "ratio", 70), "ratio policy applies to a split");
  const loop = d.netLink({ nodeId: split }, { nodeId: split });
  check(!loop.ok, `split cannot loop ${loop.reason}`);
  const decisions = [];
  for (const amount of [10, 25, 8, 20, 14, 22, 6, 18]) {
    const before = d.netState().junctions.find((item) => item.id === split);
    const total = before.sentA + before.sentB;
    const expectFirst = total <= 0.001 ? true : before.sentA / total <= 0.7;
    d.setOutput(maker, amount);
    let drained = 0;
    for (let frame = 0; frame < 90; frame++) {
      d.step(1 / 60);
      const output = d.snapshot().buildings.find((building) => building.id === maker).output;
      if (output < amount - 0.01) { drained = amount - output; break; }
    }
    d.setOutput(maker, 0);
    let moved = null;
    for (let frame = 0; frame < 240; frame++) {
      d.step(1 / 60);
      const now = d.netState().junctions.find((item) => item.id === split);
      if (Math.abs(now.sentA - before.sentA) > 0.01 || Math.abs(now.sentB - before.sentB) > 0.01) {
        moved = { dA: now.sentA - before.sentA, dB: now.sentB - before.sentB };
        break;
      }
    }
    decisions.push({ amount, drained, expectFirst, moved });
  }
  check(decisions.every((item) => item.moved && item.drained > 0 && (item.expectFirst ? near(item.moved.dA, item.drained) && item.moved.dB < 0.01 : near(item.moved.dB, item.drained) && item.moved.dA < 0.01)), `ratio follows quantity ${JSON.stringify(decisions)}`);

  d.setInput(press, d.snapshot().buildings.find((building) => building.id === press).inputCapacity);
  d.netPolicy(split, "priority");
  const priorityBefore = d.netState().junctions.find((item) => item.id === split);
  d.setOutput(maker, 16);
  let fallback = null;
  for (let frame = 0; frame < 300; frame++) {
    d.step(1 / 60);
    const now = d.netState().junctions.find((item) => item.id === split);
    if (now.sentA > priorityBefore.sentA + 0.01 || now.sentB > priorityBefore.sentB + 0.01) { fallback = { dA: now.sentA - priorityBefore.sentA, dB: now.sentB - priorityBefore.sentB }; break; }
  }
  check(fallback && fallback.dA < 0.01 && fallback.dB > 0, `priority falls back when the preferred buffer is full ${JSON.stringify(fallback)}`);
  d.setInput(press, 0); d.setOutput(maker, 0); d.step(2); d.setOutput(maker, 12);
  const preferredBefore = d.netState().junctions.find((item) => item.id === split);
  let preferred = null;
  for (let frame = 0; frame < 300; frame++) {
    d.step(1 / 60);
    const now = d.netState().junctions.find((item) => item.id === split);
    if (now.sentA > preferredBefore.sentA + 0.01 || now.sentB > preferredBefore.sentB + 0.01) { preferred = { dA: now.sentA - preferredBefore.sentA, dB: now.sentB - preferredBefore.sentB }; break; }
  }
  check(preferred && preferred.dB < 0.01 && preferred.dA > 0, `priority returns to the preferred output ${JSON.stringify(preferred)}`);

  d.start(); d.setQuest(8); d.giveCredits(20000);
  const editSource = d.build("sweeper", 0, 12);
  const editDest = d.build("purifier", 12, 12);
  const edit = d.netLink({ buildingId: editSource, port: "out" }, { buildingId: editDest, port: "in" });
  const beforeLong = d.snapshot().credits;
  const longer = d.netReshape(edit.edgeId, [{ x: 0, z: 12 }, { x: 6, z: 28 }, { x: 12, z: 12 }]);
  check(longer.ok && longer.cost > 0 && d.snapshot().credits === beforeLong - longer.cost, `longer edit charges only the increase ${JSON.stringify(longer)}`);
  const beforeShort = d.snapshot().credits;
  const shorter = d.netReshape(edit.edgeId, [{ x: 1, z: 12 }, { x: 11, z: 12 }]);
  check(shorter.ok && shorter.cost === 0 && d.snapshot().credits === beforeShort, "a shorter edit does not refund");
  d.start(); d.setQuest(8); d.giveCredits(20000); d.step(0.2);
  const cycleSource = d.build("sweeper", 0, 12);
  const cycleA = d.netPlace("merge", 6, 12);
  const cycleB = d.netPlace("merge", 12, 12);
  const cycleIn = d.netLink({ buildingId: cycleSource, port: "out" }, { nodeId: cycleA });
  const cycleOut = d.netLink({ nodeId: cycleA }, { nodeId: cycleB });
  const cycleBack = d.netLink({ nodeId: cycleB }, { nodeId: cycleA });
  check(cycleIn.ok && cycleOut.ok && !cycleBack.ok && cycleBack.reason === "cycle", `cycle rejected ${cycleBack.reason}`);

  d.start(); d.setQuest(8); d.giveCredits(80000); d.teleport(0, 10); d.step(0.2);
  const sweeperA = d.build("sweeper", -16, 20);
  const sweeperB = d.build("sweeper", -16, 8);
  const plant = d.build("purifier", 4, 14);
  const ice = d.build("press", 22, 8);
  d.build("heater", 0, 18); d.build("heater", 8, 10); d.build("heater", -8, 14);
  const generator = d.build("generator", 16, 8);
  const demoMerge = d.netPlace("merge", -6, 14);
  const demoSplit = d.netPlace("split", 14, 14);
  const creditsBefore = d.snapshot().credits;
  const demo = [
    d.netLink({ buildingId: sweeperA, port: "out" }, { nodeId: demoMerge }),
    d.netLink({ buildingId: sweeperB, port: "out" }, { nodeId: demoMerge }),
    d.netLink({ nodeId: demoMerge }, { buildingId: plant, port: "in" }),
    d.netLink({ buildingId: plant, port: "out" }, { nodeId: demoSplit }),
    d.netLink({ nodeId: demoSplit }, { buildingId: ice, port: "in" }),
    d.netLink({ nodeId: demoSplit }, { buildingId: 0, port: "in" }),
    d.netLink({ buildingId: ice, port: "out" }, { buildingId: 0, port: "in" }),
  ];
  d.netPolicy(demoSplit, "ratio", 70);
  const paid = d.netState().edges.reduce((sum, edge) => sum + edge.paid, 0);
  check(demo.every((link) => link.ok) && d.snapshot().credits === creditsBefore - paid, `demo cost matches credits ${demo.map((link) => link.reason).join(",")} paid ${paid}`);
  const visual = d.netVisual();
  check(visual.edges === 7 && visual.deckVisible && visual.glowVisible && visual.deckNormalUp && visual.deckVertices > 200 && visual.glowVertices > 300 && visual.supports > 0 && visual.pads > 0 && visual.sinkPads >= 4 && visual.arrows >= 7, `network guideway geometry is visible and faces up ${JSON.stringify(visual)}`);
  const view = d.netState().junctions.find((item) => item.id === demoSplit);
  check(view && view.destA === ice && view.destB === 0 && view.ratio === 70, `70 percent names the press first ${JSON.stringify(view)}`);
  d.step(0.3);
  const power = d.powerState().filter((item) => [sweeperA, sweeperB, plant, ice].includes(item.id));
  check(power.every((item) => item.powered), `demo machines powered ${JSON.stringify(power)}`);
  const salesBefore = d.snapshot();
  const remainderBefore = d.logistics().saleRemainder;
  d.setOutput(sweeperA, 80); d.setOutput(sweeperB, 80); d.setOutput(plant, 60);
  for (let frame = 0; frame < 600; frame++) d.step(1 / 60);
  const state = d.netState();
  check(near(state.account.dispatched, state.account.delivered + state.cargo, 0.2), `cargo conserved ${state.account.dispatched} delivered ${state.account.delivered} riding ${state.cargo}`);
  const salesAfter = d.snapshot();
  const earned = salesAfter.credits - salesBefore.credits;
  const recorded = salesAfter.sold - salesBefore.sold;
  check(near(earned, recorded), `credits follow sales ${earned} recorded ${recorded}`);
  d.save();
  const save = localStorage.getItem("whiteout.career-v2");
  const riding = state.cargo;
  const credits = salesAfter.credits;

  d.start(); d.setQuest(8); d.giveCredits(3000);
  const oldSource = d.build("sweeper", 2, 14);
  const oldDest = d.build("purifier", 12, 14);
  d.buyRail(oldSource, oldDest);
  d.setOutput(oldSource, 15);
  d.step(0.4);
  d.save();
  const oldSave = localStorage.getItem("whiteout.career-v2");

  return { failures, save, oldSave, riding, credits, arrival, spaced, decisions, fallback, preferred, power, demo: demo.map((link) => link.reason) };
});

if (report.failures.length) throw new Error(report.failures.join("\n"));

async function continueWith(save) {
  const next = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  next.setDefaultTimeout(60000);
  next.on("pageerror", (error) => errors.push(String(error)));
  await next.addInitScript((stored) => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    localStorage.setItem("whiteout.career-v2", stored);
  }, save);
  await next.goto(origin, { waitUntil: "domcontentloaded" });
  await next.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  return next.evaluate(() => { window.__whiteoutDebug.continue(); const d = window.__whiteoutDebug; return { cargo: d.netState().cargo, credits: d.snapshot().credits }; });
}

const resumed = await continueWith(report.save);
if (Math.abs(resumed.cargo - report.riding) > 0.2) throw new Error(`reload changed in-transit cargo ${resumed.cargo} vs ${report.riding}`);
if (resumed.credits !== report.credits) throw new Error(`reload changed credits ${resumed.credits} vs ${report.credits}`);

const oldData = JSON.parse(report.oldSave);
delete oldData.railNetwork;
const legacyPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
legacyPage.on("pageerror", (error) => errors.push(String(error)));
await legacyPage.addInitScript((stored) => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.setItem("whiteout.career-v2", stored);
}, JSON.stringify(oldData));
await legacyPage.goto(origin, { waitUntil: "domcontentloaded" });
await legacyPage.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
const legacyResumed = await legacyPage.evaluate(() => {
  const d = window.__whiteoutDebug; d.continue();
  return { rails: d.railState().length, edges: d.netState().edges.length, credits: d.snapshot().credits };
});
if (legacyResumed.rails !== 1 || legacyResumed.edges !== 0) throw new Error(`old save lost its rail ${JSON.stringify(legacyResumed)}`);

const bad = JSON.parse(report.save);
bad.railNetwork = {
  nodes: [{ id: 1, kind: "merge", x: 0, z: 0, buildingId: 0, policy: "auto", ratio: 70, priority: 0, order: [], sent: [0, 0], turn: 0 }],
  edges: [{ id: 4, from: 1, to: 99, role: "trunk", points: [{ x: 0, z: 0 }, { x: 4, z: 0 }], paid: 24, kind: "raw" }],
  capsules: [{ id: 7, edgeId: 4, distance: 1, cargo: 5, kind: "raw", wait: 0, hold: false, level: 1, origin: 1 }],
  account: { dispatched: 5, delivered: 0, sold: 0 }, nextNode: 2, nextEdge: 5, nextCap: 8,
};
const invalidPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
invalidPage.on("pageerror", (error) => errors.push(String(error)));
await invalidPage.addInitScript((stored) => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.setItem("whiteout.career-v2", stored);
}, JSON.stringify(bad));
await invalidPage.goto(origin, { waitUntil: "domcontentloaded" });
await invalidPage.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
const invalid = await invalidPage.evaluate(() => {
  const d = window.__whiteoutDebug; d.continue();
  return { edges: d.netState().edges.length, retained: d.logistics().retained.raw, buildings: d.snapshot().buildings.length };
});
if (invalid.edges !== 0 || invalid.retained < 5 || invalid.buildings < 4) throw new Error(`invalid graph was not safe ${JSON.stringify(invalid)}`);

const robots = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(80000); d.step(0.2);
  const spots = [[0, 16], [8, 14], [8, 6], [0, 4], [-8, 6], [-8, 14]];
  const ids = spots.map(([x, z]) => d.build("sweeper", x, z));
  for (const [x, z] of spots) { d.teleport(x, z); d.upgradeNearest(); d.upgradeNearest(); }
  for (const id of ids) { d.buyExtraRobot(id); d.buyExtraRobot(id); }
  const purifier = d.build("purifier", 14, 10);
  d.build("generator", 22, 10);
  const merge = d.netPlace("merge", 10, 12);
  const links = [
    d.netLink({ buildingId: ids[1], port: "out" }, { nodeId: merge }),
    d.netLink({ nodeId: merge }, { buildingId: purifier, port: "in" }),
  ];
  d.setOutput(ids[1], 40);
  d.step(3);
  return { robots: d.snapshot().robotCount, levels: d.snapshot().buildings.filter((building) => building.type === "sweeper").map((building) => building.level), dispatched: d.netState().account.dispatched, links: links.map((link) => link.ok) };
});
if (robots.robots !== 18 || robots.levels.some((level) => level !== 3) || robots.dispatched <= 0 || robots.links.some((ok) => !ok)) throw new Error(`18-robot base did not keep moving ${JSON.stringify(robots)}`);

const ui = await openPage({ width: 1280, height: 720 });
await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(8, 16); d.setAzimuth(0.4);
  d.build("sweeper", 4, 18); d.build("purifier", 14, 18); d.build("press", 14, 26);
  d.step(0.2); d.selectRail();
});
const drawBox = await ui.locator("#rail-draw").boundingBox();
if (!drawBox || drawBox.height < 36) throw new Error(`draw button is too small ${JSON.stringify(drawBox)}`);
if (await ui.locator("#rail-merge").count()) throw new Error("merge, split and shared buttons must be gone");
await ui.evaluate(() => { window.__whiteoutDebug.netPlace("merge", 8, 24); window.__whiteoutDebug.netPlace("split", 18, 22); });
const spot = await ui.evaluate(() => window.__whiteoutDebug.worldToScreen(8, 24));
if (spot.behind) throw new Error("junction spot is behind the camera");
await ui.mouse.click(spot.x, spot.y);
await ui.waitForFunction(() => !document.querySelector("#junction-panel").classList.contains("hidden"));
const panel = await ui.locator("#junction-copy").innerText();
if (!panel.includes("Merge")) throw new Error(`merge panel missing ${panel}`);
const splitSpot = await ui.evaluate(() => window.__whiteoutDebug.worldToScreen(18, 22));
await ui.mouse.click(splitSpot.x, splitSpot.y);
await ui.waitForFunction(() => document.querySelector("#junction-copy").textContent.includes("Split"));
await ui.click("#junction-ratio");
await ui.locator("#junction-ratio-slider").fill("50");
const ratio = await ui.evaluate(() => window.__whiteoutDebug.netState().junctions.find((item) => item.kind === "split"));
if (!ratio || ratio.policy !== "ratio" || ratio.ratio !== 50) throw new Error(`slider did not set 50/50 ${JSON.stringify(ratio)}`);
await ui.click("#junction-priority");
const priority = await ui.evaluate(() => window.__whiteoutDebug.netState().junctions.find((item) => item.kind === "split").policy);
if (priority !== "priority") throw new Error(`priority button failed ${priority}`);
const overlap = await ui.evaluate(() => {
  const box = (id) => { const node = document.getElementById(id); if (!node || node.classList.contains("hidden")) return null; const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
  return { net: box("rail-net"), hint: box("build-hint"), dock: box("build-dock"), panel: box("junction-panel") };
});
const hits = (a, b) => a && b && a.top < b.bottom && b.top < a.bottom;
if (hits(overlap.panel, overlap.hint) || hits(overlap.panel, overlap.dock) || hits(overlap.net, overlap.dock) || hits(overlap.panel, overlap.net)) throw new Error(`network HUD overlaps ${JSON.stringify(overlap)}`);
await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10); d.setAzimuth(Math.PI);
  d.build("sweeper", 4, 18); d.build("purifier", 9, 18); d.step(0.2); d.selectRail();
});
await ui.click("#rail-draw");
const ends = await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  const buildings = d.snapshot().buildings;
  return { source: d.worldToScreen(buildings.find((building) => building.type === "sweeper").x, buildings.find((building) => building.type === "sweeper").z), dest: d.worldToScreen(buildings.find((building) => building.type === "purifier").x, buildings.find((building) => building.type === "purifier").z) };
});
const creditsBeforeCancel = await ui.evaluate(() => window.__whiteoutDebug.snapshot().credits);
const poke = async (target) => { await ui.mouse.click(target.x, target.y); };
await poke(ends.source);
await ui.waitForTimeout(600);
const hit = await ui.evaluate((point) => { const node = document.elementFromPoint(point.x, point.y); return { tag: node?.id || node?.className || node?.tagName, source: window.__whiteoutDebug.snapshot().railSource }; }, ends.source);
if (!hit.tag) throw new Error(`source click missed ${JSON.stringify({ hit, ends })}`);
await ui.evaluate(() => window.__whiteoutDebug.teleport(9, 14));
await ui.waitForTimeout(300);
const destNow = await ui.evaluate(() => window.__whiteoutDebug.worldToScreen(9, 18));
await ui.mouse.click(destNow.x, destNow.y);
await ui.waitForTimeout(600);
const draftState = await ui.evaluate(() => { const snap = window.__whiteoutDebug.snapshot(); return { editor: snap.railEditor, source: snap.railSource, toast: document.getElementById("toast")?.textContent, buildings: snap.buildings.map((building) => ({ id: building.id, type: building.type, x: building.x, z: building.z })) }; });
if (!draftState.editor) throw new Error(`shared preview did not open ${JSON.stringify({ draftState, destNow })}`);
await ui.click("#rail-cancel");
const afterCancel = await ui.evaluate(() => ({ credits: window.__whiteoutDebug.snapshot().credits, edges: window.__whiteoutDebug.netState().edges.length, editor: window.__whiteoutDebug.snapshot().railEditor }));
if (afterCancel.credits !== creditsBeforeCancel || afterCancel.edges !== 0 || afterCancel.editor) throw new Error(`cancel built or charged ${JSON.stringify(afterCancel)}`);
await ui.evaluate(() => { window.__whiteoutDebug.teleport(0, 10); window.__whiteoutDebug.setAzimuth(Math.PI); });
await ui.waitForTimeout(300);
const sourceAgain = await ui.evaluate(() => window.__whiteoutDebug.worldToScreen(4, 18));
await ui.click("#rail-draw");
await ui.mouse.click(sourceAgain.x, sourceAgain.y);
await ui.waitForTimeout(300);
await ui.evaluate(() => window.__whiteoutDebug.teleport(9, 14));
await ui.waitForTimeout(300);
const destAgain = await ui.evaluate(() => window.__whiteoutDebug.worldToScreen(9, 18));
await ui.mouse.click(destAgain.x, destAgain.y);
await ui.waitForFunction(() => window.__whiteoutDebug.snapshot().railEditor, null, { timeout: 4000 });
const confirmBox = await ui.evaluate(() => {
  const editor = document.getElementById("rail-editor");
  const button = document.getElementById("rail-confirm");
  const rect = editor.getBoundingClientRect();
  const snap = window.__whiteoutDebug.snapshot();
  const before = { display: getComputedStyle(editor).display, top: rect.top, height: rect.height, disabled: button.disabled, state: snap.state, valid: snap.railEditor?.valid ?? null };
  button.click();
  return before;
});
if (confirmBox.display === "none" || confirmBox.height < 40 || confirmBox.disabled || confirmBox.valid === false) throw new Error(`confirm is not usable ${JSON.stringify(confirmBox)}`);
const confirmed = await ui.evaluate(() => ({ credits: window.__whiteoutDebug.snapshot().credits, edges: window.__whiteoutDebug.netState().edges.length }));
if (confirmed.edges !== 1 || confirmed.credits >= creditsBeforeCancel) throw new Error(`confirm did not buy the shared route ${JSON.stringify(confirmed)}`);
await ui.evaluate(() => document.getElementById("rail-confirm").click());
const again = await ui.evaluate(() => window.__whiteoutDebug.snapshot().credits);
if (again !== confirmed.credits) throw new Error("a second confirm changed credits");

await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10); d.setAzimuth(Math.PI);
  d.build("sweeper", 4, 18); d.build("purifier", 9, 18); d.step(0.2); d.selectRail();
});
await ui.waitForTimeout(700);
const plainSource = await ui.evaluate(() => { const b = window.__whiteoutDebug.snapshot().buildings.find((item) => item.type === "sweeper"); return window.__whiteoutDebug.worldToScreen(b.x, b.z); });
await ui.mouse.click(plainSource.x, plainSource.y);
await ui.waitForTimeout(250);
const plainDest = await ui.evaluate(() => { const b = window.__whiteoutDebug.snapshot().buildings.find((item) => item.type === "purifier"); return window.__whiteoutDebug.worldToScreen(b.x, b.z); });
await ui.mouse.click(plainDest.x, plainDest.y);
await ui.waitForFunction(() => window.__whiteoutDebug.snapshot().railEditor, null, { timeout: 4000 });
const defaultDraft = await ui.evaluate(() => ({ network: window.__whiteoutDebug.snapshot().railEditor.network, rails: window.__whiteoutDebug.railState().length }));
if (!defaultDraft.network || defaultDraft.rails !== 0) throw new Error(`default draw must open a network draft ${JSON.stringify(defaultDraft)}`);
await ui.evaluate(() => document.getElementById("rail-confirm").click());
const defaultBuilt = await ui.evaluate(() => ({ edges: window.__whiteoutDebug.netState().edges.length, rails: window.__whiteoutDebug.railState().length, visual: window.__whiteoutDebug.netVisual() }));
if (defaultBuilt.edges !== 1 || defaultBuilt.rails !== 0 || !defaultBuilt.visual.deckVisible || !defaultBuilt.visual.deckNormalUp) throw new Error(`default draw must build a visible network edge ${JSON.stringify(defaultBuilt)}`);

await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10); d.setAzimuth(Math.PI);
  d.build("sweeper", 4, 18); d.build("purifier", 12, 18); d.step(0.2); d.selectRail();
});
await ui.waitForTimeout(700);
const drawnMerge = await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  const sweeper = d.snapshot().buildings.find((building) => building.type === "sweeper");
  const purifier = d.snapshot().buildings.find((building) => building.type === "purifier");
  const trunk = d.commitStroke([{ x: sweeper.x, z: sweeper.z }, { x: purifier.x, z: purifier.z }]);
  const branch = d.commitStroke([{ x: sweeper.x, z: sweeper.z + 6 }, { x: (sweeper.x + purifier.x) / 2, z: (sweeper.z + purifier.z) / 2 }]);
  return { trunk, branch, junctions: d.netState().junctions.map((item) => item.kind) };
});
if (!drawnMerge.trunk.ok) throw new Error(`drawn trunk failed ${JSON.stringify(drawnMerge)}`);

await ui.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10); d.setAzimuth(Math.PI);
  d.build("sweeper", 4, 18); d.step(0.2);
  window.__whiteoutDebug.netPlace("merge", 8, 18);
  d.selectRail();
});
await ui.waitForTimeout(300);
const snapDraft = await ui.evaluate(() => {
  const plan = window.__whiteoutDebug.previewStroke([{ x: 4, z: 18 }, { x: 8.6, z: 18 }]);
  const built = plan.ok ? window.__whiteoutDebug.commitStroke([{ x: 4, z: 18 }, { x: 8.6, z: 18 }]) : plan;
  return { plan, built, edges: window.__whiteoutDebug.netState().edges.length };
});
if (!snapDraft.plan.ok || snapDraft.edges !== 1) throw new Error(`a stroke toward a junction must connect ${JSON.stringify(snapDraft)}`);

const touch = await openPage({ width: 844, height: 390 }, true);
await touch.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10); d.setAzimuth(Math.PI);
  d.build("sweeper", 4, 18); d.build("purifier", 12, 26); d.step(0.2); d.selectRail();
});
const touchButtons = await touch.evaluate(() => ["rail-draw"].map((id) => { const node = document.getElementById(id); const rect = node.getBoundingClientRect(); return { id, height: rect.height, hidden: node.classList.contains("hidden") }; }));
if (touchButtons.some((button) => button.hidden || button.height < 36)) throw new Error(`touch buttons are not usable ${JSON.stringify(touchButtons)}`);
await touch.tap("#rail-draw");
const touchEnds = await touch.evaluate(() => {
  const d = window.__whiteoutDebug;
  const buildings = d.snapshot().buildings;
  return { source: d.worldToScreen(buildings.find((building) => building.type === "sweeper").x, buildings.find((building) => building.type === "sweeper").z), dest: d.worldToScreen(buildings.find((building) => building.type === "purifier").x, buildings.find((building) => building.type === "purifier").z) };
});
const point = async (type, target) => touch.evaluate(({ type, target }) => {
  document.querySelector("canvas").dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: target.x, clientY: target.y, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
}, { type, target });
await point("pointerdown", touchEnds.source); await point("pointerup", touchEnds.source);
await point("pointerdown", touchEnds.dest); await point("pointerup", touchEnds.dest);
await touch.waitForFunction(() => window.__whiteoutDebug.snapshot().railEditor, null, { timeout: 8000 });
await touch.evaluate(() => document.getElementById("rail-confirm").click());
await touch.waitForFunction(() => window.__whiteoutDebug.netState().edges.length === 1, null, { timeout: 8000 });

async function label(language) {
  const view = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  view.on("pageerror", (error) => errors.push(String(error)));
  await view.addInitScript((language) => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language, quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    localStorage.removeItem("whiteout.career-v2");
  }, language);
  await view.goto(origin, { waitUntil: "domcontentloaded" });
  await view.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  return view.evaluate(() => { const d = window.__whiteoutDebug; d.start(); d.setQuest(8); d.selectRail(); return document.querySelector("#rail-draw").textContent; });
}
const fa = await label("fa");
const zh = await label("zh");
if (fa !== "رسم ریل" || zh !== "绘制导轨") throw new Error(`translations missing ${fa} / ${zh}`);

if (errors.length) throw new Error(errors.join("\n"));
console.log(JSON.stringify({ perfLegacy, perfNetwork, perfVisual, robots, overlap, ui: { panel, ratio, confirmed }, touchButtons, fa, zh }, null, 2));
await browser.close();
