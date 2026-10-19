import { newRelay, newBusRelay, ensureRelays } from '../model.js';
import { ensureProtectionSet } from '../data/protectionCatalog.js';
import { evaluateRelayProtections, evaluationSummary } from './protectionFunctions.js';
import { runShortCircuit } from './shortcircuit.js';

const CT_RATIOS = [100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000];
const CURVES = {
  standard: { label: '标准反时限 IEC SI', A: 0.14, B: 0.02 },
  very: { label: '非常反时限 IEC VI', A: 13.5, B: 1 },
  extreme: { label: '极端反时限 IEC EI', A: 80, B: 2 },
  long: { label: '长反时限 IEC LI', A: 120, B: 1 },
  definite: { label: '定时限 DT', A: 0, B: 0 }
};

export const OC_CURVES = Object.entries(CURVES).map(([id, c]) => ({ id, label: c.label }));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundUp = (v, step = 5) => Math.ceil(v / step) * step;

function gradingCurrent(a, b) {
  const pickup = Math.max(a.overcurrent.pickup, b.overcurrent.pickup);
  const inst = [a.overcurrent.instPickup, b.overcurrent.instPickup].filter((x) => Number(x) > 0);
  const base = pickup * 4;
  if (!inst.length) return base;
  const cap = Math.min(...inst) * 0.85;
  return cap > pickup * 1.5 ? Math.min(base, cap) : base;
}

function branchRatedCurrent(branch, project) {
  if (branch.type === 'transformer') {
    const a = project.buses.find((b) => b.id === branch.from);
    const b = project.buses.find((x) => x.id === branch.to);
    const v1 = Number(branch.vn1) || a?.vn || 110;
    const v2 = Number(branch.vn2) || b?.vn || 110;
    const sn = Number(branch.sn) || 100;
    return Math.max(sn * 1e6 / (Math.sqrt(3) * v1 * 1e3), sn * 1e6 / (Math.sqrt(3) * v2 * 1e3));
  }
  const vn = Number(branch.voltageClass) || project.buses.find((b) => b.id === branch.from)?.vn || 110;
  const mva = Number(branch.ratingMVA) || 100;
  return (mva * 1e6) / (Math.sqrt(3) * vn * 1e3);
}

export function lineZPrimary(branch) {
  if (!branch || branch.type !== 'line') return 0;
  if (branch.paramMode === 'distributed') {
    const L = Number(branch.length) || 0;
    return Math.hypot((Number(branch.rPerKm) || 0) * L, (Number(branch.xPerKm) || 0) * L);
  }
  return Math.hypot(Number(branch.R) || 0, Number(branch.X) || 0);
}

export function relayMeasuredLoad(project, relay, result) {
  if (relay.targetType === 'bus') {
    const bus = project.buses.find((b) => b.id === relay.busId);
    const row = result?.busResults?.find((b) => b.busId === relay.busId);
    const rated = Math.max(100, Number(relay.ct?.primary) * 0.8 || 1600);
    const current = Math.abs(Number(row?.pLoad) || 0) * 1e6 / (Math.sqrt(3) * (Number(bus?.vn) || 110) * 1e3) || rated * 0.4;
    return { current, branch: null, bus, rated, load: current };
  }
  const branch = project.branches.find((b) => b.id === relay.branchId);
  if (!branch) return { current: 0, branch: null, rated: 0 };
  const rated = branchRatedCurrent(branch, project);
  let measured = 0;
  if (result?.branchResults) {
    const br = result.branchResults.find((b) => b.id === branch.id);
    if (br) measured = Math.max(br.iFrom || 0, br.iTo || 0) * 1000;
  }
  const current = Math.max(measured, 0);
  return { current, branch, rated, load: Math.max(current, rated * 0.55) };
}

function pickCT(currentA, ratedA) {
  const required = Math.max(currentA * 1.25, ratedA * 1.2, 50);
  return CT_RATIOS.find((x) => x >= required) || CT_RATIOS[CT_RATIOS.length - 1];
}

function branchGraph(project) {
  const adj = new Map();
  for (const b of project.buses) adj.set(b.id, new Set());
  const active = project.branches.filter((b) => ['line', 'transformer'].includes(b.type) && b.status === 'in' && b.fromSwitch !== 'open' && b.toSwitch !== 'open');
  for (const br of active) {
    if (!adj.has(br.from) || !adj.has(br.to)) continue;
    adj.get(br.from).add(br.to);
    adj.get(br.to).add(br.from);
  }
  return { adj, active };
}

export function branchLevels(project) {
  const slacks = project.buses.filter((b) => b.type === 'slack').map((b) => b.id);
  const { adj, active } = branchGraph(project);
  const dist = new Map();
  const queue = [];
  for (const s of slacks) { dist.set(s, 0); queue.push(s); }
  while (queue.length) {
    const u = queue.shift();
    for (const v of adj.get(u) || []) {
      if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); queue.push(v); }
    }
  }
  const levels = new Map();
  let maxLevel = 1;
  for (const br of active) {
    const d = Math.min(dist.get(br.from) ?? 5, dist.get(br.to) ?? 5);
    const level = d + 1;
    levels.set(br.id, level);
    maxLevel = Math.max(maxLevel, level);
  }
  return { levels, maxLevel, dist };
}

function adjacentLines(project, branch) {
  return project.branches.filter((b) => b.id !== branch.id && b.type === 'line' && b.status === 'in' && (b.from === branch.from || b.from === branch.to || b.to === branch.from || b.to === branch.to));
}

/**
 * Engineer-style automatic setting. It selects CT ratios from load current, sets
 * distance reaches from the protected line, and grades inverse-time backup
 * protection by electrical depth. Results are clearly editable afterwards.
 */
export function autoSetRelay(project, relay, context = {}) {
  if (relay.targetType === 'bus') return { relay, changes: [] };
  const branch = project.branches.find((b) => b.id === relay.branchId);
  if (!branch) return { relay, changes: [] };
  const { result, level = 1, maxLevel = 3, faultCurrentA = null } = context;
  const before = JSON.parse(JSON.stringify(relay));
  const measured = relayMeasuredLoad(project, relay, result);
  const rated = measured.rated;
  const ct = pickCT(measured.current, rated);
  relay.ct = { primary: ct, secondary: 5 };
  const bus = project.buses.find((b) => b.id === branch.from);
  const vn = branch.type === 'line' ? (Number(branch.voltageClass) || bus?.vn || 110) : (Number(branch.vn1) || bus?.vn || 110);
  relay.vt = { primary: vn, secondary: 0.1 };
  const depth = Math.max(0, maxLevel - level);
  const tms = clamp(0.12 + 0.045 * depth, 0.1, 0.5);
  const loadForPickup = Math.max(measured.current, rated * 0.9);
  const pickup = roundUp(loadForPickup * 1.3, 5);
  relay.overcurrent.pickup = pickup;
  relay.overcurrent.curve = 'standard';
  relay.overcurrent.tms = Number(tms.toFixed(3));
  relay.overcurrent.instPickup = roundUp(Math.max(rated * 6, pickup * 4), 50);
  relay.overcurrent.instTime = 0.05;

  if (branch.type === 'line') {
    const z = lineZPrimary(branch);
    const adjZ = Math.max(0, ...adjacentLines(project, branch).map(lineZPrimary));
    const z3base = z + Math.max(z * 0.5, adjZ * 0.8);
    relay.distance.z1 = Number((z * 0.8).toFixed(3));
    const z2base = z + Math.max(z * 0.2, adjZ * 0.5);
    relay.distance.z2 = Number(Math.min(z * 1.6, z2base).toFixed(3));
    relay.distance.z3 = Number(Math.min(z * 2.5, z3base * 1.2).toFixed(3));
    relay.distance.t1 = 0;
    relay.distance.t2 = 0.4;
    relay.distance.t3 = 1.2;
    relay.distance.angle = 78;
    relay.functions.distance = true;
    relay.functions.overcurrent = true;
    delete relay.functions.differential;
  } else {
    relay.differential.pickup = 0.3;
    relay.differential.slope1 = 0.3;
    relay.differential.slope2 = 0.7;
    relay.differential.t = 0.03;
    relay.differential.t2 = 0.45;
    relay.differential.harmonicBlock = 15;
    relay.functions.differential = true;
    relay.functions.overcurrent = true;
    delete relay.functions.distance;
  }
  if (faultCurrentA && faultCurrentA > pickup) {
    // Keep the instantaneous element above the maximum through-fault current only
    // when it would otherwise be set dangerously low.
    relay.overcurrent.instPickup = roundUp(Math.max(relay.overcurrent.instPickup, faultCurrentA * 1.15), 50);
  }
  ensureProtectionSet(relay, branch.type === 'line' ? 'line' : 'transformer', { z: branch.type === 'line' ? lineZPrimary(branch) : 0, length: Number(branch.length) || 30, rated });
  if (relay.protections) {
    if (branch.type === 'line') {
      relay.protections.line_distance.enabled = !!relay.functions.distance;
      relay.protections.line_overcurrent.enabled = !!relay.functions.overcurrent;
      relay.protections.line_reclose.enabled = relay.reclose?.enabled !== false;
    } else {
      relay.protections.xfmr_differential.enabled = !!relay.functions.differential;
      relay.protections.xfmr_overcurrent.enabled = !!relay.functions.overcurrent;
    }
  }
  relay.mode = 'auto';
  relay.lastAutoAt = new Date().toISOString();
  const changes = [];
  for (const key of ['ct', 'vt', 'distance', 'overcurrent', 'differential']) {
    if (JSON.stringify(before[key]) !== JSON.stringify(relay[key])) changes.push(key);
  }
  return { relay, changes, ct };
}

export function autoSetAll(project, result = null) {
  ensureRelays(project);
  const { levels, maxLevel } = branchLevels(project);
  const used = new Set(project.relays.filter((r) => r.targetType !== 'bus').map((r) => r.branchId));
  for (const br of project.branches.filter((b) => ['line', 'transformer'].includes(b.type))) {
    if (!used.has(br.id)) {
      const relay = newRelay(br);
      project.relays.push(relay);
      used.add(br.id);
    }
  }
  const summary = { count: 0, changedFields: 0, byType: { line: 0, transformer: 0, bus: 0 }, coordinated: 0 };
  for (const relay of project.relays) {
    if (relay.targetType === 'bus') continue;
    const branch = project.branches.find((b) => b.id === relay.branchId);
    if (!branch) continue;
    if (!relay.enabled) continue;
    const res = autoSetRelay(project, relay, {
      result,
      level: levels.get(branch.id) || 1,
      maxLevel
    });
    summary.count++;
    summary.changedFields += res.changes.length;
    summary.byType[branch.type] = (summary.byType[branch.type] || 0) + 1;
  }

  // Explicit time grading across every shared bus. The electrical-depth setting is
  // only a seed; here we make the upstream inverse-time curve slower than the
  // downstream curve by at least 0.30 s at a common through-fault current.
  const activeRelays = project.relays.filter((r) => r.enabled && r.targetType !== 'bus' && r.functions?.overcurrent);
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let i = 0; i < activeRelays.length; i++) {
      for (let j = i + 1; j < activeRelays.length; j++) {
        const a = activeRelays[i];
        const b = activeRelays[j];
        const ba = project.branches.find((x) => x.id === a.branchId);
        const bb = project.branches.find((x) => x.id === b.branchId);
        if (!ba || !bb) continue;
        const shared = [ba.from, ba.to].find((id) => id === bb.from || id === bb.to);
        if (!shared) continue;
        const la = levels.get(ba.id) || 1;
        const lb = levels.get(bb.id) || 1;
        if (la === lb) continue;
        const down = la > lb ? a : b;
        const up = la > lb ? b : a;
        const current = gradingCurrent(up, down);
        if (current <= up.overcurrent.pickup * 1.02) continue;
        const tDown = relayTripTimeSeconds(down, current);
        if (!Number.isFinite(tDown)) continue;
        const tUp = relayTripTimeSeconds(up, current);
        if (Number.isFinite(tUp) && tUp >= tDown + 0.3) continue;
        const curve = CURVES[up.overcurrent.curve] || CURVES.standard;
        if (up.overcurrent.curve === 'definite') {
          up.overcurrent.tms = Math.min(5, tDown + 0.3);
        } else {
          const m = current / up.overcurrent.pickup;
          const target = tDown + 0.305;
          const needed = target * (Math.pow(m, curve.B) - 1) / curve.A;
          up.overcurrent.tms = Number(clamp(needed, up.overcurrent.tms, 3).toFixed(3));
        }
        changed++;
      }
    }
    summary.coordinated += changed;
    if (!changed) break;
  }
  return summary;
}

export function resetRelayToFactory(project, relay) {
  if (relay.targetType === 'bus') {
    const bus = project.buses.find((b) => b.id === relay.busId);
    if (!bus) return relay;
    const next = newBusRelay(bus, { id: relay.id, busId: relay.busId, name: relay.name, enabled: relay.enabled });
    Object.assign(relay, next);
    return relay;
  }
  const branch = project.branches.find((b) => b.id === relay.branchId);
  if (!branch) return relay;
  const next = newRelay(branch, { id: relay.id, branchId: relay.branchId, name: relay.name, enabled: relay.enabled });
  Object.assign(relay, next);
  return relay;
}

export function protectionIssues(project, relay, result = null) {
  const issues = [];
  const isBus = relay.targetType === 'bus';
  const branch = isBus ? null : project.branches.find((b) => b.id === relay.branchId);
  const bus = isBus ? project.buses.find((b) => b.id === relay.busId) : null;
  if (isBus && !bus) return [{ level: 'error', msg: '保护对应的母线不存在。' }];
  if (!isBus && !branch) return [{ level: 'error', msg: '保护对应的支路不存在。' }];
  const measured = relayMeasuredLoad(project, relay, result);
  if (!relay.enabled) return [{ level: 'info', msg: '该保护已退出运行。' }];
  if (!(relay.ct.primary > 0) || !(relay.ct.secondary > 0)) issues.push({ level: 'error', msg: 'CT 变比无效。' });
  if (relay.ct.primary < measured.current * 1.1) issues.push({ level: 'warning', msg: `CT 一次额定 ${relay.ct.primary} A 小于最大负荷电流，可能饱和。` });
  if (relay.functions.overcurrent) {
    const pickup = relay.overcurrent.pickup;
    if (!(pickup > 0)) issues.push({ level: 'error', msg: '过流保护定值必须大于 0。' });
    if (pickup < measured.rated * 1.05) issues.push({ level: 'warning', msg: '过流定值接近或低于设备额定电流，可能误动。' });
    if (pickup > measured.rated * 2.5) issues.push({ level: 'warning', msg: '过流定值偏高，需校验末端故障灵敏度。' });
    if (!(relay.overcurrent.tms > 0)) issues.push({ level: 'error', msg: '时间倍率 TMS 必须大于 0。' });
    if (relay.overcurrent.instPickup > 0 && relay.overcurrent.instPickup <= relay.overcurrent.pickup) {
      issues.push({ level: 'warning', msg: '速断定值应大于过流启动值。' });
    }
  }
  if (!isBus && branch.type === 'line' && relay.functions.distance) {
    const z = lineZPrimary(branch);
    if (!(relay.distance.z1 > 0 && relay.distance.z1 < relay.distance.z2 && relay.distance.z2 < relay.distance.z3)) {
      issues.push({ level: 'error', msg: '距离保护定值应满足 0 < Z1 < Z2 < Z3。' });
    }
    if (relay.distance.z1 > z) issues.push({ level: 'warning', msg: 'I 段阻抗大于线路全长阻抗，存在超越风险。' });
    if (relay.distance.z1 < z * 0.6) issues.push({ level: 'info', msg: 'I 段保护范围不足线路全长的 60%。' });
    if (!(relay.distance.t1 <= relay.distance.t2 && relay.distance.t2 <= relay.distance.t3)) {
      issues.push({ level: 'error', msg: '距离保护时间应满足 t1 ≤ t2 ≤ t3。' });
    }
  }
  if (!isBus && branch.type === 'transformer' && relay.functions?.differential) {
    if (!(relay.differential.pickup > 0.05 && relay.differential.pickup < 1.0)) {
      issues.push({ level: 'warning', msg: '差动启动值建议在 0.05–1.0 Ie 范围内。' });
    }
    if (relay.differential.slope1 >= relay.differential.slope2) {
      issues.push({ level: 'warning', msg: '差动斜率 1 应小于斜率 2。' });
    }
    if (!(relay.differential.harmonicBlock >= 10)) issues.push({ level: 'info', msg: '二次谐波制动建议不低于 10%。' });
  }
  const evalRows = evaluateRelayProtections(project, relay, result);
  for (const row of evalRows) {
    if (row.status === 'error') issues.push({ level: 'error', msg: `${row.name}：${row.message}` });
    else if (row.status === 'warn') issues.push({ level: 'warning', msg: `${row.name}：${row.message}` });
  }
  if (!issues.some((i) => i.level === 'error' || i.level === 'warning')) issues.push({ level: 'ok', msg: `整定值通过规则校验，已配置 ${evaluationSummary(evalRows).enabled} 项保护功能。` });
  return issues;
}

export function relayTripTimeSeconds(relay, currentPrimary) {
  if (!relay?.enabled) return Infinity;
  const oc = relay.overcurrent;
  if (!oc || !(oc.pickup > 0)) return Infinity;
  if (oc.instPickup > 0 && currentPrimary >= oc.instPickup) return Math.max(0.01, oc.instTime || 0.05);
  const m = currentPrimary / oc.pickup;
  if (m <= 1.02) return Infinity;
  const curve = CURVES[oc.curve] || CURVES.standard;
  if (oc.curve === 'definite') return Math.max(0.01, oc.tms || 0.2);
  return (oc.tms * curve.A) / (Math.pow(m, curve.B) - 1);
}

export function curveLabel(id) {
  return CURVES[id]?.label || id;
}

export function relaySecondaryOhms(relay, primaryOhm) {
  const ctr = (relay.ct.primary || 1) / (relay.ct.secondary || 5);
  const vtr = (relay.vt.primary || 110) / (relay.vt.secondary || 0.1);
  return primaryOhm * ctr / vtr;
}

export function coordinationChecks(project, result, faultCurrentA = null) {
  const checks = [];
  const { levels } = branchLevels(project);
  const active = project.relays.filter((r) => r.enabled && r.targetType !== 'bus' && r.functions?.overcurrent);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const ba = project.branches.find((x) => x.id === a.branchId);
      const bb = project.branches.find((x) => x.id === b.branchId);
      if (!ba || !bb) continue;
      const shared = [ba.from, ba.to].filter((id) => id === bb.from || id === bb.to);
      if (!shared.length) continue;
      if ((levels.get(ba.id) || 1) === (levels.get(bb.id) || 1)) continue;
      const current = faultCurrentA || gradingCurrent(a, b);
      const ta = relayTripTimeSeconds(a, current);
      const tb = relayTripTimeSeconds(b, current);
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) continue;
      const diff = Math.abs((Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity));
      checks.push({
        a: a.name, b: b.name, sharedBus: project.buses.find((x) => x.id === shared[0])?.name || '',
        current, ta, tb, margin: diff,
        ok: diff >= 0.3,
        level: diff >= 0.3 ? 'ok' : 'warning',
        msg: diff >= 0.3 ? `时间级差 ${diff.toFixed(2)} s，满足 0.30 s 要求。` : `时间级差仅 ${diff.toFixed(2)} s，小于 0.30 s，需调整 TMS。`
      });
    }
  }
  return checks;
}

export function relayForBranch(project, branchId) {
  return project.relays.find((r) => r.branchId === branchId) || null;
}

export function protectionSummary(project, result) {
  const relays = project.relays.filter((r) => r.enabled);
  let warnings = 0;
  let errors = 0;
  const perRelay = {};
  for (const r of relays) {
    const issues = protectionIssues(project, r, result);
    perRelay[r.id] = issues;
    warnings += issues.filter((x) => x.level === 'warning').length;
    errors += issues.filter((x) => x.level === 'error').length;
  }
  const checks = coordinationChecks(project, result);
  return { count: relays.length, warnings, errors, perRelay, checks };
}

export function makeAutoLog(project, summary) {
  return `自动整定完成：${summary.count} 套保护（线路 ${summary.byType.line || 0}，变压器 ${summary.byType.transformer || 0}），更新字段 ${summary.changedFields} 项。定值按负荷电流、CT 变比、线路阻抗与电气深度分级生成。`;
}

export { CURVES, branchRatedCurrent };

/**
 * Protection sensitivity / reach screening. For each relay the protected
 * branch is faulted at its remote terminal (near) and at the next downstream
 * bus (far). Three-phase currents are obtained from the short-circuit engine
 * and compared with the overcurrent pickup and distance reaches.
 */
export function runProtectionSensitivityScan(project, options = {}) {
  const opts = {
    c: 1.1,
    sourceMVA: Number(project.meta?.sourceMVA) || 12000,
    includeMotors: false,
    ...options
  };
  const cache = new Map();
  const scAt = (busId) => {
    if (!busId) return null;
    if (cache.has(busId)) return cache.get(busId);
    let value = null;
    try {
      value = runShortCircuit(project, {
        busId, faultType: '3ph', c: opts.c, sourceMVA: opts.sourceMVA,
        includeMotors: opts.includeMotors, includeGenerators: true
      });
    } catch (e) {
      value = { error: e.message };
    }
    cache.set(busId, value);
    return value;
  };
  const activeBranches = project.branches.filter((b) => ['line', 'transformer'].includes(b.type) && b.status === 'in' && b.fromSwitch !== 'open' && b.toSwitch !== 'open');
  const busById = new Map(project.buses.map((b) => [b.id, b]));
  const rows = [];
  for (const relay of project.relays.filter((r) => r.enabled && r.targetType !== 'bus')) {
    const branch = project.branches.find((b) => b.id === relay.branchId);
    if (!branch) continue;
    const from = busById.get(branch.from);
    const to = busById.get(branch.to);
    if (!from || !to) continue;
    const nextCandidates = activeBranches
      .filter((b) => b.id !== branch.id && (b.from === branch.to || b.to === branch.to))
      .map((b) => ({ branch: b, otherId: b.from === branch.to ? b.to : b.from }))
      .filter((x) => x.otherId !== branch.from && busById.has(x.otherId));
    nextCandidates.sort((a, b) => (lineZPrimary(a.branch) || 999) - (lineZPrimary(b.branch) || 999));
    const next = nextCandidates[0] || null;
    const nearBus = to;
    const farBus = next ? busById.get(next.otherId) : to;
    const nearSc = scAt(nearBus.id);
    const farSc = scAt(farBus.id);
    const branchCurrent = (sc) => {
      if (!sc || sc.error) return null;
      const row = sc.branchCurrents?.find((x) => x.id === branch.id);
      if (row) return Math.max(row.iFrom || 0, row.iTo || 0);
      return sc.Ik || 0;
    };
    const nearI = branchCurrent(nearSc);
    const farI = branchCurrent(farSc);
    const pickup = Number(relay.overcurrent?.pickup) || 0;
    const ksenNear = pickup > 0 && nearI != null ? nearI * 1000 / pickup : null;
    const ksenFar = pickup > 0 && farI != null ? farI * 1000 / pickup : null;
    const zLine = branch.type === 'line' ? lineZPrimary(branch) : 0;
    const z1 = Number(relay.distance?.z1) || 0;
    const z2 = Number(relay.distance?.z2) || 0;
    const z3 = Number(relay.distance?.z3) || 0;
    const nextZ = next ? lineZPrimary(next.branch) : 0;
    const remoteZ = zLine + Math.max(0, nextZ) * 0.5;
    const z1Ratio = zLine > 0 ? z1 / zLine : null;
    const z2Ratio = zLine > 0 ? z2 / zLine : null;
    const z3Ratio = zLine > 0 ? z3 / zLine : null;
    const z2Covers = zLine > 0 && z2 > 0 ? z2 >= remoteZ * 0.95 : null;
    const z3Covers = zLine > 0 && z3 > 0 ? z3 >= (zLine + Math.max(0, nextZ)) * 0.95 : null;
    const issues = [];
    const hasOC = relay.functions?.overcurrent !== false;
    const hasDistance = branch.type === 'line' && relay.functions?.distance !== false;
    if (hasOC && pickup <= 0) issues.push({ level: 'error', msg: '过流定值无效。' });
    if (hasOC && ksenNear != null && ksenNear < 1.3) issues.push({ level: 'warning', msg: `本线末端灵敏度 Ksen=${ksenNear.toFixed(2)} < 1.30。` });
    if (hasOC && ksenFar != null && ksenFar < 1.2) issues.push({ level: 'error', msg: `远后备灵敏度 Ksen=${ksenFar.toFixed(2)} < 1.20。` });
    if (hasDistance && zLine > 0) {
      if (z1Ratio != null && (z1Ratio < 0.7 || z1Ratio > 0.95)) issues.push({ level: 'warning', msg: `距离 I 段范围 ${(z1Ratio * 100).toFixed(0)}%，建议 70–95%。` });
      if (z2Covers === false) issues.push({ level: 'warning', msg: '距离 II 段未覆盖相邻线路。' });
      if (z3Covers === false) issues.push({ level: 'warning', msg: '距离 III 段未覆盖相邻线路。' });
    }
    if (branch.type === 'transformer' && !hasOC) issues.push({ level: 'info', msg: '该变压器仅配置差动保护，本表不校核灵敏度。' });
    rows.push({
      relayId: relay.id, relayName: relay.name, branchId: branch.id, branchName: branch.name, branchTag: branch.tag,
      branchType: branch.type, fromName: from.name, toName: to.name,
      nearBus: nearBus.name, farBus: farBus.name, nextLine: next?.branch?.name || null,
      nearFaultKA: nearI, farFaultKA: farI, pickupA: pickup, ksenNear, ksenFar,
      zLine, z1, z2, z3, z1Ratio, z2Ratio, z3Ratio, z2Covers, z3Covers,
      ok: !issues.some((i) => i.level === 'error'), issues,
      status: issues.some((i) => i.level === 'error') ? 'fail' : issues.some((i) => i.level === 'warning') ? 'warn' : 'ok'
    });
  }
  const fails = rows.filter((r) => r.status === 'fail');
  const warns = rows.filter((r) => r.status === 'warn');
  const vals = rows.map((r) => r.ksenFar).filter((v) => v != null);
  return {
    rows,
    summary: {
      total: rows.length,
      ok: rows.length - fails.length - warns.length,
      warn: warns.length,
      fail: fails.length,
      minKsen: vals.length ? Math.min(...vals) : null,
      minKsenRelay: rows.filter((r) => r.ksenFar != null).sort((a, b) => a.ksenFar - b.ksenFar)[0]?.relayName || null
    }
  };
}

