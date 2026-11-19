import * as THREE from "three";
import type { CargoKind } from "./types";
import { GAME } from "./config";
import { BUILDINGS } from "./types";
import { BuildingSystem } from "./buildings";
import { groundHeight } from "./snow";
import type { RailPathPoint } from "./rails";
import { disposeObject } from "./resources";
import { simplifyStroke } from "./rail-draw";

export type JunctionKind = "merge" | "split" | "cross";
export type NetPolicy = "auto" | "priority" | "ratio";
export type NetEnd = { buildingId: number; port: "out" | "in" } | { nodeId: number };
export interface NetResult { ok: boolean; reason: string; cost: number; edgeId: number; total: number }
export interface StrokeView {
  ok: boolean; reason: string; cost: number; total: number; points: RailPathPoint[];
  kind: CargoKind | null; junctions: string[]; sourceId: number; destinationId: number;
}

interface NetNode {
  id: number; kind: "out" | "in" | "merge" | "split" | "cross"; x: number; z: number; buildingId: number;
  policy: NetPolicy; ratio: number; priority: number; order: number[]; sent: [number, number];
  turn: number; blocked: boolean; cooldown: number;
}
interface NetEdge {
  id: number; from: number; to: number; role: "branch" | "trunk" | "segment";
  points: RailPathPoint[]; travel: RailPathPoint[]; lengths: number[]; total: number; paid: number; kind: CargoKind;
}
interface NetCap {
  id: number; edgeId: number; distance: number; cargo: number; kind: CargoKind; wait: number; hold: boolean; level: number; origin: number; group: THREE.Group;
}
export interface NetSave {
  nodes: Array<Omit<NetNode, "blocked" | "cooldown"> & { blocked?: boolean }>;
  edges: Array<Omit<NetEdge, "travel" | "lengths" | "total">>;
  capsules: Array<Omit<NetCap, "group">>;
  account: { dispatched: number; delivered: number; sold: number };
  nextNode: number; nextEdge: number; nextCap: number;
}

const SPACING = 2.8;

const DECK_HALF = 0.31;
const DECK_DROP = 0.17;
const GLOW_HALF = 0.13;
const GLOW_LIP = 0.24;
const GLOW_LIP_W = 0.06;
const SUPPORT_GEO = new THREE.CylinderGeometry(0.09, 0.15, 1, 6);
const PAD_GEO = new THREE.CylinderGeometry(0.36, 0.44, 0.14, 10);
const SINK_GEO = new THREE.CylinderGeometry(0.5, 0.58, 0.16, 12);
const ARROW_GEO = new THREE.ConeGeometry(0.16, 0.44, 3);
ARROW_GEO.rotateX(Math.PI / 2);
const CAP_BODY_GEO = new THREE.CapsuleGeometry(0.34, 0.85, 3, 8);
const CAP_RING_GEO = new THREE.TorusGeometry(0.37, 0.05, 8, 18);
const CAP_LAMP_GEO = new THREE.SphereGeometry(0.11, 8, 6);
const JUNCTION_DISC_GEO = new THREE.CylinderGeometry(0.78, 0.86, 0.16, 20);
const JUNCTION_RING_GEO = new THREE.TorusGeometry(0.66, 0.045, 8, 22);

/** Directed shared guideway. Freehand strokes supply geometry; this graph still routes cargo. */
export class RailNetwork {
  readonly group = new THREE.Group();
  private nodes: NetNode[] = [];
  private edges: NetEdge[] = [];
  private capsules: NetCap[] = [];
  private nextNode = 1;
  private nextEdge = 1;
  private nextCap = 1;
  private account = { dispatched: 0, delivered: 0, sold: 0 };
  private reserved = new Set<number>();
  private deck: THREE.Mesh;
  private glow: THREE.Mesh;
  private supports: THREE.InstancedMesh;
  private pads: THREE.InstancedMesh;
  private sinkPads: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private deckMat = new THREE.MeshStandardMaterial({ color: 0x1a3038, metalness: 0.58, roughness: 0.4 });
  private glowMat = new THREE.MeshStandardMaterial({ color: 0x9fe7dc, emissive: 0x146e68, emissiveIntensity: 0.62, metalness: 0.25, roughness: 0.32 });
  private switchMat = new THREE.MeshStandardMaterial({ color: 0xd7ebe6, metalness: 0.42, roughness: 0.38 });
  private accentMat = new THREE.MeshStandardMaterial({ color: 0xffb15a, emissive: 0x8a4e12, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.34 });
  private focusNode = 0;
  private bumps: Array<{ edgeId: number; x: number; z: number }> = [];
  private shell = new THREE.MeshStandardMaterial({ color: 0xd7ebe6, metalness: 0.5, roughness: 0.34 });

  constructor(
    parent: THREE.Group,
    private buildings: BuildingSystem,
    private sell: (kind: CargoKind, amount: number, byRail: boolean) => void,
    private delivered: (kind: CargoKind, amount: number) => void,
  ) {
    this.group.name = "rail-network";
    parent.add(this.group);
    this.deck = new THREE.Mesh(new THREE.BufferGeometry(), this.deckMat);
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMat);
    this.deck.castShadow = false; this.glow.castShadow = false;
    this.supports = new THREE.InstancedMesh(SUPPORT_GEO, this.deckMat, 96);
    this.supports.count = 0; this.supports.castShadow = false;
    this.pads = new THREE.InstancedMesh(PAD_GEO, this.deckMat, 160);
    this.pads.count = 0; this.pads.castShadow = false;
    this.sinkPads = new THREE.InstancedMesh(SINK_GEO, this.glowMat, 48);
    this.sinkPads.count = 0; this.sinkPads.castShadow = false;
    this.arrows = new THREE.InstancedMesh(ARROW_GEO, this.glowMat, 64);
    this.arrows.count = 0; this.arrows.castShadow = false;
    this.group.add(this.deck, this.glow, this.supports, this.pads, this.sinkPads, this.arrows);
  }

  claimsSource(buildingId: number): boolean {
    const node = this.nodes.find((item) => item.kind === "out" && item.buildingId === buildingId);
    return !!node && this.edges.some((edge) => edge.from === node.id);
  }
  hit(x: number, z: number, range = 1.7): NetNode | null {
    let best: NetNode | null = null; let bestD = range;
    for (const node of this.nodes) if (node.kind === "merge" || node.kind === "split") {
      const dist = Math.hypot(x - node.x, z - node.z);
      if (dist < bestD) { best = node; bestD = dist; }
    }
    return best;
  }
  place(kind: JunctionKind, x: number, z: number): number {
    const node = this.addNode(kind, x, z, 0);
    this.rebuild();
    return node.id;
  }
  preview(from: NetEnd, to: NetEnd): { ok: boolean; reason: string; cost: number; total: number; points: RailPathPoint[]; valid: boolean; kind: CargoKind | null } {
    const plan = this.plan(from, to, false);
    if (plan.reason === "blocked") return { ok: false, reason: "blocked", cost: 0, total: plan.total, points: plan.travel, valid: false, kind: plan.kind };
    if (!plan.ok) return { ok: false, reason: plan.reason, cost: 0, total: 0, points: [], valid: false, kind: null };
    return { ok: true, reason: plan.reason, cost: plan.cost, total: plan.total, points: plan.travel, valid: true, kind: plan.kind };
  }
  link(from: NetEnd, to: NetEnd, charge: (cost: number) => boolean): NetResult {
    const plan = this.plan(from, to, false);
    if (!plan.ok || !plan.kind) return { ok: false, reason: plan.reason, cost: 0, edgeId: 0, total: 0 };
    if (plan.existing) return { ok: true, reason: "reuse", cost: 0, edgeId: plan.existing.id, total: plan.existing.total };
    const fromNode = this.resolve(from, true); const toNode = this.resolve(to, true);
    if (!fromNode || !toNode) return { ok: false, reason: "missing", cost: 0, edgeId: 0, total: 0 };
    if (plan.cost > 0 && !charge(plan.cost)) return { ok: false, reason: "credits", cost: plan.cost, edgeId: 0, total: plan.total };
    const edge = this.addEdge(fromNode, toNode, plan.points, plan.travel, plan.kind, plan.cost);
    this.rebuild();
    return { ok: true, reason: "created", cost: plan.cost, edgeId: edge.id, total: edge.total };
  }
  /** Refuses while capsules are on the segment, so an edit cannot teleport or delete cargo. */
  reshape(edgeId: number, points: RailPathPoint[], charge: (cost: number) => boolean): NetResult {
    const edge = this.edges.find((item) => item.id === edgeId);
    if (!edge || points.length < 2) return { ok: false, reason: "missing", cost: 0, edgeId, total: 0 };
    if (this.capsules.some((capsule) => capsule.edgeId === edgeId)) return { ok: false, reason: "occupied", cost: 0, edgeId, total: edge.total };
    const travel = points.length > 3 ? this.shape(points) : this.smooth(points);
    const measured = this.measure(travel);
    const cost = Math.max(24, Math.ceil(measured.total * 2.2));
    const extra = Math.max(0, cost - edge.paid);
    if (extra > 0 && !charge(extra)) return { ok: false, reason: "credits", cost: extra, edgeId, total: edge.total };
    edge.points = points.map((point) => ({ ...point }));
    edge.travel = measured.points; edge.lengths = measured.lengths; edge.total = measured.total;
    edge.paid = Math.max(edge.paid, cost);
    this.rebuild();
    return { ok: true, reason: "edited", cost: extra, edgeId, total: edge.total };
  }
  policy(id: number, policy: NetPolicy, ratio?: number, priority?: number): boolean {
    const node = this.nodes.find((item) => item.id === id && item.kind === "split");
    if (!node) return false;
    node.policy = policy;
    if (ratio != null) node.ratio = Math.max(0, Math.min(100, Math.round(ratio)));
    if (priority != null && node.order.includes(priority)) node.priority = priority;
    else if (!node.order.includes(node.priority)) node.priority = node.order[0] ?? 0;
    return true;
  }
  inspect(id: number): { id: number; kind: JunctionKind; policy: NetPolicy; ratio: number; backlog: number; sentA: number; sentB: number; destA: number; destB: number; blocked: boolean; edgeA: number; edgeB: number; x: number; z: number } | null {
    const node = this.nodes.find((item) => item.id === id && (item.kind === "merge" || item.kind === "split" || item.kind === "cross"));
    if (!node || (node.kind !== "merge" && node.kind !== "split" && node.kind !== "cross")) return null;
    const listed = node.kind === "cross"
      ? [node.order[1], node.order[3]].map((edgeId) => this.edges.find((edge) => edge.id === edgeId)).filter((edge): edge is NetEdge => !!edge)
      : node.order.map((edgeId) => this.edges.find((edge) => edge.id === edgeId)).filter((edge): edge is NetEdge => !!edge);
    const outs = listed;
    const backlog = this.capsules.filter((capsule) => capsule.hold && this.edges.find((edge) => edge.id === capsule.edgeId)?.to === id).reduce((sum, capsule) => sum + capsule.cargo, 0);
    return {
      id, kind: node.kind, policy: node.policy, ratio: node.ratio, backlog, sentA: node.sent[0], sentB: node.sent[1],
      destA: this.sinkBuilding(outs[0]), destB: this.sinkBuilding(outs[1]), blocked: node.blocked,
      edgeA: outs[0]?.id ?? 0, edgeB: outs[1]?.id ?? 0, x: node.x, z: node.z,
    };
  }
  state(): {
    nodes: number; edges: Array<{ id: number; from: number; to: number; role: string; total: number; paid: number; kind: CargoKind }>;
    capsules: Array<{ id: number; edgeId: number; distance: number; cargo: number; kind: CargoKind; hold: boolean; origin: number; wait: number }>;
    account: { dispatched: number; delivered: number; sold: number }; cargo: number;
    junctions: NonNullable<ReturnType<RailNetwork["inspect"]>>[]; waits: number[];
  } {
    const waits = this.capsules.filter((capsule) => capsule.hold).map((capsule) => capsule.wait);
    return {
      nodes: this.nodes.length,
      edges: this.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, role: edge.role, total: edge.total, paid: edge.paid, kind: edge.kind })),
      capsules: this.capsules.map((capsule) => ({ id: capsule.id, edgeId: capsule.edgeId, distance: capsule.distance, cargo: capsule.cargo, kind: capsule.kind, hold: capsule.hold, origin: capsule.origin, wait: capsule.wait })),
      account: { ...this.account }, cargo: this.capsules.reduce((sum, capsule) => sum + capsule.cargo, 0),
      junctions: this.nodes.filter((node) => node.kind === "merge" || node.kind === "split" || node.kind === "cross").map((node) => this.inspect(node.id)!),
      waits,
    };
  }
  /** Geometry health used by automated checks: the guideway must exist, be visible, and face up. */
  visual(): { edges: number; deckVisible: boolean; deckVertices: number; deckNormalUp: boolean; glowVisible: boolean; glowVertices: number; supports: number; pads: number; sinkPads: number; arrows: number } {
    const deckPos = this.deck.geometry.getAttribute("position");
    const deckNormal = this.deck.geometry.getAttribute("normal");
    const glowPos = this.glow.geometry.getAttribute("position");
    let upVotes = 0;
    if (deckNormal) for (let i = 0; i < deckNormal.count; i += 4) if (deckNormal.getY(i) > 0.35) upVotes++;
    return {
      edges: this.edges.length,
      deckVisible: this.deck.visible, deckVertices: deckPos?.count ?? 0,
      deckNormalUp: !!deckNormal && deckNormal.count > 0 && upVotes >= Math.floor(deckNormal.count / 4) - 1,
      glowVisible: this.glow.visible, glowVertices: glowPos?.count ?? 0,
      supports: this.supports.count, pads: this.pads.count, sinkPads: this.sinkPads.count, arrows: this.arrows.count,
    };
  }

  update(dt: number): void {
    this.reserved.clear();
    for (const node of this.nodes) if (node.kind === "out") this.dispatch(node, dt);
    const movers = [...this.capsules].sort((a, b) => b.distance - a.distance);
    for (const capsule of movers) {
      const edge = this.edges.find((item) => item.id === capsule.edgeId); if (!edge) continue;
      if (capsule.distance >= edge.total - 0.04) {
        capsule.distance = edge.total; capsule.hold = true; capsule.wait += dt;
        const node = this.nodes.find((item) => item.id === edge.to);
        if (node && this.mergeAllows(capsule, node)) this.arrive(capsule, node);
      } else {
        const ahead = this.capsules.filter((other) => other !== capsule && other.edgeId === capsule.edgeId && other.distance > capsule.distance + 0.01)
          .sort((a, b) => a.distance - b.distance)[0];
        const gap = ahead ? ahead.distance - capsule.distance - SPACING : Infinity;
        const step = Math.max(0, Math.min(this.pace(capsule.level, capsule.kind).speed * dt, gap, edge.total - capsule.distance));
        capsule.distance += step; capsule.hold = false;
      }
      this.pose(capsule);
    }
    this.capsules = this.capsules.filter((capsule) => {
      if (capsule.cargo > -1) return true;
      capsule.group.removeFromParent(); disposeObject(capsule.group, false); return false;
    });
  }

  detach(buildingId: number): void {
    const owned = this.nodes.filter((node) => node.buildingId === buildingId).map((node) => node.id);
    if (!owned.length) return;
    const drop = new Set(this.edges.filter((edge) => owned.includes(edge.from) || owned.includes(edge.to)).map((edge) => edge.id));
    for (const capsule of [...this.capsules]) if (drop.has(capsule.edgeId)) { this.buildings.retainCargo(capsule.kind, capsule.cargo); capsule.cargo = -2; }
    this.edges = this.edges.filter((edge) => !drop.has(edge.id));
    for (const node of this.nodes) node.order = node.order.filter((id) => !drop.has(id));
    this.nodes = this.nodes.filter((node) => !owned.includes(node.id));
    this.capsules = this.capsules.filter((capsule) => capsule.cargo >= 0);
    this.rebuild();
  }
  serialize(): NetSave {
    return {
      nodes: this.nodes.map((node) => ({ ...node, order: [...node.order], sent: [...node.sent] as [number, number] })),
      edges: this.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, role: edge.role, points: edge.points.map((point) => ({ ...point })), paid: edge.paid, kind: edge.kind })),
      capsules: this.capsules.map((capsule) => ({ id: capsule.id, edgeId: capsule.edgeId, distance: capsule.distance, cargo: capsule.cargo, kind: capsule.kind, wait: capsule.wait, hold: capsule.hold, level: capsule.level, origin: capsule.origin })),
      account: { ...this.account }, nextNode: this.nextNode, nextEdge: this.nextEdge, nextCap: this.nextCap,
    };
  }
  restore(data: NetSave | null | undefined): void {
    this.reset();
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return;
    try {
      for (const node of data.nodes) {
        if (!node || !Number.isFinite(node.id) || !Number.isFinite(node.x)) continue;
        if (node.kind !== "out" && node.kind !== "in" && node.kind !== "merge" && node.kind !== "split" && node.kind !== "cross") continue;
        this.nodes.push({
          id: node.id, kind: node.kind, x: node.x, z: node.z, buildingId: node.buildingId ?? 0,
          policy: node.policy === "priority" || node.policy === "ratio" ? node.policy : "auto",
          ratio: Math.max(0, Math.min(100, node.ratio ?? 50)), priority: node.priority ?? 0,
          order: Array.isArray(node.order) ? node.order.filter((id) => Number.isFinite(id)) : [],
          sent: [Math.max(0, node.sent?.[0] ?? 0), Math.max(0, node.sent?.[1] ?? 0)], turn: node.turn ?? 0, blocked: false, cooldown: 0,
        });
      }
      for (const edge of data.edges) {
        const from = this.nodes.find((node) => node.id === edge.from); const to = this.nodes.find((node) => node.id === edge.to);
        if (!from || !to || !Array.isArray(edge.points) || edge.points.length < 2) continue;
        if (edge.kind !== "raw" && edge.kind !== "purified" && edge.kind !== "ice") continue;
        const travel = edge.points.length > 3 ? this.shape(edge.points) : this.smooth(edge.points);
        const measured = this.measure(travel);
        this.edges.push({ id: edge.id, from: from.id, to: to.id, role: edge.role === "trunk" || edge.role === "branch" ? edge.role : "segment", points: edge.points.map((point) => ({ ...point })), travel: measured.points, lengths: measured.lengths, total: measured.total, paid: Math.max(0, edge.paid ?? 0), kind: edge.kind });
      }
      this.edges = this.edges.filter((edge) => this.nodes.some((node) => node.id === edge.from) && this.nodes.some((node) => node.id === edge.to));
      for (const capsule of data.capsules ?? []) {
        const edge = this.edges.find((item) => item.id === capsule.edgeId);
        if (!edge || !(capsule.cargo > 0)) { if (capsule.cargo > 0 && (capsule.kind === "raw" || capsule.kind === "purified" || capsule.kind === "ice")) this.buildings.retainCargo(capsule.kind, capsule.cargo); continue; }
        this.capsules.push(this.makeCap(edge, capsule.cargo, capsule.kind, capsule.level || 1, capsule.origin || 0, capsule.distance, capsule.id));
      }
      this.account = { dispatched: Math.max(0, data.account?.dispatched ?? 0), delivered: Math.max(0, data.account?.delivered ?? 0), sold: Math.max(0, data.account?.sold ?? 0) };
      this.nextNode = Math.max(this.nextNode, data.nextNode ?? 1, ...this.nodes.map((node) => node.id + 1));
      this.nextEdge = Math.max(this.nextEdge, data.nextEdge ?? 1, ...this.edges.map((edge) => edge.id + 1));
      this.nextCap = Math.max(this.nextCap, data.nextCap ?? 1, ...this.capsules.map((capsule) => capsule.id + 1));
      this.rebuild();
    } catch { this.reset(); }
  }
  reset(): void {
    for (const capsule of this.capsules) { capsule.group.removeFromParent(); disposeObject(capsule.group, false); }
    this.nodes = []; this.edges = []; this.capsules = []; this.bumps = [];
    this.account = { dispatched: 0, delivered: 0, sold: 0 };
    this.nextNode = 1; this.nextEdge = 1; this.nextCap = 1;
    this.rebuild();
  }

  private addNode(kind: NetNode["kind"], x: number, z: number, buildingId: number): NetNode {
    const node: NetNode = { id: this.nextNode++, kind, x, z, buildingId, policy: "auto", ratio: 70, priority: 0, order: [], sent: [0, 0], turn: 0, blocked: false, cooldown: 0 };
    this.nodes.push(node); return node;
  }
  private plan(fromEnd: NetEnd, toEnd: NetEnd, create: boolean): { ok: boolean; reason: string; cost: number; total: number; points: RailPathPoint[]; travel: RailPathPoint[]; kind: CargoKind | null; existing?: NetEdge } {
    const from = this.resolve(fromEnd, create); const to = this.resolve(toEnd, create);
    if (!from || !to || from.id === to.id) return { ok: false, reason: "missing", cost: 0, total: 0, points: [], travel: [], kind: null };
    if (from.kind === "in" || to.kind === "out") return { ok: false, reason: "degree", cost: 0, total: 0, points: [], travel: [], kind: null };
    const existing = this.edges.find((edge) => edge.from === from.id && edge.to === to.id);
    if (existing) return { ok: true, reason: "reuse", cost: 0, total: existing.total, points: existing.points, travel: existing.travel, kind: existing.kind, existing };
    if ((from.kind === "out" || from.kind === "merge") && this.edges.some((edge) => edge.from === from.id)) return { ok: false, reason: "degree", cost: 0, total: 0, points: [], travel: [], kind: null };
    if (from.kind === "split" && from.order.length >= 2) return { ok: false, reason: "degree", cost: 0, total: 0, points: [], travel: [], kind: null };
    if (to.kind === "merge" && this.edges.filter((edge) => edge.to === to.id).length >= 2) return { ok: false, reason: "degree", cost: 0, total: 0, points: [], travel: [], kind: null };
    if (to.kind === "split" && this.edges.some((edge) => edge.to === to.id)) return { ok: false, reason: "degree", cost: 0, total: 0, points: [], travel: [], kind: null };
    if (this.reaches(to.id, from.id)) return { ok: false, reason: "cycle", cost: 0, total: 0, points: [], travel: [], kind: null };
    const kind = this.flowKind(from);
    if (!kind) return { ok: false, reason: "open", cost: 0, total: 0, points: [], travel: [], kind: null };
    if (!this.accepts(to, kind)) return { ok: false, reason: "cargo", cost: 0, total: 0, points: [], travel: [], kind: null };
    const start = this.anchor(from, to); const end = this.anchor(to, from);
    const route = this.avoid(start, end, from, to);
    const travel = this.smooth(route.points); const measured = this.measure(travel);
    if (route.blocked) return { ok: false, reason: "blocked", cost: 0, total: measured.total, points: route.points, travel: measured.points, kind };
    return { ok: true, reason: "created", cost: Math.max(24, Math.ceil(measured.total * 2.2)), total: measured.total, points: route.points, travel: measured.points, kind };
  }
  private addEdge(from: NetNode, to: NetNode, points: RailPathPoint[], travel: RailPathPoint[], kind: CargoKind, paid: number): NetEdge {
    const measured = this.measure(travel);
    const role = from.kind === "merge" || to.kind === "split" ? "trunk" : from.kind === "split" || to.kind === "merge" ? "branch" : "segment";
    const edge: NetEdge = { id: this.nextEdge++, from: from.id, to: to.id, role, points, travel: measured.points, lengths: measured.lengths, total: measured.total, paid, kind };
    this.edges.push(edge);
    if (from.kind === "split") { from.order.push(edge.id); if (!from.priority) from.priority = edge.id; }
    if (to.kind === "merge") to.order.push(edge.id);
    return edge;
  }
  private resolve(end: NetEnd, create: boolean): NetNode | null {
    if ("nodeId" in end) return this.nodes.find((node) => node.id === end.nodeId) ?? null;
    if (end.buildingId === 0 && end.port === "out") return null;
    const found = this.nodes.find((node) => node.buildingId === end.buildingId && node.kind === end.port);
    if (found) return found;
    const spot = end.buildingId === 0 ? { x: GAME.depot.x, z: GAME.depot.z - 1.7 } : this.buildings.byId(end.buildingId);
    if (!spot) return null;
    if (!create) return { id: end.port === "out" ? -1 : -2, kind: end.port, x: spot.x, z: spot.z, buildingId: end.buildingId, policy: "auto", ratio: 70, priority: 0, order: [], sent: [0, 0], turn: 0, blocked: false, cooldown: 0 };
    return this.addNode(end.port, spot.x, spot.z, end.buildingId);
  }
  private flowKind(from: NetNode): CargoKind | null {
    if (from.kind === "out") { const building = this.buildings.byId(from.buildingId); return building ? this.buildings.cargoKind(building) : null; }
    return this.edges.find((edge) => edge.to === from.id)?.kind ?? null;
  }
  private accepts(to: NetNode, kind: CargoKind): boolean {
    if (to.kind === "merge" || to.kind === "split") { const current = this.edges.find((edge) => edge.to === to.id)?.kind; return !current || current === kind; }
    if (to.buildingId === 0) return kind === "purified" || kind === "ice";
    const building = this.buildings.byId(to.buildingId);
    return !!building && ((building.type === "purifier" && kind === "raw") || (building.type === "press" && kind === "purified"));
  }
  private reaches(start: number, goal: number): boolean {
    const stack = [start]; const seen = new Set<number>();
    while (stack.length) {
      const id = stack.pop()!; if (id === goal) return true; if (seen.has(id)) continue; seen.add(id);
      for (const edge of this.edges) if (edge.from === id) stack.push(edge.to);
    }
    return false;
  }
  private anchor(node: NetNode, other: NetNode): RailPathPoint {
    if (node.kind === "merge" || node.kind === "split") return { x: node.x, z: node.z };
    if (node.buildingId === 0) return { x: GAME.depot.x, z: GAME.depot.z - 1.7 };
    const building = this.buildings.byId(node.buildingId); if (!building) return { x: node.x, z: node.z };
    const dx = other.x - building.x, dz = other.z - building.z, len = Math.hypot(dx, dz) || 1;
    // End the guideway inside the building body so the port connection reads as plugged in.
    const radius = BUILDINGS[building.type].radius * 0.55;
    return { x: building.x + dx / len * radius, z: building.z + dz / len * radius };
  }
  private hitsBuilding(points: RailPathPoint[], obstacles: Array<{ x: number; z: number; radius: number }>, source: RailPathPoint, dest: RailPathPoint): boolean {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (Math.hypot(x - source.x, z - source.z) < 2.8 || Math.hypot(x - dest.x, z - dest.z) < 2.8) continue;
        if (obstacles.some((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + 0.55)) return true;
      }
    }
    return false;
  }
  private avoid(start: RailPathPoint, end: RailPathPoint, from: NetNode, to: NetNode): { points: RailPathPoint[]; blocked: boolean } {
    const ignore = new Set([from.buildingId, to.buildingId]);
    const obstacles = this.buildings.items.filter((building) => !ignore.has(building.id)).map((building) => ({ x: building.x, z: building.z, radius: BUILDINGS[building.type].radius }));
    if (from.buildingId !== 0 && to.buildingId !== 0) obstacles.push({ x: GAME.depot.x, z: GAME.depot.z, radius: 1.8 });
    const center = (id: number) => id === 0 ? { x: GAME.depot.x, z: GAME.depot.z } : { x: this.buildings.byId(id)?.x ?? start.x, z: this.buildings.byId(id)?.z ?? start.z };
    const dx = end.x - start.x, dz = end.z - start.z, len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len;
    const tries: RailPathPoint[][] = [[start, end]];
    for (const mag of [2.4, 4.8, 7.2]) for (const sign of [1, -1]) tries.push([start, { x: (start.x + end.x) / 2 + px * mag * sign, z: (start.z + end.z) / 2 + pz * mag * sign }, end]);
    for (const controls of tries) {
      const travel = this.smooth(controls);
      if (!this.hitsBuilding(travel, obstacles, center(from.buildingId), center(to.buildingId))) return { points: controls, blocked: false };
    }
    return { points: tries[0], blocked: true };
  }
  /** Catmull-Rom through every control so a freehand stroke keeps the drawn shape. */
  private shape(controls: RailPathPoint[]): RailPathPoint[] {
    if (controls.length < 3) return this.sampleLine(controls[0], controls[controls.length - 1]);
    const pts = [controls[0], ...controls, controls[controls.length - 1]];
    const out: RailPathPoint[] = [];
    for (let i = 1; i < pts.length - 2; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
      const steps = Math.max(3, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / 0.9));
      for (let step = 0; step < steps; step++) {
        const t = step / steps, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        });
      }
    }
    out.push({ ...controls[controls.length - 1] });
    return out;
  }
  private smooth(controls: RailPathPoint[]): RailPathPoint[] {
    if (controls.length < 3) return this.sampleLine(controls[0], controls[controls.length - 1]);
    const [a, control, b] = [controls[0], controls[1], controls[controls.length - 1]];
    const steps = Math.max(8, Math.ceil((Math.hypot(control.x - a.x, control.z - a.z) + Math.hypot(b.x - control.x, b.z - control.z)) / 1.15));
    const points: RailPathPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, z: u * u * a.z + 2 * u * t * control.z + t * t * b.z });
    }
    return points;
  }
  private sampleLine(a: RailPathPoint, b: RailPathPoint): RailPathPoint[] {
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.2));
    const points: RailPathPoint[] = [];
    for (let i = 0; i <= steps; i++) points.push({ x: a.x + (b.x - a.x) * i / steps, z: a.z + (b.z - a.z) * i / steps });
    return points;
  }
  private measure(points: RailPathPoint[]): { points: RailPathPoint[]; lengths: number[]; total: number } {
    const lengths = [0]; let total = 0;
    for (let i = 1; i < points.length; i++) { total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z); lengths.push(total); }
    return { points, lengths, total };
  }
  private pace(level: number, kind: CargoKind): { capacity: number; speed: number; gap: number } {
    const step = Math.max(0, Math.min(2, level - 1)); const pace = 1 + step * 0.42;
    return { capacity: (kind === "ice" ? 5 : kind === "raw" ? 30 : 28) + step * (kind === "ice" ? 2 : 8), speed: (kind === "ice" ? 15 : kind === "purified" ? 14 : 13) * pace, gap: 0.75 / pace };
  }
  private dispatch(node: NetNode, dt: number): void {
    const edge = this.edges.find((item) => item.from === node.id); if (!edge) return;
    const source = this.buildings.byId(node.buildingId); if (!source || source.damaged || !source.powered) return;
    if (!this.sinkOpen(edge, edge.kind, 0.2) || !this.entranceFree(edge.id) || this.capsules.length >= 48) return;
    node.cooldown -= dt; if (node.cooldown > 0) return;
    const haul = this.pace(source.level, edge.kind);
    const cargo = this.buildings.drainOutput(source, haul.capacity);
    if (cargo <= 0.01) { node.cooldown = 0.45; return; }
    this.capsules.push(this.makeCap(edge, cargo, edge.kind, source.level, source.id, 0));
    this.account.dispatched += cargo; node.cooldown = haul.gap;
  }
  private entranceFree(edgeId: number): boolean { return !this.capsules.some((capsule) => capsule.edgeId === edgeId && capsule.distance < SPACING); }
  private sinkOpen(edge: NetEdge, kind: CargoKind, amount: number): boolean {
    const node = this.nodes.find((item) => item.id === edge.to); if (!node) return false;
    if (node.kind === "in") return this.room(node, kind) >= Math.min(amount, 0.2) || amount <= 0;
    if (node.kind === "cross") {
      const index = node.order.indexOf(edge.id);
      const next = index >= 0 && index % 2 === 0 ? this.edges.find((item) => item.id === node.order[index + 1]) : undefined;
      return !!next && this.sinkOpen(next, kind, amount);
    }
    const outs = node.kind === "split" ? node.order.map((id) => this.edges.find((item) => item.id === id)!).filter(Boolean) : this.edges.filter((item) => item.from === node.id);
    if (!outs.length) return false;
    return outs.some((next) => this.sinkOpen(next, kind, amount));
  }
  private room(node: NetNode, kind: CargoKind): number {
    if (node.buildingId === 0) return kind === "purified" || kind === "ice" ? 1e6 : 0;
    const building = this.buildings.byId(node.buildingId); if (!building || building.damaged) return 0;
    const ok = (building.type === "purifier" && kind === "raw") || (building.type === "press" && kind === "purified");
    return ok ? Math.max(0, this.buildings.capacity(building) - building.input) : 0;
  }
  private sinkBuilding(edge?: NetEdge): number {
    if (!edge) return -1;
    let guard = 0; let current = edge;
    while (guard++ < 8) {
      const node = this.nodes.find((item) => item.id === current.to); if (!node) return -1;
      if (node.kind === "in") return node.buildingId;
      const next = this.edges.find((item) => item.from === node.id); if (!next) return -1;
      current = next;
    }
    return -1;
  }
  private mergeAllows(capsule: NetCap, node: NetNode): boolean {
    if (node.kind !== "merge") return true;
    const incoming = this.edges.filter((edge) => edge.to === node.id);
    if (incoming.length < 2) return true;
    const waiting = new Set(this.capsules.filter((other) => other.hold && this.edges.find((edge) => edge.id === other.edgeId)?.to === node.id).map((other) => other.edgeId));
    if (waiting.size < 2) return true;
    const preferred = incoming.some((edge) => edge.id === node.turn) ? node.turn : incoming[0].id;
    return capsule.edgeId === preferred;
  }
  private arrive(capsule: NetCap, node: NetNode): void {
    if (node.kind === "in") { this.unload(capsule, node); return; }
    const next = this.pick(node, capsule); if (!next || !this.entranceFree(next.id) || this.reserved.has(node.id)) { node.blocked = capsule.wait > 8; return; }
    this.reserved.add(node.id);
    if (node.kind === "split") { const index = node.order.indexOf(next.id); if (index === 0 || index === 1) node.sent[index] += capsule.cargo; }
    if (node.kind === "merge") { const incoming = this.edges.filter((edge) => edge.to === node.id); const other = incoming.find((edge) => edge.id !== capsule.edgeId); node.turn = other?.id ?? capsule.edgeId; }
    capsule.edgeId = next.id; capsule.distance = 0; capsule.hold = false; capsule.wait = 0; node.blocked = false;
  }
  private pick(node: NetNode, capsule: NetCap): NetEdge | null {
    if (node.kind === "cross") {
      const index = node.order.indexOf(capsule.edgeId);
      if (index < 0 || index % 2 !== 0) return null;
      const next = this.edges.find((edge) => edge.id === node.order[index + 1]);
      return next && this.sinkOpen(next, capsule.kind, capsule.cargo) ? next : null;
    }
    const outs = (node.kind === "split" ? node.order : this.edges.filter((edge) => edge.from === node.id).map((edge) => edge.id))
      .map((id) => this.edges.find((edge) => edge.id === id)).filter((edge): edge is NetEdge => !!edge);
    if (node.kind !== "split") return outs[0] ?? null;
    const open = (edge: NetEdge) => this.sinkOpen(edge, capsule.kind, capsule.cargo);
    if (node.policy === "priority") {
      const preferred = outs.find((edge) => edge.id === node.priority) ?? outs[0];
      const other = outs.find((edge) => edge !== preferred);
      if (preferred && open(preferred)) return preferred;
      if (other && open(other)) return other;
      return null;
    }
    if (node.policy === "ratio") {
      const total = node.sent[0] + node.sent[1];
      const share = total <= 0.001 ? 0 : node.sent[0] / total;
      const first = share <= node.ratio / 100;
      const order = first ? outs : [...outs].reverse();
      return order.find((edge) => open(edge)) ?? null;
    }
    const available = outs.filter(open);
    return available.sort((a, b) => {
      const ia = node.order.indexOf(a.id), ib = node.order.indexOf(b.id);
      const sentA = ia === 0 ? node.sent[0] : ia === 1 ? node.sent[1] : 0;
      const sentB = ib === 0 ? node.sent[0] : ib === 1 ? node.sent[1] : 0;
      return sentA - sentB || ia - ib;
    })[0] ?? null;
  }
  private unload(capsule: NetCap, node: NetNode): void {
    if (node.buildingId === 0) {
      if (capsule.kind === "raw") { capsule.hold = true; node.blocked = true; return; }
      const amount = capsule.cargo; this.sell(capsule.kind, amount, true); this.delivered(capsule.kind, amount);
      this.account.delivered += amount; this.account.sold += amount; capsule.cargo = -2; return;
    }
    const building = this.buildings.byId(node.buildingId);
    if (!building) { this.buildings.retainCargo(capsule.kind, capsule.cargo); capsule.cargo = -2; return; }
    const accepted = this.buildings.acceptInput(building, capsule.kind, capsule.cargo);
    if (accepted > 0) { this.delivered(capsule.kind, accepted); this.account.delivered += accepted; capsule.cargo -= accepted; }
    if (capsule.cargo <= 0.001) capsule.cargo = -2;
    else { capsule.hold = true; node.blocked = capsule.wait > 8; }
  }
  private makeCap(edge: NetEdge, cargo: number, kind: CargoKind, level: number, origin: number, distance = 0, id = this.nextCap++): NetCap {
    const group = new THREE.Group(); group.userData.sharedResources = true; this.group.add(group);
    const body = new THREE.Mesh(CAP_BODY_GEO, this.shell); body.rotation.x = Math.PI / 2; body.position.y = 0.36; group.add(body);
    const ring = new THREE.Mesh(CAP_RING_GEO, this.glowMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.36; group.add(ring);
    const lamp = new THREE.Mesh(CAP_LAMP_GEO, this.glowMat); lamp.position.set(0, 0.38, 0.58); group.add(lamp);
    const capsule: NetCap = { id, edgeId: edge.id, distance: Math.min(distance, edge.total), cargo, kind, wait: 0, hold: false, level, origin, group };
    this.pose(capsule); return capsule;
  }
  private pose(capsule: NetCap): void {
    const edge = this.edges.find((item) => item.id === capsule.edgeId); if (!edge) return;
    const point = this.pointAt(edge, capsule.distance); const ahead = this.pointAt(edge, Math.min(edge.total, capsule.distance + 0.45));
    capsule.group.position.set(point.x, this.heightAt(edge, point.x, point.z) + 0.16, point.z);
    capsule.group.rotation.y = Math.atan2(ahead.x - point.x, ahead.z - point.z);
    capsule.group.visible = capsule.cargo > 0;
  }
  private pointAt(edge: NetEdge, distance: number): RailPathPoint {
    const d = Math.max(0, Math.min(distance, edge.total)); let index = 1;
    while (index < edge.lengths.length - 1 && edge.lengths[index] < d) index++;
    const a = edge.travel[Math.max(0, index - 1)], b = edge.travel[Math.min(edge.travel.length - 1, index)];
    const start = edge.lengths[Math.max(0, index - 1)] ?? 0; const span = Math.max(0.001, (edge.lengths[index] ?? edge.total) - start); const t = (d - start) / span;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  private heightAt(edge: NetEdge, x: number, z: number): number {
    let bump = 0;
    for (const mark of this.bumps) if (mark.edgeId === edge.id) {
      const dist = Math.hypot(x - mark.x, z - mark.z); if (dist < 2.4) { const t = 1 - dist / 2.4; bump = Math.max(bump, t * t * 0.75); }
    }
    return groundHeight(x, z) + 0.9 + bump;
  }
  private insideBuilding(x: number, z: number): boolean {
    return this.buildings.items.some((building) => Math.hypot(x - building.x, z - building.z) < BUILDINGS[building.type].radius + 0.15);
  }
  private rebuild(): void {
    for (const child of [...this.group.children]) if (child !== this.deck && child !== this.glow && child !== this.supports && child !== this.pads && child !== this.sinkPads && child !== this.arrows && !(child.parent && this.capsules.some((capsule) => capsule.group === child))) {
      if (!this.capsules.some((capsule) => capsule.group === child)) { this.group.remove(child); disposeObject(child, false); }
    }
    this.bumps = [];
    for (let i = 0; i < this.edges.length; i++) for (let j = 0; j < i; j++) {
      const hit = this.crossing(this.edges[i], this.edges[j]); if (!hit) continue;
      const share = this.edges[i].from === this.edges[j].from || this.edges[i].from === this.edges[j].to || this.edges[i].to === this.edges[j].from || this.edges[i].to === this.edges[j].to;
      if (!share) this.bumps.push({ edgeId: this.edges[i].id, x: hit.x, z: hit.z });
    }
    const positions: number[] = []; const glow: number[] = []; const indices: number[] = []; const gIndices: number[] = [];
    const dummy = new THREE.Object3D(); let support = 0; let pad = 0; let sink = 0; let arrow = 0;
    for (const edge of this.edges) {
      const samples: Array<{ x: number; y: number; z: number }> = [];
      for (let i = 0; i < edge.travel.length; i++) {
        const point = edge.travel[i]; samples.push({ x: point.x, y: this.heightAt(edge, point.x, point.z), z: point.z });
      }
      const start = positions.length / 3;
      const gStart = glow.length / 3;
      for (let i = 0; i < samples.length; i++) {
        const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
        let dx = next.x - prev.x, dz = next.z - prev.z; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        const px = -dz, pz = dx;
        const sample = samples[i];
        positions.push(
          sample.x + px * DECK_HALF, sample.y, sample.z + pz * DECK_HALF,
          sample.x + px * DECK_HALF, sample.y - DECK_DROP, sample.z + pz * DECK_HALF,
          sample.x - px * DECK_HALF, sample.y - DECK_DROP, sample.z - pz * DECK_HALF,
          sample.x - px * DECK_HALF, sample.y, sample.z - pz * DECK_HALF,
        );
        glow.push(
          sample.x + px * GLOW_HALF, sample.y + 0.015, sample.z + pz * GLOW_HALF,
          sample.x - px * GLOW_HALF, sample.y + 0.015, sample.z - pz * GLOW_HALF,
          sample.x + px * (GLOW_LIP + GLOW_LIP_W), sample.y + 0.015, sample.z + pz * (GLOW_LIP + GLOW_LIP_W),
          sample.x + px * GLOW_LIP, sample.y + 0.015, sample.z + pz * GLOW_LIP,
          sample.x - px * GLOW_LIP, sample.y + 0.015, sample.z - pz * GLOW_LIP,
          sample.x - px * (GLOW_LIP + GLOW_LIP_W), sample.y + 0.015, sample.z - pz * (GLOW_LIP + GLOW_LIP_W),
        );
        if (i > 0) {
          const a = start + (i - 1) * 4, b = a + 4;
          indices.push(a, b, a + 3, a + 3, b, b + 3);
          indices.push(a + 1, b + 1, a, a, b + 1, b);
          indices.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
          const g = gStart + (i - 1) * 6, h = g + 6;
          for (const off of [0, 2, 4]) gIndices.push(g + off, h + off, g + off + 1, g + off + 1, h + off, h + off + 1);
        }
        if (i % 7 === 0 && !this.insideBuilding(sample.x, sample.z)) {
          if (support < 96) {
            const gy = groundHeight(sample.x, sample.z); const height = Math.max(0.25, sample.y - 0.14 - gy);
            dummy.position.set(sample.x, gy + height / 2, sample.z); dummy.scale.set(1, height, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
            this.supports.setMatrixAt(support++, dummy.matrix);
          }
          if (pad < 160) {
            dummy.position.set(sample.x, sample.y - 0.05, sample.z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
            this.pads.setMatrixAt(pad++, dummy.matrix);
          }
        }
      }
      const fromNode = this.nodes.find((node) => node.id === edge.from);
      const toNode = this.nodes.find((node) => node.id === edge.to);
      const portDepth = (node: NetNode | undefined): number => {
        if (!node || node.kind === "merge" || node.kind === "split" || node.kind === "cross") return 0;
        if (node.buildingId === 0) return 0.55;
        const building = this.buildings.byId(node.buildingId);
        if (building?.type === "purifier") return BUILDINGS.purifier.radius * 0.7;
        return building ? BUILDINGS[building.type].radius * 0.45 + 0.15 : 0;
      };
      const startPad = Math.min(portDepth(fromNode), edge.total * 0.3);
      if (startPad > 0 && pad < 160) {
        const point = this.pointAt(edge, startPad); const y = this.heightAt(edge, point.x, point.z);
        dummy.position.set(point.x, y - 0.05, point.z); dummy.scale.set(1.25, 1, 1.25); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        this.pads.setMatrixAt(pad++, dummy.matrix);
      }
      const endPad = Math.min(portDepth(toNode), edge.total * 0.3);
      if (endPad > 0 && sink < 48) {
        const point = this.pointAt(edge, edge.total - endPad); const y = this.heightAt(edge, point.x, point.z);
        dummy.position.set(point.x, y - 0.05, point.z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        this.sinkPads.setMatrixAt(sink++, dummy.matrix);
      }
      const slots = Math.max(1, Math.min(2, Math.floor(edge.total / 9)));
      for (let k = 0; k < slots && arrow < 64; k++) {
        const along = edge.total * (k + 1) / (slots + 1);
        const point = this.pointAt(edge, along); const ahead = this.pointAt(edge, Math.min(edge.total, along + 0.45));
        if (this.insideBuilding(point.x, point.z)) continue;
        dummy.position.set(point.x, this.heightAt(edge, point.x, point.z) + 0.22, point.z);
        dummy.rotation.set(0, Math.atan2(ahead.x - point.x, ahead.z - point.z), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        this.arrows.setMatrixAt(arrow++, dummy.matrix);
      }
    }
    this.writeRibbon(this.deck, positions, indices);
    this.writeRibbon(this.glow, glow, gIndices);
    this.supports.count = support; this.supports.instanceMatrix.needsUpdate = true;
    this.pads.count = pad; this.pads.instanceMatrix.needsUpdate = true;
    this.sinkPads.count = sink; this.sinkPads.instanceMatrix.needsUpdate = true;
    this.arrows.count = arrow; this.arrows.instanceMatrix.needsUpdate = true;
    for (const node of this.nodes) if (node.kind === "merge" || node.kind === "split" || node.kind === "cross") {
      const y = groundHeight(node.x, node.z) + 0.96;
      const focused = node.id === this.focusNode;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 8), this.deckMat);
      body.position.set(node.x, y, node.z); body.userData.junction = node.id; this.group.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 6), focused ? this.accentMat : this.switchMat);
      cap.position.set(node.x, y + 0.07, node.z); this.group.add(cap);
    }
    for (const capsule of this.capsules) this.pose(capsule);
  }
  setFocus(nodeId: number): void {
    if (this.focusNode === nodeId) return;
    this.focusNode = nodeId;
    this.rebuild();
  }
  hitEdge(x: number, z: number, range = 1.35): { edgeId: number; x: number; z: number; distance: number } | null {
    const hit = this.nearestEdge(x, z, range);
    return hit ? { edgeId: hit.edge.id, x: hit.x, z: hit.z, distance: hit.distance } : null;
  }
  describeEdge(edgeId: number): { id: number; kind: CargoKind; busy: boolean; from: number; to: number; points: RailPathPoint[] } | null {
    const edge = this.edges.find((item) => item.id === edgeId);
    if (!edge) return null;
    return { id: edge.id, kind: edge.kind, busy: this.capsules.some((capsule) => capsule.edgeId === edge.id), from: this.endpointBuilding(edge, "from"), to: this.endpointBuilding(edge, "to"), points: edge.points.map((point) => ({ ...point })) };
  }
  previewStroke(raw: RailPathPoint[]): StrokeView { return this.applyStroke(raw, false, () => true); }
  commitStroke(raw: RailPathPoint[], charge: (cost: number) => boolean): StrokeView { return this.applyStroke(raw, true, charge); }
  removeEdge(edgeId: number): NetResult {
    const edge = this.edges.find((item) => item.id === edgeId);
    if (!edge) return { ok: false, reason: "missing", cost: 0, edgeId, total: 0 };
    if (this.capsules.some((capsule) => capsule.edgeId === edgeId)) return { ok: false, reason: "occupied", cost: 0, edgeId, total: edge.total };
    this.edges = this.edges.filter((item) => item.id !== edgeId);
    for (const node of this.nodes) node.order = node.order.filter((id) => id !== edgeId);
    this.collapseJunctions();
    this.rebuild();
    return { ok: true, reason: "deleted", cost: 0, edgeId, total: 0 };
  }
  private applyStroke(raw: RailPathPoint[], apply: boolean, charge: (cost: number) => boolean): StrokeView {
    const drawn = simplifyStroke(raw);
    const empty = (reason: string, points = drawn): StrokeView => ({ ok: false, reason, cost: 0, total: 0, points, kind: null, junctions: [], sourceId: -1, destinationId: -1 });
    if (drawn.length < 2) return empty("open");
    const length = drawn.reduce((sum, point, index) => index === 0 ? 0 : sum + Math.hypot(point.x - drawn[index - 1].x, point.z - drawn[index - 1].z), 0);
    if (length < 1.15) return empty("open");
    const start = this.snapEnd(drawn[0], drawn[1], "out");
    const end = this.snapEnd(drawn[drawn.length - 1], drawn[drawn.length - 2], "in");
    if (!start || !end) return empty("open", drawn);
    const points = drawn.map((point) => ({ ...point }));
    points[0] = { x: start.x, z: start.z };
    points[points.length - 1] = { x: end.x, z: end.z };
    const ignoreEdges = new Set<number>();
    if (start.edgeId) ignoreEdges.add(start.edgeId);
    if (end.edgeId) ignoreEdges.add(end.edgeId);
    const crossings = this.strokeCrossings(points, ignoreEdges).filter((hit) => {
      const edge = this.edges.find((item) => item.id === hit.edgeId);
      if (!edge) return false;
      if (end.buildingId >= 0 && this.endpointBuilding(edge, "to") === end.buildingId) return false;
      if (start.buildingId >= 0 && this.endpointBuilding(edge, "from") === start.buildingId) return false;
      return true;
    });
    const ignoreBuildings = new Set<number>([start.buildingId, end.buildingId].filter((id) => id >= 0));
    if (this.strokeHitsBuilding(points, ignoreBuildings) || crossings.some((hit) => this.insideBuilding(hit.x, hit.z))) return { ...empty("blocked", points), sourceId: start.buildingId, destinationId: end.buildingId };
    if (crossings.length > 1) return { ...empty("degree", points), sourceId: start.buildingId, destinationId: end.buildingId };
    const travel = points.length > 3 ? this.shape(points) : this.smooth(points);
    const measured = this.measure(travel);
    const cost = Math.max(24, Math.ceil(measured.total * 2.2));
    const kind = start.edgeId ? this.edges.find((edge) => edge.id === start.edgeId)?.kind ?? null : this.buildingKind(start.buildingId, "out");
    const base = { cost, total: measured.total, points, kind, sourceId: start.buildingId, destinationId: end.buildingId };
    if (start.buildingId >= 0 && end.nodeId && crossings.length === 0) {
      const plan = this.plan({ buildingId: start.buildingId, port: "out" }, { nodeId: end.nodeId }, false);
      if ((!plan.ok && plan.reason !== "blocked") || !plan.kind) return { ...base, ok: false, reason: plan.reason, junctions: [], kind: plan.kind, destinationId: -1 };
      if (!apply) return { ...base, ok: true, reason: plan.existing ? "reuse" : "created", kind: plan.kind, junctions: [], destinationId: -1, cost: plan.existing ? 0 : cost };
      if (!plan.existing) {
        if (!charge(cost)) return { ...base, ok: false, reason: "credits", junctions: [], destinationId: -1 };
        const from = this.resolve({ buildingId: start.buildingId, port: "out" }, true);
        const to = this.resolve({ nodeId: end.nodeId }, true);
        if (!from || !to) return { ...base, ok: false, reason: "missing", junctions: [], destinationId: -1 };
        this.addEdge(from, to, points, travel, plan.kind, cost);
        this.rebuild();
      }
      return { ...base, ok: true, reason: plan.existing ? "reuse" : "created", kind: plan.kind, junctions: [], destinationId: -1, cost: plan.existing ? 0 : cost };
    }
    if (start.nodeId && end.buildingId >= 0 && crossings.length === 0) {
      const plan = this.plan({ nodeId: start.nodeId }, { buildingId: end.buildingId, port: "in" }, false);
      if ((!plan.ok && plan.reason !== "blocked") || !plan.kind) return { ...base, ok: false, reason: plan.reason, junctions: [], kind: plan.kind, sourceId: -1 };
      if (!apply) return { ...base, ok: true, reason: plan.existing ? "reuse" : "created", kind: plan.kind, junctions: [], sourceId: -1, cost: plan.existing ? 0 : cost };
      if (!plan.existing) {
        if (!charge(cost)) return { ...base, ok: false, reason: "credits", junctions: [], sourceId: -1 };
        const from = this.resolve({ nodeId: start.nodeId }, true);
        const to = this.resolve({ buildingId: end.buildingId, port: "in" }, true);
        if (!from || !to) return { ...base, ok: false, reason: "missing", junctions: [], sourceId: -1 };
        this.addEdge(from, to, points, travel, plan.kind, cost);
        this.rebuild();
      }
      return { ...base, ok: true, reason: plan.existing ? "reuse" : "created", kind: plan.kind, junctions: [], sourceId: -1, cost: plan.existing ? 0 : cost };
    }
    if (start.buildingId >= 0 && end.buildingId >= 0 && crossings.length === 0) {
      const plan = this.plan({ buildingId: start.buildingId, port: "out" }, { buildingId: end.buildingId, port: "in" }, false);
      if ((!plan.ok && plan.reason !== "blocked") || !plan.kind) return { ...base, ok: false, reason: plan.reason, junctions: [], kind: plan.kind };
      if (apply && !plan.existing) {
        if (!charge(cost)) return { ...base, ok: false, reason: "credits", junctions: [] };
        const from = this.resolve({ buildingId: start.buildingId, port: "out" }, true);
        const to = this.resolve({ buildingId: end.buildingId, port: "in" }, true);
        if (!from || !to) return { ...base, ok: false, reason: "missing", junctions: [] };
        this.addEdge(from, to, points, travel, plan.kind, cost);
        this.rebuild();
      }
      return { ...base, ok: true, reason: plan.existing ? "reuse" : "created", kind: plan.kind, junctions: [], cost: plan.existing ? 0 : cost };
    }
    if (start.buildingId >= 0 && end.edgeId && crossings.length === 0) {
      const edge = this.edges.find((item) => item.id === end.edgeId);
      const sourceKind = this.buildingKind(start.buildingId, "out");
      if (!edge || !sourceKind) return { ...base, ok: false, reason: "open", junctions: ["merge"] };
      if (sourceKind !== edge.kind) return { ...base, ok: false, reason: "cargo", kind: sourceKind, junctions: ["merge"] };
      const fromExisting = this.resolve({ buildingId: start.buildingId, port: "out" }, false);
      if (fromExisting && fromExisting.id > 0 && this.edges.some((item) => item.from === fromExisting.id)) return { ...base, ok: false, reason: "degree", kind: sourceKind, junctions: ["merge"] };
      if (this.reaches(edge.to, fromExisting && fromExisting.id > 0 ? fromExisting.id : -1)) return { ...base, ok: false, reason: "cycle", kind: sourceKind, junctions: ["merge"] };
      if (!apply) return { ...base, ok: true, reason: "created", kind: sourceKind, junctions: ["merge"] };
      if (!charge(cost)) return { ...base, ok: false, reason: "credits", kind: sourceKind, junctions: ["merge"] };
      const split = this.splitEdge(edge, end.distance, "merge");
      const from = this.resolve({ buildingId: start.buildingId, port: "out" }, true);
      if (!from) return { ...base, ok: false, reason: "missing", kind: sourceKind, junctions: ["merge"] };
      this.addEdge(from, split.node, points, travel, sourceKind, cost);
      this.rebuild();
      return { ...base, ok: true, reason: "created", kind: sourceKind, junctions: ["merge"] };
    }
    if (start.edgeId && end.buildingId >= 0 && crossings.length === 0) {
      const edge = this.edges.find((item) => item.id === start.edgeId);
      if (!edge) return { ...base, ok: false, reason: "open", junctions: ["split"] };
      if (!this.destinationAccepts(end.buildingId, edge.kind)) return { ...base, ok: false, reason: "cargo", kind: edge.kind, junctions: ["split"] };
      if (!apply) return { ...base, ok: true, reason: "created", kind: edge.kind, junctions: ["split"] };
      if (!charge(cost)) return { ...base, ok: false, reason: "credits", kind: edge.kind, junctions: ["split"] };
      const split = this.splitEdge(edge, start.distance, "split");
      const to = this.resolve({ buildingId: end.buildingId, port: "in" }, true);
      if (!to) return { ...base, ok: false, reason: "missing", kind: edge.kind, junctions: ["split"] };
      this.addEdge(split.node, to, points, travel, edge.kind, cost);
      this.rebuild();
      return { ...base, ok: true, reason: "created", kind: edge.kind, junctions: ["split"] };
    }
    if (start.buildingId >= 0 && end.buildingId >= 0 && crossings.length === 1) {
      const hit = crossings[0];
      const sourceKind = this.buildingKind(start.buildingId, "out");
      if (!sourceKind || !this.destinationAccepts(end.buildingId, sourceKind)) return { ...base, ok: false, reason: "cargo", kind: sourceKind, junctions: ["cross"] };
      const fromExisting = this.resolve({ buildingId: start.buildingId, port: "out" }, false);
      if (fromExisting && fromExisting.id > 0 && this.edges.some((item) => item.from === fromExisting.id)) return { ...base, ok: false, reason: "degree", kind: sourceKind, junctions: ["cross"] };
      if (!apply) return { ...base, ok: true, reason: "created", kind: sourceKind, junctions: ["cross"] };
      if (!charge(cost)) return { ...base, ok: false, reason: "credits", kind: sourceKind, junctions: ["cross"] };
      const crossed = this.edges.find((item) => item.id === hit.edgeId)!;
      const split = this.splitEdge(crossed, hit.distance, "cross");
      const before = [...points.slice(0, hit.strokeIndex), { x: hit.x, z: hit.z }];
      const after = [{ x: hit.x, z: hit.z }, ...points.slice(hit.strokeIndex)];
      const from = this.resolve({ buildingId: start.buildingId, port: "out" }, true)!;
      const to = this.resolve({ buildingId: end.buildingId, port: "in" }, true)!;
      const head = this.addEdge(from, split.node, before, before.length > 3 ? this.shape(before) : this.smooth(before), sourceKind, cost);
      const tail = this.addEdge(split.node, to, after, after.length > 3 ? this.shape(after) : this.smooth(after), sourceKind, 0);
      split.node.order = [crossed.id, split.tail.id, head.id, tail.id];
      this.rebuild();
      return { ...base, ok: true, reason: "created", kind: sourceKind, junctions: ["cross"] };
    }
    if (start.edgeId && end.edgeId && start.edgeId !== end.edgeId && crossings.length === 0) {
      const source = this.edges.find((item) => item.id === start.edgeId);
      const target = this.edges.find((item) => item.id === end.edgeId);
      if (!source || !target || source.kind !== target.kind) return { ...base, ok: false, reason: "cargo", kind: source?.kind ?? null, junctions: ["split", "merge"] };
      if (!apply) return { ...base, ok: true, reason: "created", kind: source.kind, junctions: ["split", "merge"] };
      if (!charge(cost)) return { ...base, ok: false, reason: "credits", kind: source.kind, junctions: ["split", "merge"] };
      const split = this.splitEdge(source, start.distance, "split");
      const merge = this.splitEdge(target, end.distance, "merge");
      this.addEdge(split.node, merge.node, points, travel, source.kind, cost);
      this.rebuild();
      return { ...base, ok: true, reason: "created", kind: source.kind, junctions: ["split", "merge"] };
    }
    return { ...base, ok: false, reason: "open", junctions: [] };
  }
  private snapEnd(point: RailPathPoint, toward: RailPathPoint, prefer: "out" | "in"): { buildingId: number; edgeId: number; nodeId: number; x: number; z: number; distance: number } | null {
    if (Math.hypot(point.x - GAME.depot.x, point.z - GAME.depot.z) <= 4.2 && prefer === "in") return { buildingId: 0, edgeId: 0, nodeId: 0, x: GAME.depot.x, z: GAME.depot.z - 1.7, distance: 0 };
    const building = this.buildings.items
      .filter((item) => (item.type === "sweeper" || item.type === "purifier" || item.type === "press") && Math.hypot(point.x - item.x, point.z - item.z) < 3.15)
      .sort((a, b) => Math.hypot(point.x - a.x, point.z - a.z) - Math.hypot(point.x - b.x, point.z - b.z))[0];
    if (building && (prefer === "out" || building.type !== "sweeper")) {
      const dx = toward.x - building.x, dz = toward.z - building.z, len = Math.hypot(dx, dz) || 1;
      const radius = BUILDINGS[building.type].radius * (building.type === "purifier" ? 0.7 : 0.55);
      return { buildingId: building.id, edgeId: 0, nodeId: 0, x: building.x + dx / len * radius, z: building.z + dz / len * radius, distance: 0 };
    }
    const junction = this.hit(point.x, point.z, 2.2);
    if (junction) return { buildingId: -1, edgeId: 0, nodeId: junction.id, x: junction.x, z: junction.z, distance: 0 };
    const edge = this.nearestEdge(point.x, point.z, 1.35);
    if (!edge || edge.distance < 0.45 || edge.distance > edge.edge.total - 0.45) return building ? { buildingId: building.id, edgeId: 0, nodeId: 0, x: building.x, z: building.z, distance: 0 } : null;
    return { buildingId: -1, edgeId: edge.edge.id, nodeId: 0, x: edge.x, z: edge.z, distance: edge.distance };
  }
  private nearestEdge(x: number, z: number, range: number): { edge: NetEdge; x: number; z: number; distance: number; gap: number } | null {
    let best: { edge: NetEdge; x: number; z: number; distance: number; gap: number } | null = null;
    for (const edge of this.edges) {
      for (let i = 1; i < edge.travel.length; i++) {
        const a = edge.travel[i - 1], b = edge.travel[i];
        const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz;
        const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
        const px = a.x + abx * t, pz = a.z + abz * t, gap = Math.hypot(x - px, z - pz);
        if (gap > range || (best && gap >= best.gap)) continue;
        const along = (edge.lengths[i - 1] ?? 0) + Math.hypot(px - a.x, pz - a.z);
        best = { edge, x: px, z: pz, distance: along, gap };
      }
    }
    return best;
  }
  private strokeCrossings(points: RailPathPoint[], ignore: Set<number>): Array<{ edgeId: number; x: number; z: number; distance: number; strokeIndex: number; angle: number }> {
    const hits: Array<{ edgeId: number; x: number; z: number; distance: number; strokeIndex: number; angle: number }> = [];
    for (const edge of this.edges) {
      if (ignore.has(edge.id)) continue;
      for (let i = 1; i < points.length; i++) for (let j = 1; j < edge.travel.length; j++) {
        const hit = this.segments(points[i - 1], points[i], edge.travel[j - 1], edge.travel[j]);
        if (!hit) continue;
        const rx = points[i].x - points[i - 1].x, rz = points[i].z - points[i - 1].z;
        const qx = edge.travel[j].x - edge.travel[j - 1].x, qz = edge.travel[j].z - edge.travel[j - 1].z;
        const angle = Math.atan2(Math.abs(rx * qz - rz * qx), Math.abs(rx * qx + rz * qz)) * 180 / Math.PI;
        if (angle < 32) continue;
        if (Math.hypot(hit.x - points[0].x, hit.z - points[0].z) < 3.4 || Math.hypot(hit.x - points[points.length - 1].x, hit.z - points[points.length - 1].z) < 3.4) continue;
        const along = (edge.lengths[j - 1] ?? 0) + Math.hypot(hit.x - edge.travel[j - 1].x, hit.z - edge.travel[j - 1].z);
        if (along < 0.6 || along > edge.total - 0.6) continue;
        hits.push({ edgeId: edge.id, x: hit.x, z: hit.z, distance: along, strokeIndex: i, angle });
      }
    }
    return hits;
  }
  private strokeHitsBuilding(points: RailPathPoint[], ignore: Set<number>): boolean {
    const obstacles = this.buildings.items.filter((building) => !ignore.has(building.id)).map((building) => ({ x: building.x, z: building.z, radius: BUILDINGS[building.type].radius }));
    return this.hitsBuilding(points, obstacles, points[0], points[points.length - 1]);
  }
  private buildingKind(buildingId: number, port: "out" | "in"): CargoKind | null {
    if (buildingId < 0) return null;
    if (buildingId === 0) return port === "in" ? "purified" : null;
    const building = this.buildings.byId(buildingId);
    return building ? this.buildings.cargoKind(building) : null;
  }
  private destinationAccepts(buildingId: number, kind: CargoKind): boolean {
    if (buildingId === 0) return kind === "purified" || kind === "ice";
    const building = this.buildings.byId(buildingId);
    return !!building && ((building.type === "purifier" && kind === "raw") || (building.type === "press" && kind === "purified"));
  }
  private endpointBuilding(edge: NetEdge, side: "from" | "to"): number {
    let guard = 0;
    let current = edge;
    while (guard++ < 8) {
      const node = this.nodes.find((item) => item.id === (side === "from" ? current.from : current.to));
      if (!node) return -1;
      if (node.kind === "in" || node.kind === "out") return node.buildingId;
      const next = this.edges.find((item) => side === "from" ? item.to === node.id && item.id !== current.id : item.from === node.id && item.id !== current.id);
      if (!next) return -1;
      current = next;
    }
    return -1;
  }
  private splitEdge(edge: NetEdge, distance: number, kind: "merge" | "split" | "cross"): { node: NetNode; tail: NetEdge } {
    const dist = Math.max(0.45, Math.min(edge.total - 0.45, distance));
    const at = this.pointAt(edge, dist);
    const node = this.addNode(kind, at.x, at.z, 0);
    let index = 1;
    while (index < edge.lengths.length - 1 && edge.lengths[index] < dist) index++;
    const headTravel = [...edge.travel.slice(0, index), { x: at.x, z: at.z }];
    const tailTravel = [{ x: at.x, z: at.z }, ...edge.travel.slice(index)];
    const oldTo = edge.to;
    edge.to = node.id;
    edge.points = headTravel.map((point) => ({ ...point }));
    const headMeasured = this.measure(headTravel);
    edge.travel = headMeasured.points; edge.lengths = headMeasured.lengths; edge.total = headMeasured.total;
    const dest = this.nodes.find((item) => item.id === oldTo)!;
    const tail = this.addEdge(node, dest, tailTravel, tailTravel, edge.kind, 0);
    if (dest.kind === "merge" || dest.kind === "cross") dest.order = [...new Set(dest.order.map((id) => id === edge.id ? tail.id : id))];
    if (kind === "merge") node.order = [...new Set([...node.order, edge.id])];
    for (const capsule of this.capsules) if (capsule.edgeId === edge.id && capsule.distance >= dist) {
      capsule.edgeId = tail.id;
      capsule.distance = Math.max(0, capsule.distance - dist);
    }
    return { node, tail };
  }
  private collapseJunctions(): void {
    for (const node of [...this.nodes]) {
      if (node.kind !== "merge" && node.kind !== "split" && node.kind !== "cross") continue;
      const incoming = this.edges.filter((edge) => edge.to === node.id);
      const outgoing = this.edges.filter((edge) => edge.from === node.id);
      if (!incoming.length && !outgoing.length) { this.nodes = this.nodes.filter((item) => item.id !== node.id); continue; }
      if (node.kind === "cross" || incoming.length !== 1 || outgoing.length !== 1) continue;
      if (this.capsules.some((capsule) => capsule.edgeId === incoming[0].id || capsule.edgeId === outgoing[0].id)) continue;
      const head = incoming[0];
      const tail = outgoing[0];
      head.to = tail.to;
      head.points = [...head.travel, ...tail.travel.slice(1)];
      const measured = this.measure(this.shape(head.points.length > 3 ? head.points : [head.points[0], head.points[head.points.length - 1]]));
      head.travel = measured.points; head.lengths = measured.lengths; head.total = measured.total;
      const dest = this.nodes.find((item) => item.id === tail.to);
      if (dest) dest.order = dest.order.map((id) => id === tail.id ? head.id : id);
      this.edges = this.edges.filter((edge) => edge.id !== tail.id);
      this.nodes = this.nodes.filter((item) => item.id !== node.id);
    }
  }
  private writeRibbon(mesh: THREE.Mesh, positions: number[], indices: number[]): void {
    mesh.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    mesh.geometry = geometry; mesh.visible = positions.length > 0;
  }
  private crossing(a: NetEdge, b: NetEdge): RailPathPoint | null {
    for (let i = 1; i < a.travel.length; i++) for (let j = 1; j < b.travel.length; j++) {
      const hit = this.segments(a.travel[i - 1], a.travel[i], b.travel[j - 1], b.travel[j]);
      if (hit) return hit;
    }
    return null;
  }
  private segments(a: RailPathPoint, b: RailPathPoint, c: RailPathPoint, d: RailPathPoint): RailPathPoint | null {
    const rx = b.x - a.x, rz = b.z - a.z, qx = d.x - c.x, qz = d.z - c.z, den = rx * qz - rz * qx;
    if (Math.abs(den) < 1e-5) return null;
    const t = ((c.x - a.x) * qz - (c.z - a.z) * qx) / den; const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
    if (t <= 0.08 || t >= 0.92 || u <= 0.08 || u >= 0.92) return null;
    return { x: a.x + rx * t, z: a.z + rz * t };
  }
}
