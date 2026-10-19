import { C, add, sub, mul, div, inv, conj, abs, fromPolar, scale } from './complex.js';
import { solveComplex } from './linalg.js';
import { buildNetwork } from './powerflow.js';
import { isSeriesType } from '../model.js';

export function lineZeroParameters(br) {
  if (br.paramMode === 'distributed') {
    const L = Math.max(0, Number(br.length) || 0);
    return {
      R: Math.max(0, Number(br.r0PerKm) || 0) * L,
      X: Math.max(0, Number(br.x0PerKm) || 0) * L,
      B: Math.max(0, Number(br.b0PerKm) || 0) * L
    };
  }
  return {
    R: Math.max(0, Number(br.R0) || 0),
    X: Math.max(0, Number(br.X0) || 0),
    B: Math.max(0, Number(br.B0) || 0)
  };
}

function stampZeroBranch(Y, i, j, y, yff, yft, ytf, ytt) {
  Y[i][i] = add(Y[i][i], yff);
  Y[i][j] = add(Y[i][j], yft);
  Y[j][i] = add(Y[j][i], ytf);
  Y[j][j] = add(Y[j][j], ytt);
}

/**
 * Positive/zero sequence zero-model used by the single-line-to-ground fault.
 * Zero-sequence transformer paths are controlled by the user-selectable
 * `zeroMode` field (through / grounded high side / grounded low side / block).
 */
export function buildZeroSequenceModel(project, net, opts = {}) {
  const physicalNodes = [];
  const indexByNode = new Map();
  for (const bus of net.buses) {
    const node = net.busNode.get(bus.id);
    if (!node || indexByNode.has(node.index)) continue;
    indexByNode.set(node.index, physicalNodes.length);
    physicalNodes.push(node);
  }
  const n = physicalNodes.length;
  const Y0 = Array.from({ length: n }, () => Array.from({ length: n }, () => C(0, 0)));
  const warnings = [];
  const baseMVA = net.baseMVA;
  const idx = (fullNodeIndex) => indexByNode.get(fullNodeIndex);

  for (const br of net.branches) {
    if (isSeriesType(br.type)) {
      const branch = br.ref;
      const i = idx(br.from);
      const j = idx(br.to);
      if (i == null || j == null || i === j) continue;
      const zBase = (physicalNodes[i].baseKV ** 2) / baseMVA;
      const r = Math.max(0, Number(branch.rOhm) || 0);
      let x = 0;
      if (branch.type === 'seriesReactor') x = Math.max(0, Number(branch.zeroXOhm) || 0);
      else if (branch.type === 'fcl') x = Math.max(0, Number(branch.xFaultOhm) || 0);
      if (x <= 0) continue;
      const y = inv(C(r / zBase, x / zBase));
      stampZeroBranch(Y0, i, j, y, y, C(-y.re, -y.im), C(-y.re, -y.im), y);
      continue;
    }
    if (br.type === 'line') {
      const branch = br.ref;
      const i = idx(br.from);
      const j = idx(br.to);
      if (i == null || j == null || i === j) continue;
      const p = lineZeroParameters(branch);
      const zBase = (physicalNodes[i].baseKV ** 2) / baseMVA;
      const z = C(p.R / zBase, p.X / zBase);
      if (abs(z) < 1e-10) continue;
      const y = inv(z);
      const ys = C(0, (p.B * 1e-6) * zBase * 0.5);
      stampZeroBranch(Y0, i, j, y, add(y, ys), C(-y.re, -y.im), C(-y.re, -y.im), add(y, ys));
      continue;
    }
    if (br.type === 'transformer') {
      const branch = br.ref;
      const mode = branch.zeroMode || 'block';
      if (mode === 'block') continue;
      const i = idx(br.from);
      const j = idx(br.to);
      if (i == null || j == null || i === j) continue;
      const sn = Math.max(1e-6, Number(branch.sn) || 1);
      const zeroUk = Math.max(0, Number(branch.zeroUk) || 0) / 100;
      if (zeroUk <= 0) {
        warnings.push(`变压器“${branch.name}”零序阻抗为零，已忽略其零序通路。`);
        continue;
      }
      const scaleV = ((Number(branch.vn1) || physicalNodes[i].baseKV) / physicalNodes[i].baseKV) ** 2;
      const zPu = zeroUk * (baseMVA / sn) * scaleV;
      const rPu = Math.min(zPu * 0.85, (Number(branch.pk) || 0) / 1000 * baseMVA / (sn * sn));
      const xPu = Math.sqrt(Math.max(zPu * zPu - rPu * rPu, 1e-12));
      const y = inv(C(rPu, xPu));
      const tap = Math.max(1e-6, Number(br.params?.tapMag) || 1);
      if (mode === 'through') {
        stampZeroBranch(Y0, i, j, y, scale(y, 1 / (tap * tap)), scale(y, -1 / tap), scale(y, -1 / tap), y);
      } else if (mode === 'ground_from') {
        Y0[i][i] = add(Y0[i][i], y);
      } else if (mode === 'ground_to') {
        Y0[j][j] = add(Y0[j][j], y);
      }
      continue;
    }
    // Three-winding transformer zero-sequence paths are intentionally blocked.
  }

  // External grid and generator neutral grounding.
  for (const node of physicalNodes) {
    if (node.type === 'slack') {
      const sk = Math.max(10, Number(opts.sourceMVA) || Number(project.meta?.sourceMVA) || 12000);
      const x0 = baseMVA / sk;
      const i = indexByNode.get(node.index);
      Y0[i][i] = add(Y0[i][i], C(0, -1 / Math.max(x0, 1e-6)));
    }
  }
  if (opts.includeGenerators !== false) {
    for (const inj of project.injections.filter((x) => x.type === 'generator' && x.status !== 'out' && x.switchClosed !== false)) {
      if (inj.grounded === false) continue;
      const node = net.busNode.get(inj.bus);
      if (!node) continue;
      const i = idx(node.index);
      if (i == null) continue;
      const rated = Math.max(1, Number(inj.ratedMVA) || 100);
      const xg0 = Math.max(1e-4, Number(inj.xg0 ?? 0.05)) * baseMVA / rated;
      Y0[i][i] = add(Y0[i][i], C(0, -1 / xg0));
    }
  }
  // Tiny numerical grounding for zero-sequence islands without a physical
  // neutral path. It keeps the matrix solvable and makes the resulting fault
  // current effectively zero instead of aborting the entire calculation.
  for (let i = 0; i < n; i++) Y0[i][i] = add(Y0[i][i], C(1e-9, 0));
  warnings.push('零序网络中未接地的部分采用极小对地电导作数值正则化；若单相故障电流接近零，请检查变压器中性点接地方式。');
  return { Y0, physicalNodes, indexByNode, warnings };
}

/**
 * Simplified IEC 60909-style three-phase / two-phase short-circuit calculation.
 * Positive-sequence network only; loads are ignored, line capacitances and shunts
 * are retained, and every source is represented by a subtransient reactance behind
 * a c·Un internal EMF. The result is suitable for relay reach screening, not for
 * equipment rating certification.
 */
export function runShortCircuit(project, options = {}) {
  const opts = {
    busId: null,
    faultType: '3ph',
    c: 1.1,
    sourceMVA: Number(project.meta?.sourceMVA) || 12000,
    includeGenerators: true,
    includeMotors: true,
    includeLineCharging: true,
    faultImpedanceOhm: 0,
    ...options
  };
  const net = buildNetwork(project, { baseMVA: options.baseMVA, faultCurrent: true });
  if (net.errors.length) {
    const e = new Error(net.errors[0]);
    e.details = net.errors;
    throw e;
  }
  const target = opts.busId ? net.busMap.get(opts.busId) : net.buses.find((b) => b.type === 'slack') || net.buses[0];
  if (!target) throw new Error('请选择短路故障母线。');
  const targetNode = net.busNode.get(target.id);
  if (!targetNode) throw new Error('故障母线不在计算网络中。');
  const k = targetNode.index;
  const n = net.nodes.length;
  const Yf = net.Y.map((row) => row.map((v) => ({ re: v.re, im: v.im })));
  const sources = [];

  // External grid equivalent source at every slack node.
  for (const node of net.nodes) {
    if (node.type !== 'slack') continue;
    const sk = Math.max(10, Number(opts.sourceMVA) || 12000);
    const x = net.baseMVA / sk;
    const y = C(0, -1 / x);
    Yf[node.index][node.index] = add(Yf[node.index][node.index], y);
    sources.push({
      name: `系统等值电源（${node.shortName}）`,
      busId: node.busIds[0],
      node: node.index,
      y, xPu: x, kind: 'grid'
    });
  }
  // Synchronous / wind generators: simple subtransient reactance behind c·Un.
  if (opts.includeGenerators) {
    for (const inj of project.injections.filter((x) => x.type === 'generator' && x.status !== 'out' && x.switchClosed !== false)) {
      const node = net.busNode.get(inj.bus);
      if (!node) continue;
      const rated = Math.max(1, Number(inj.ratedMVA) || 100);
      const xd = Number(inj.xdSub) > 0 ? Number(inj.xdSub) : (inj.kind === '风电' ? 0.22 : 0.18);
      const x = xd * net.baseMVA / rated;
      const y = C(0, -1 / x);
      Yf[node.index][node.index] = add(Yf[node.index][node.index], y);
      sources.push({
        name: inj.name,
        busId: inj.bus,
        node: node.index,
        y, xPu: x, kind: 'generator'
      });
    }
  }

  if (opts.includeMotors) {
    for (const load of project.injections.filter((x) => x.type === 'load' && x.motor && x.status !== 'out')) {
      const node = net.busNode.get(load.bus);
      if (!node) continue;
      const motorMVA = Math.max(1, Math.hypot(Number(load.p) || 0, Number(load.q) || 0));
      const x = Math.max(0.05, Number(load.motorX) || 0.2) * net.baseMVA / motorMVA;
      const y = C(0, -1 / x);
      Yf[node.index][node.index] = add(Yf[node.index][node.index], y);
      sources.push({
        name: `${load.name}（电动机反馈）`, busId: load.bus, node: node.index,
        y, xPu: x, kind: 'motor'
      });
    }
  }

  if (!opts.includeLineCharging) {
    // Rebuild without line charging by subtracting known half-charging admittances.
    for (const br of net.branches) {
      if (br.type !== 'line') continue;
      const yHalf = sub(br.yff, br.y);
      if (abs(yHalf) < 1e-12) continue;
      Yf[br.from][br.from] = sub(Yf[br.from][br.from], yHalf);
      Yf[br.to][br.to] = sub(Yf[br.to][br.to], yHalf);
    }
  }

  // Solve Yf · Zcol = e_k. This gives the Thevenin driving-point and transfer
  // impedances without forming a full inverse.
  const e = Array.from({ length: n }, (_, i) => C(i === k ? 1 : 0, 0));
  let Zcol;
  try {
    Zcol = solveComplex(Yf, e);
  } catch (err) {
    throw new Error(`无法形成短路阻抗矩阵：${err.message}`);
  }
  const zTh = Zcol[k];
  const baseKV = targetNode.baseKV;
  const zBase = (baseKV * baseKV) / net.baseMVA;
  const zfPu = C((Number(opts.faultImpedanceOhm) || 0) / zBase, 0);
  const scRating = Number(target.scRating) > 0 ? Number(target.scRating) : null;
  const withstand = scRating == null ? null : {
    ratingKA: scRating,
    ok: false,
    marginPct: 0
  };

  // Single line-to-ground fault needs the zero-sequence network. Z2 is taken
  // equal to Z1 for the static network, which is a common scheme-stage approximation.
  if (opts.faultType === '1ph') {
    let zero;
    try {
      zero = buildZeroSequenceModel(project, net, opts);
    } catch (e) {
      throw new Error(`无法建立零序网络：${e.message}`);
    }
    const k0 = zero.indexByNode.get(k);
    if (k0 == null) throw new Error('故障母线不在零序网络中。');
    const e0 = Array.from({ length: zero.physicalNodes.length }, (_, i) => C(i === k0 ? 1 : 0, 0));
    let Z0col;
    try {
      Z0col = solveComplex(zero.Y0, e0);
    } catch (err) {
      throw new Error(`零序网络没有形成有效接地通路：${err.message}`);
    }
    const z0Th = Z0col[k0];
    const denom = add(add(zTh, zTh), add(z0Th, scale(zfPu, 3)));
    if (abs(denom) < 1e-9) throw new Error('单相接地故障点序网等值阻抗接近零。');
    const if1 = div(C(opts.c, 0), denom);
    const ifPu = 3 * abs(if1);
    const Ibase = net.baseMVA / (Math.sqrt(3) * baseKV);
    const Ik = ifPu * Ibase;
    const Sk = ifPu * net.baseMVA;
    const ip = 1.8 * Math.sqrt(2) * Ik;
    const a = fromPolar(1, 2 * Math.PI / 3);
    const a2 = fromPolar(1, 4 * Math.PI / 3);
    const zeroAt = (nodeIndex) => {
      const zi = zero.indexByNode.get(nodeIndex);
      return zi == null ? C(0, 0) : Z0col[zi];
    };
    const busVoltages = net.buses.map((bus) => {
      const node = net.busNode.get(bus.id);
      const v1 = sub(C(opts.c, 0), mul(Zcol[node.index], if1));
      const v2 = scale(mul(Zcol[node.index], if1), -1);
      const v0 = scale(mul(zeroAt(node.index), if1), -1);
      const va = add(add(v1, v2), v0);
      const vb = add(add(v1, mul(a2, v2)), mul(a, v0));
      const vc = add(add(v1, mul(a, v2)), mul(a2, v0));
      return {
        busId: bus.id,
        name: bus.name,
        tag: bus.tag,
        vn: node.baseKV,
        vpu: abs(va),
        vkV: abs(va) * node.baseKV,
        dip: Math.max(0, (1 - abs(va)) * 100),
        phase: { a: abs(va), b: abs(vb), c: abs(vc) },
        isFault: bus.id === target.id
      };
    });
    if (withstand) {
      withstand.ok = Ik <= scRating + 1e-9;
      withstand.marginPct = (scRating - Ik) / scRating * 100;
    }
    return {
      busId: target.id,
      busName: target.name,
      busTag: target.tag,
      scRating,
      withstand,
      baseKV,
      faultType: '1ph',
      faultTypeLabel: '单相接地短路',
      c: opts.c,
      sourceMVA: opts.sourceMVA,
      faultImpedanceOhm: opts.faultImpedanceOhm || 0,
      zTh, zThOhm: abs(zTh) * zBase,
      rTh: zTh.re * zBase,
      xTh: zTh.im * zBase,
      z0Th, z0ThOhm: abs(z0Th) * zBase,
      xr: Math.abs(zTh.re) > 1e-9 ? zTh.im / zTh.re : Infinity,
      ifPu,
      Ik,
      Sk,
      ip,
      ifAngleDeg: Math.atan2(if1.im, if1.re) * 180 / Math.PI,
      Ibase,
      sequence: {
        z1Pu: zTh, z2Pu: zTh, z0Pu: z0Th,
        z0Ohm: abs(z0Th) * zBase,
        i1Pu: abs(if1), i2Pu: abs(if1), i0Pu: abs(if1),
        i1kA: abs(if1) * Ibase, i0kA: abs(if1) * Ibase
      },
      busVoltages,
      branchCurrents: [],
      sources: [],
      net,
      zeroSeqWarnings: (ifPu * Ibase) < 0.01 ? zero.warnings : [],
      notes: [
        '单相接地短路采用对称分量法，Z₂≈Z₁。零序网络由线路零序参数、变压器零序通路与发电机中性点接地阻抗组成。',
        '正序/负序/零序电流均为 I₁ = I₂ = I₀ = c·Un/(Z₁+Z₂+Z₀+3Zf)，故障相电流为 3I₀。',
        '三绕组变压器零序通路暂按阻断处理；母线电压暂降按故障相（A 相）残压显示。',
        '支路电流与电源贡献表当前仅对三相/两相短路提供；单相结果给出了序电流和母线相电压。',
        opts.includeMotors ? '电动机反馈仅按正序次暂态电抗计入，零序网络不计及电动机。' : '本次计算未计入电动机反馈。'
      ]
    };
  }

  const zTotal = add(zTh, zfPu);
  if (abs(zTotal) < 1e-9) throw new Error('故障点等值阻抗接近零，请调整系统短路容量。');
  const ifPu3 = opts.c / abs(zTotal);
  const ifPu = opts.faultType === '2ph' ? ifPu3 * Math.sqrt(3) / 2 : ifPu3;
  const ifAngle = -Math.atan2(zTotal.im, zTotal.re);
  const ifComplex = fromPolar(ifPu, ifAngle);
  const Ibase = net.baseMVA / (Math.sqrt(3) * baseKV);
  const Ik = ifPu * Ibase;
  const Sk = ifPu * net.baseMVA;
  const xr = Math.abs(zTotal.re) > 1e-9 ? zTotal.im / zTotal.re : Infinity;
  const kappa = 1.8;
  const ip = kappa * Math.sqrt(2) * Ik;

  const nodeVoltage = Zcol.map((z, i) => {
    // All source EMFs are c·Un in this simplified model.
    return sub(C(opts.c, 0), mul(z, ifComplex));
  });
  // Bolted faults force the faulted node exactly to zero even in the presence of
  // numerical noise.
  if (!opts.faultImpedanceOhm) nodeVoltage[k] = C(0, 0);

  const busVoltages = net.buses.map((bus) => {
    const node = net.busNode.get(bus.id);
    const v = nodeVoltage[node.index];
    return {
      busId: bus.id,
      name: bus.name,
      tag: bus.tag,
      vn: node.baseKV,
      vpu: abs(v),
      vkV: abs(v) * node.baseKV,
      dip: Math.max(0, (1 - abs(v)) * 100),
      isFault: bus.id === target.id
    };
  });

  const branchCurrents = [];
  for (const br of net.branches) {
    const Vf = nodeVoltage[br.from];
    const Vt = nodeVoltage[br.to];
    let Ifrom;
    let Ito;
    if (br.type === 'line') {
      const yHalf = sub(br.yff, br.y);
      Ifrom = add(mul(br.y, sub(Vf, Vt)), mul(yHalf, Vf));
      Ito = add(mul(br.y, sub(Vt, Vf)), mul(yHalf, Vt));
    } else {
      Ifrom = add(mul(br.yff, Vf), mul(br.yft, Vt));
      Ito = add(mul(br.ytt, Vt), mul(br.ytf, Vf));
    }
    const ibFrom = net.baseMVA / (Math.sqrt(3) * net.nodes[br.from].baseKV);
    const ibTo = net.baseMVA / (Math.sqrt(3) * net.nodes[br.to].baseKV);
    const iFrom = abs(Ifrom) * ibFrom;
    const iTo = abs(Ito) * ibTo;
    branchCurrents.push({
      id: br.id, name: br.name, tag: br.tag, type: br.type,
      fromName: net.nodes[br.from].shortName, toName: net.nodes[br.to].shortName,
      fromBusId: br.fromBus, toBusId: br.toBus,
      iFrom, iTo, current: Math.max(iFrom, iTo),
      contribution: Math.max(iFrom, iTo)
    });
  }
  branchCurrents.sort((a, b) => b.current - a.current);

  const sourceResults = sources.map((s) => {
    const v = nodeVoltage[s.node];
    const i = abs(mul(s.y, sub(C(opts.c, 0), v))) * (net.baseMVA / (Math.sqrt(3) * net.nodes[s.node].baseKV));
    return {
      name: s.name, busId: s.busId, kind: s.kind, xPu: s.xPu, current: i
    };
  });

  const t = target;
  if (withstand) {
    withstand.ok = Ik <= scRating + 1e-9;
    withstand.marginPct = (scRating - Ik) / scRating * 100;
  }
  return {
    busId: t.id,
    busName: t.name,
    busTag: t.tag,
    scRating,
    withstand,
    baseKV,
    faultType: opts.faultType,
    faultTypeLabel: opts.faultType === '2ph' ? '两相短路（Z₂≈Z₁ 近似）' : '三相短路',
    c: opts.c,
    sourceMVA: opts.sourceMVA,
    faultImpedanceOhm: opts.faultImpedanceOhm || 0,
    zTh, zThOhm: abs(zTh) * zBase,
    rTh: zTh.re * zBase,
    xTh: zTh.im * zBase,
    xr,
    ifPu,
    Ik,
    Sk,
    ip,
    ifAngleDeg: ifAngle * 180 / Math.PI,
    Ibase,
    busVoltages,
    branchCurrents,
    sources: sourceResults,
    net,
    notes: [
      '按 IEC 60909 简化正序网络计算，所有电源内电势取 c·Un，负荷忽略。',
      opts.faultType === '2ph' ? '两相短路按 Z₂=Z₁ 近似，仅用于保护灵敏度初筛。' : '三相短路为对称故障，适用于设备动热稳定初筛。',
      '如需设备选型校核，请结合零序网络、发电机暂态参数及电动机反馈另行计算。',
      opts.includeMotors ? '已按负荷属性计入电动机次暂态反馈（正序网络）。' : '未计入电动机反馈。'
    ]
  };
}

export function faultCurrentAtBus(project, busId, opts = {}) {
  const r = runShortCircuit(project, { ...opts, busId, faultType: '3ph' });
  return { Ik: r.Ik, Sk: r.Sk, result: r };
}

/**
 * Sweep every bus and compare the fault current with the busbar short-time
 * withstand rating. The calculation is repeated per bus for simplicity; networks
 * with a few dozen buses still complete comfortably in the browser.
 */
export function scanShortCircuitBuses(project, options = {}) {
  const rows = [];
  for (const bus of project.buses) {
    try {
      const r = runShortCircuit(project, { ...options, busId: bus.id });
      const rating = Number(bus.scRating) > 0 ? Number(bus.scRating) : r.scRating;
      rows.push({
        busId: bus.id,
        name: bus.name,
        tag: bus.tag,
        vn: Number(bus.vn),
        scRating: rating,
        Ik: r.Ik,
        Sk: r.Sk,
        ip: r.ip,
        zThOhm: r.zThOhm,
        xr: r.xr,
        faultType: r.faultType,
        faultTypeLabel: r.faultTypeLabel,
        ok: rating == null ? null : r.Ik <= rating + 1e-9,
        marginPct: rating == null ? null : (rating - r.Ik) / rating * 100,
        result: r
      });
    } catch (e) {
      rows.push({
        busId: bus.id, name: bus.name, tag: bus.tag, vn: Number(bus.vn),
        scRating: Number(bus.scRating) || null, error: e.message,
        Ik: null, Sk: null, ip: null, ok: false, marginPct: null
      });
    }
  }
  rows.sort((a, b) => {
    if (a.Ik == null && b.Ik == null) return 0;
    if (a.Ik == null) return 1;
    if (b.Ik == null) return -1;
    return b.Ik - a.Ik;
  });
  const valid = rows.filter((r) => r.Ik != null);
  const max = valid[0] || null;
  return {
    rows,
    summary: {
      total: rows.length,
      tested: valid.length,
      failed: rows.length - valid.length,
      maxIk: max?.Ik ?? null,
      maxBus: max?.name ?? null,
      maxBusTag: max?.tag ?? null,
      exceed: valid.filter((r) => r.ok === false).length,
      sourceMVA: Number(options.sourceMVA) || Number(project.meta?.sourceMVA) || 12000,
      c: Number(options.c) || 1.1,
      faultType: options.faultType || '3ph',
      faultTypeLabel: options.faultType === '2ph' ? '两相短路（Z₂≈Z₁ 近似）' : '三相短路'
    }
  };
}
