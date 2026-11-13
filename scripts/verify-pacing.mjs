// Reproducible legitimate-play pacing model: no debug commands, idle waiting or free resources.
// The snow grid and every rate below mirror the current game. Robot cleanup runs in parallel
// with late quests, but includes travel, dock congestion, sparse patches and zone reassignment.
const resolution = 160, size = 140.4;
let seed = 741203;
const random = () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
let initialDensity = 0;
for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
  const wx = (x + 0.5) / resolution * size - size / 2;
  const wz = size / 2 - (y + 0.5) / resolution * size;
  const wave = Math.sin(wx * 0.29 + wz * 0.19) * 0.09 + Math.cos(wz * 0.43 - wx * 0.12) * 0.06;
  let d = 0.72 + wave + random() * 0.18;
  const baseDistance = Math.hypot(wx, wz - 10);
  if (baseDistance < 8) d *= Math.max(0, Math.min(1, (baseDistance - 3.5) / 4.5)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, (baseDistance - 3.5) / 4.5)));
  initialDensity += d;
}

const robotLevel = 3, robotCount = 3;
const robotYield = 0.58;
const robotCapacity = 20 + robotLevel * 6;
const robotClearRate = 7.2 + robotLevel * 2.6;
const robotSpeed = 5.4 + robotLevel * 0.85;
const contactEfficiency = 0.62; // steering and incomplete contact with small contiguous patches.
const averageRoundTrip = 14; // metres inside a compact player-assigned work zone.
const retargetSeconds = 1.1;
// One-way capsules remove empty return trips. A conservative 24 m raw route is
// dispatch-limited to 40 raw/s; three level-three purifiers accept 11.34 raw/s,
// both above the effective fleet rate below. Optional relay bonuses are excluded.
const averageCapsuleRoute = 24;
const rawCapsuleCapacity = 30, rawCapsuleSpeed = 13, capsuleDispatch = 0.75;
const rawRouteThroughput = Math.min(rawCapsuleCapacity / capsuleDispatch, 4 * rawCapsuleCapacity / (averageCapsuleRoute / rawCapsuleSpeed + 0.35));
const purifierRawThroughput = 1.35 * (1 + (3 - 1) * 0.9);
const productionLines = 3;
const logisticsUptime = 0.68; // shared dock capacity, player emptying and imperfect routing.
const sparsePatchPenalty = 1.35; // late-game fragments need more travel per unit removed.
const zoneReassignmentSeconds = 10 * 60; // paid dock moves, zone assignments and rail adjustments.

const gatherSeconds = robotCapacity / (robotClearRate * robotYield * contactEfficiency);
const roundTripSeconds = averageRoundTrip / robotSpeed;
const secondsPerRobotCycle = gatherSeconds + roundTripSeconds + retargetSeconds;
const rawPerRobotSecond = robotCapacity / secondsPerRobotCycle;
const fleetRawPerSecond = rawPerRobotSecond * robotCount * logisticsUptime;
const rawForFullMap = initialDensity * robotYield;
const robotCleanupSeconds = rawForFullMap * 0.98 / fleetRawPerSecond * sparsePatchPenalty + zoneReassignmentSeconds;

const walkingSpeed = 5.6 * 1.36;
const sprintingSpeed = walkingSpeed * 1.62;
const mixedTravelSpeed = 1 / (0.45 / walkingSpeed + 0.55 / sprintingSpeed);
const travelSeconds = 5600 / (mixedTravelSpeed * 0.92);
const openingSeconds = 8 * 60;
const productionSeconds = 7 * 60;
const robotAndRailSetupSeconds = 8 * 60;
const parallelLateWorkSeconds = travelSeconds + 5 * 60 + 4 * 60 + 3 * 60; // clues, final heaters/power, storms and rescue.

// Before the robot unlock, work is sequential. Afterwards, the slower of automated cleanup
// and the player's remaining route work determines completion; the two are not added twice.
const fastestSeconds = openingSeconds + productionSeconds + robotAndRailSetupSeconds + Math.max(robotCleanupSeconds, parallelLateWorkSeconds);
const typicalSeconds = fastestSeconds * 1.45; // imperfect zones, selling trips, repairs and less optimal routing.
const fastestMinutes = fastestSeconds / 60, typicalMinutes = typicalSeconds / 60;

console.log("PACING MODEL (legitimate robot-assisted completion route)");
console.log(`Initial snow density: ${initialDensity.toFixed(1)}; level-three fleet: ${robotCount} robots`);
console.log(`Robot cycle: gather ${gatherSeconds.toFixed(1)}s + round trip ${roundTripSeconds.toFixed(1)}s + retarget ${retargetSeconds.toFixed(1)}s`);
console.log(`Effective fleet rate after dock/logistics downtime: ${fleetRawPerSecond.toFixed(2)} raw/s`);
console.log(`One-way raw capsule route capacity: ${rawRouteThroughput.toFixed(2)} raw/s; ${productionLines} upgraded purifiers: ${(purifierRawThroughput * productionLines).toFixed(2)} raw/s`);
if (rawRouteThroughput < fleetRawPerSecond || purifierRawThroughput * productionLines < fleetRawPerSecond) throw new Error("Production or one-way capsule throughput bottlenecks the reviewed completion route");
console.log(`Automated 98% cleanup including sparse patches and zone moves: ${(robotCleanupSeconds / 60).toFixed(1)} min`);
console.log(`Late player work performed in parallel: ${(parallelLateWorkSeconds / 60).toFixed(1)} min`);
console.log(`Estimated fastest complete run: ${fastestMinutes.toFixed(1)} min`);
console.log(`Estimated typical first successful run: ${typicalMinutes.toFixed(1)} min`);
if (fastestMinutes < 55 || fastestMinutes > 80) throw new Error("Robot-assisted fastest pacing left the reviewed 55–80 minute band");
if (typicalMinutes < 80 || typicalMinutes > 110) throw new Error("Typical completion pacing left the reviewed 80–110 minute band");
console.log("PACING VERIFY OK");
