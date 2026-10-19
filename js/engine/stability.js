import { C, add, sub, mul, div, conj, abs, fromPolar } from './complex.js';
import { inverseComplex } from './linalg.js';
import { buildNetwork, runPowerFlow } from './powerflow.js';

/**
 * Classical electromechanical transient stability.
 *
 * Generators are represented by a constant E' behind x'd, loads are converted to
 * constant impedances using the prefault voltage, and the network is Kron-reduced
 * to generator internal buses plus the fixed-voltage slack reference. The swing
 * equations are integrated with RK4 for a balanced three-phase fault cleared after
 * the specified time. This is a first-swing screening model, not a full transient
 * stability program with excitation, governors, PSS or induction motors.
 */
export function runTransientStability(project, options = {}) {
  const opts = {
    faultBusId: null,
    faultDuration: 0.15,
    faultStart: 0.1,
    tEnd: 5,
    dt: 0.01,
    faultImpedancePu: 1e-4,
    damping: 2,
    ...options
  };
  const net = buildNetwork(project);
  if (net.errors.length) throw new Error(net.errors[0]);
  const pf = options.powerFlow || runPowerFlow(project, { algorithm: 'nr', tol: 1e-8, maxIter: 40 });
  if (!pf.converged) throw new Error('潮流不收敛，无法建立暂态稳定初始方式。');
  const baseMVA = net.baseMVA;
  const freq = Number(project.meta?.frequency) || 50;
  const omegaS = 2 * Math.PI * freq;
  const slackNodes = [];
  const seenSlack = new Set();
  for (const node of net.nodes) {
    if (node.type !== 'slack' || seenSlack.has(node.index)) continue;
    seenSlack.add(node.index);
    const bus = net.buses.find((b) => net.busNode.get(b.id) === node);
    const br = bus ? pf.busById[bus.id] : null;
    slackNodes.push({
      index: node.index,
      busId: bus?.id,
      name: bus?.name || node.shortName,
      V: fromPolar(br?.Vm || node.vmSet || 1, (br?.Va || 0) * Math.PI / 180)
    });
  }
  if (!slackNodes.length) throw new Error('暂态稳定计算需要至少一个平衡节点。');
  const slackSet = new Set(slackNodes.map((s) => s.index));
  const faultBus = project.buses.find((b) => b.id === opts.faultBusId)
    || project.buses.find((b) => b.type !== 'slack')
    || project.buses[0];
  if (!faultBus) throw new Error('请选择故障母线。');
  const faultNode = net.busNode.get(faultBus.id);
  if (!faultNode) throw new Error('故障母线不在计算网络中。');
  if (slackSet.has(faultNode.index)) throw new Error('暂态稳定故障点不能选在平衡节点（无穷大母线）上。');

  const activeGens = project.injections.filter((x) => x.type === 'generator' && x.status !== 'out' && x.switchClosed !== false);
  const dynamic = [];
  for (const g of activeGens) {
    const node = net.busNode.get(g.bus);
    if (!node || slackSet.has(node.index)) continue;
    const gr = pf.generatorResults.find((x) => x.id === g.id);
    const busRes = pf.busById[g.bus];
    if (!gr || !busRes) continue;
    const rated = Math.max(1, Number(g.ratedMVA) || 100);
    const x = Math.max(0.01, Number(g.xd) || 0.25) * baseMVA / rated;
    const Vt = fromPolar(busRes.Vm, busRes.Va * Math.PI / 180);
    const S = C((Number(gr.p) || 0) / baseMVA, (Number(gr.q) || 0) / baseMVA);
    if (abs(Vt) < 1e-6) continue;
    const I = conj(div(S, Vt));
    const E = add(Vt, mul(C(0, x), I));
    dynamic.push({
      id: g.id,
      name: g.name,
      tag: g.tag,
      busId: g.bus,
      busName: busRes.name,
      H: Math.max(0.3, Number(g.inertia) || 5),
      xPu: x,
      damping: Number(g.damping) || opts.damping,
      terminalNode: node.index,
      Eabs: abs(E),
      delta0: Math.atan2(E.im, E.re),
      p0: Number(gr.p) || 0,
      q0: Number(gr.q) || 0
    });
  }
  if (!dynamic.length) throw new Error('除平衡节点外没有可仿真的动态发电机；请至少保留一台非平衡机组。');

  const N = net.nodes.length;
  const makeAugY = () => {
    const size = N + dynamic.length;
    const Y = Array.from({ length: size }, () => Array.from({ length: size }, () => C(0, 0)));
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) Y[i][j] = C(net.Y[i][j].re, net.Y[i][j].im);
      Y[i][i] = add(Y[i][i], C(1e-9, 0));
    }
    // Constant-impedance loads based on prefault voltage.
    for (const load of project.injections.filter((x) => x.type === 'load' && x.status !== 'out')) {
      const node = net.busNode.get(load.bus);
      if (!node) continue;
      const busRes = pf.busById[load.bus];
      const v2 = Math.max(1e-6, (busRes?.Vm || 1) ** 2);
      const y = C((Number(load.p) || 0) / baseMVA / v2, -(Number(load.q) || 0) / baseMVA / v2);
      Y[node.index][node.index] = add(Y[node.index][node.index], y);
    }
    for (const g of dynamic) {
      const y = C(0, -1 / g.xPu);
      const t = g.terminalNode;
      const i = g.internalNode;
      Y[t][t] = add(Y[t][t], y);
      Y[t][i] = add(Y[t][i], C(-y.re, -y.im));
      Y[i][t] = add(Y[i][t], C(-y.re, -y.im));
      Y[i][i] = add(Y[i][i], y);
    }
    return Y;
  };

  dynamic.forEach((g, i) => { g.internalNode = N + i; });
  const Yaug = makeAugY();
  const reference = slackNodes;
  const retain = [...dynamic.map((g) => g.internalNode), ...reference.map((s) => s.index)];
  const retainedSet = new Set(retain);
  const eliminated = [];
  for (let i = 0; i < Yaug.length; i++) if (!retainedSet.has(i)) eliminated.push(i);

  const reduce = (Y) => {
    if (!eliminated.length) return retain.map((i) => retain.map((j) => Y[i][j]));
    const YEE = eliminated.map((i) => eliminated.map((j) => Y[i][j]));
    const YER = eliminated.map((i) => retain.map((j) => Y[i][j]));
    const YRE = retain.map((i) => eliminated.map((j) => Y[i][j]));
    const YRR = retain.map((i) => retain.map((j) => Y[i][j]));
    const invEE = inverseComplex(YEE);
    // Y_RE · Y_EE⁻¹ · Y_ER
    const temp = YRE.map((row) => eliminated.map((_, k) => row.reduce((s, v, c) => add(s, mul(v, invEE[c][k])), C(0, 0))));
    const correction = temp.map((row) => retain.map((_, k) => row.reduce((s, v, e) => add(s, mul(v, YER[e][k])), C(0, 0))));
    return YRR.map((row, i) => row.map((v, j) => sub(v, correction[i][j])));
  };

  const Ypre = reduce(Yaug);
  const YfaultAug = Yaug.map((row) => row.map((v) => C(v.re, v.im)));
  YfaultAug[faultNode.index][faultNode.index] = add(YfaultAug[faultNode.index][faultNode.index], C(1 / Math.max(1e-5, opts.faultImpedancePu), 0));
  const Yfault = reduce(YfaultAug);

  const G = dynamic.length;
  const fixedV = reference.map((s) => s.V);
  const refOffset = G;
  const initialDelta = dynamic.map((g) => g.delta0);
  const initialOmega = dynamic.map(() => 0);
  const Eabs = dynamic.map((g) => g.Eabs);

  const electricalPower = (delta, Yred) => {
    const V = dynamic.map((g, i) => fromPolar(Eabs[i], delta[i]));
    for (const v of fixedV) V.push(v);
    const I = Yred.map((row) => row.reduce((s, y, j) => add(s, mul(y, V[j])), C(0, 0)));
    return dynamic.map((g, i) => mul(V[i], conj(I[i])).re);
  };

  const Pe0 = electricalPower(initialDelta, Ypre);
  const Pm = Pe0.slice();
  const H = dynamic.map((g) => g.H);
  const D = dynamic.map((g) => g.damping);

  const deriv = (delta, omega, Yred) => {
    const Pe = electricalPower(delta, Yred);
    const dDelta = omega.map((w) => omegaS * w);
    const dOmega = dynamic.map((g, i) => (Pm[i] - Pe[i] - D[i] * omega[i]) / (2 * H[i]));
    return { dDelta, dOmega };
  };

  const dt = Math.max(0.002, Math.min(0.02, Number(opts.dt) || 0.01));
  const tEnd = Math.max(0.5, Number(opts.tEnd) || 5);
  const faultStart = Math.max(0, Number(opts.faultStart) || 0.1);
  const faultDuration = Math.max(0.01, Number(opts.faultDuration) || 0.15);
  let t = 0;
  let delta = initialDelta.slice();
  let omega = initialOmega.slice();
  const timeline = [];
  const record = () => {
    const coi = delta.reduce((s, d, i) => s + H[i] * d, 0) / H.reduce((s, h) => s + h, 0);
    const deg = delta.map((d) => (d - coi) * 180 / Math.PI);
    timeline.push({ t, angles: deg, speeds: omega.slice() });
  };
  record();
  let maxSpread = 0;
  let steps = 0;
  const maxSteps = Math.ceil(tEnd / dt) + 5;
  while (t < tEnd - 1e-9 && steps < maxSteps) {
    const inFault = t >= faultStart - 1e-9 && t < faultStart + faultDuration - 1e-9;
    const Yred = inFault ? Yfault : Ypre;
    const f1 = deriv(delta, omega, Yred);
    const d2 = delta.map((x, i) => x + f1.dDelta[i] * dt / 2);
    const w2 = omega.map((x, i) => x + f1.dOmega[i] * dt / 2);
    const f2 = deriv(d2, w2, Yred);
    const d3 = delta.map((x, i) => x + f2.dDelta[i] * dt / 2);
    const w3 = omega.map((x, i) => x + f2.dOmega[i] * dt / 2);
    const f3 = deriv(d3, w3, Yred);
    const d4 = delta.map((x, i) => x + f3.dDelta[i] * dt);
    const w4 = omega.map((x, i) => x + f3.dOmega[i] * dt);
    const f4 = deriv(d4, w4, Yred);
    delta = delta.map((x, i) => x + dt / 6 * (f1.dDelta[i] + 2 * f2.dDelta[i] + 2 * f3.dDelta[i] + f4.dDelta[i]));
    omega = omega.map((x, i) => x + dt / 6 * (f1.dOmega[i] + 2 * f2.dOmega[i] + 2 * f3.dOmega[i] + f4.dOmega[i]));
    if (!delta.every(Number.isFinite) || !omega.every(Number.isFinite)) break;
    t += dt;
    steps++;
    if (steps % 5 === 0 || t >= tEnd - 1e-9) {
      record();
      const spread = Math.max(...timeline[timeline.length - 1].angles) - Math.min(...timeline[timeline.length - 1].angles);
      maxSpread = Math.max(maxSpread, spread);
    }
  }
  const last = timeline[timeline.length - 1] || { angles: [], speeds: [] };
  const finalSpeed = Math.max(0, ...last.speeds.map((x) => Math.abs(x)));
  const finite = timeline.length > 1 && timeline.every((p) => p.angles.every(Number.isFinite) && p.speeds.every(Number.isFinite));
  const stable = finite && finalSpeed < 0.03 && maxSpread < 180;
  const maxAngle = Math.max(0, ...timeline.map((p) => Math.max(...p.angles) - Math.min(...p.angles)));
  const lastSpread = last.angles.length ? Math.max(...last.angles) - Math.min(...last.angles) : 0;
  const criticalHint = !stable ? '失稳：功角或转速偏差未收敛' : maxSpread > 120 ? '临界：最大功角差较大，建议缩短切除时间' : '稳定：首摆后转速与功角差收敛';
  return {
    stable,
    status: criticalHint,
    faultBusId: faultBus.id,
    faultBusName: faultBus.name,
    faultBusTag: faultBus.tag,
    faultStart,
    faultDuration,
    tEnd: timeline[timeline.length - 1]?.t || 0,
    dt,
    generators: dynamic.map((g, i) => ({
      id: g.id, name: g.name, tag: g.tag, busName: g.busName,
      H: g.H, xd: g.xPu, Eabs: g.Eabs, angle0: (g.delta0 - (initialDelta.reduce((s, d, k) => s + H[k] * d, 0) / H.reduce((s, h) => s + h, 0))) * 180 / Math.PI,
      p0: g.p0, q0: g.q0
    })),
    timeline,
    maxSpread,
    lastSpread,
    finalSpeed,
    referenceBuses: slackNodes.map((s) => ({ name: s.name, busId: s.busId })),
    Yred: Ypre,
    notes: [
      '经典二阶模型：E′ 恒定、x′d 暂态电抗、负荷按故障前电压折算为恒阻抗。',
      '平衡节点按固定电压相量处理；非平衡发电机为动态机组。',
      'RS 为常数阻尼；未考虑励磁、调速器、PSS、电动机动态与保护动作。',
      '结果用于方案阶段首摆稳定初筛，不作为正式稳定计算结论。'
    ]
  };
}

export function findCriticalClearingTime(project, options = {}) {
  const lo = 0.02;
  const hi = Math.max(0.1, Number(options.maxDuration) || 1.0);
  const base = { ...options, tEnd: options.tEnd || 4, dt: options.dt || 0.02 };
  const hiResult = runTransientStability(project, { ...base, faultDuration: hi });
  if (hiResult.stable) {
    return { criticalTime: hi, stableAtMax: true, scans: 1, result: hiResult };
  }
  const loResult = runTransientStability(project, { ...base, faultDuration: lo });
  if (!loResult.stable) {
    return { criticalTime: 0, stableAtMax: false, scans: 2, result: loResult, unstableAt: hiResult };
  }
  let stableTime = lo;
  let unstableTime = hi;
  let stableResult = loResult;
  let unstableResult = hiResult;
  for (let k = 0; k < 8; k++) {
    const mid = (stableTime + unstableTime) / 2;
    const r = runTransientStability(project, { ...base, faultDuration: mid });
    if (r.stable) { stableTime = mid; stableResult = r; } else { unstableTime = mid; unstableResult = r; }
  }
  return { criticalTime: stableTime, stableAtMax: false, scans: 10, result: stableResult, unstableAt: unstableResult };
}
