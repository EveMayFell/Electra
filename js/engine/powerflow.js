import {
  C, add, sub, mul, div, conj, abs, arg, fromPolar, inv, sqrt, sinh, tanh, scale
} from './complex.js';
import { solveReal } from './linalg.js';
import { isSwitchType, isSeriesType } from '../model.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPS = 1e-12;

export function lineParameters(br) {
  const length = Math.max(0, Number(br.length) || 0);
  if (br.paramMode === 'distributed') {
    const r = Math.max(0, Number(br.rPerKm) || 0);
    const x = Math.max(0, Number(br.xPerKm) || 0);
    const b = Math.max(0, Number(br.bPerKm) || 0); // µS/km, capacitive
    const zTotal = C(r * length, x * length);
    const yTotal = C(0, b * 1e-6 * length);
    if (Math.abs(yTotal.im) > 1e-12 && Math.abs(zTotal.re) + Math.abs(zTotal.im) > 0) {
      // Exact long-line equivalent π (distributed parameters).
      const gammaL = sqrt(mul(zTotal, yTotal));
      const zc = sqrt(div(zTotal, yTotal));
      const zEq = mul(zc, sinh(gammaL));
      const yEq = mul(scale(inv(zc), 2), tanh(scale(gammaL, 0.5)));
      return {
        mode: 'distributed', length,
        R: zEq.re, X: zEq.im, B: yEq.im * 1e6,
        zEq, yEq, surgeZ: zEq.re, zc,
        rawR: r * length, rawX: x * length, rawB: b * length,
        rPerKm: r, xPerKm: x, bPerKm: b
      };
    }
    return {
      mode: 'distributed', length,
      R: r * length, X: x * length, B: b * length,
      zEq: C(r * length, x * length), yEq: C(0, b * 1e-6 * length), zc: null,
      rawR: r * length, rawX: x * length, rawB: b * length,
      rPerKm: r, xPerKm: x, bPerKm: b, note: '充电电纳为零，退化为集中参数 π 模型'
    };
  }
  const R = Number(br.R) || 0;
  const X = Number(br.X) || 0;
  const B = Number(br.B) || 0; // total µS
  return {
    mode: 'lumped', length: Number(br.length) || 0,
    R, X, B, zEq: C(R, X), yEq: C(0, B * 1e-6), zc: null,
    rawR: R, rawX: X, rawB: B
  };
}

export function transformerParameters(br, baseFromKV, baseToKV, baseMVA) {
  const sn = Math.max(1e-6, Number(br.sn) || 1);
  const vn1 = Math.max(1e-6, Number(br.vn1) || baseFromKV);
  const vn2 = Math.max(1e-6, Number(br.vn2) || baseToKV);
  const uk = Math.max(1e-6, Number(br.uk) || 10.5) / 100;
  const pkMW = Math.max(0, Number(br.pk) || 0) / 1000;
  const zBaseFrom = (baseFromKV * baseFromKV) / baseMVA;
  const scaleV = (vn1 / baseFromKV) ** 2;
  const zPu = uk * (baseMVA / sn) * scaleV;
  const rPu = (pkMW * baseMVA) / (sn * sn) * scaleV;
  const r = Math.min(rPu, zPu * 0.9);
  const x = Math.sqrt(Math.max(zPu * zPu - r * r, 1e-12));
  const tapMag = (vn1 / vn2) / (baseFromKV / baseToKV) * (1 + (Number(br.tap) || 0) / 100);
  const shift = (Number(br.shift) || 0) * D2R;
  const tap = fromPolar(Math.max(tapMag, 1e-6), shift);
  const p0 = Math.max(0, Number(br.p0) || 0) / 1000;
  const s0 = (Math.max(0, Number(br.i0) || 0) / 100) * sn;
  const q0 = Math.sqrt(Math.max(s0 * s0 - p0 * p0, 0));
  const ym = C(p0 / baseMVA, -q0 / baseMVA);
  return {
    sn, vn1, vn2, uk, pkMW, r, x, zPu: C(r, x), tap, tapMag, shiftDeg: br.shift || 0,
    ym, zBaseFrom, currentBase: baseMVA / (Math.sqrt(3) * baseFromKV),
    ratedCurrent: (sn * 1e6) / (Math.sqrt(3) * vn2 * 1e3)
  };
}

export function threeWindingParameters(br, baseH, baseM, baseL, baseMVA) {
  const sn = Math.max(1e-6, Number(br.sn) || 1);
  const uHM = Math.max(1e-4, Number(br.ukHM) || 10.5) / 100;
  const uHL = Math.max(1e-4, Number(br.ukHL) || 17) / 100;
  const uML = Math.max(1e-4, Number(br.ukML) || 6.5) / 100;
  const uH = Math.max(1e-4, (uHM + uHL - uML) / 2);
  const uM = Math.max(1e-4, (uHM + uML - uHL) / 2);
  const uL = Math.max(1e-4, (uHL + uML - uHM) / 2);
  const pkMW = Math.max(0, Number(br.pk) || 0) / 1000;
  const rTotal = (pkMW * baseMVA) / (sn * sn);
  const sumU = uH + uM + uL;
  const parts = [
    { key: 'H', u: uH, vn: Number(br.vnH) || baseH, base: baseH, tap: Number(br.tapH) || 0 },
    { key: 'M', u: uM, vn: Number(br.vnM) || baseM, base: baseM, tap: Number(br.tapM) || 0 },
    { key: 'L', u: uL, vn: Number(br.vnL) || baseL, base: baseL, tap: Number(br.tapL) || 0 }
  ];
  const windings = parts.map((p) => {
    const z = p.u * (baseMVA / sn);
    const r = Math.min(z * 0.9, rTotal * (p.u / Math.max(sumU, 1e-9)));
    const x = Math.sqrt(Math.max(z * z - r * r, 1e-12));
    const tap = (p.vn / p.base) * (1 + p.tap / 100);
    return { key: p.key, uk: p.u * 100, zPu: C(r, x), r, x, tap, vn: p.vn, base: p.base };
  });
  const p0 = Math.max(0, Number(br.p0) || 0) / 1000;
  const s0 = (Math.max(0, Number(br.i0) || 0) / 100) * sn;
  const q0 = Math.sqrt(Math.max(s0 * s0 - p0 * p0, 0));
  const ym = C(p0 / baseMVA, -q0 / baseMVA);
  return { sn, uH, uM, uL, windings, ym, pkMW, sumU };
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
    this.rank = new Map(ids.map((id) => [id, 0]));
  }
  find(x) {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(x) !== x) {
      const nxt = this.parent.get(x);
      this.parent.set(x, r);
      x = nxt;
    }
    return r;
  }
  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank.get(ra) < this.rank.get(rb)) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    if (this.rank.get(ra) === this.rank.get(rb)) this.rank.set(ra, this.rank.get(ra) + 1);
    return true;
  }
}

export function buildNetwork(project, opts = {}) {
  const baseMVA = Number(opts.baseMVA || project.meta?.baseMVA || 100);
  const faultCurrent = opts.faultCurrent === true;
  const warnings = [];
  const errors = [];
  const buses = (project.buses || []).filter((b) => b && b.id);
  if (!buses.length) throw new Error('网络中没有任何母线，无法形成节点导纳矩阵。');
  const busMap = new Map(buses.map((b) => [b.id, b]));
  const branchesRaw = (project.branches || []).filter((b) => b && b.id);
  const injectionsRaw = (project.injections || []).filter((x) => x && x.id);

  const uf = new UnionFind(buses.map((b) => b.id));
  const shorted = [];
  for (const br of branchesRaw) {
    if (br.status !== 'in') continue;
    if (isSwitchType(br.type) && br.closed !== false) {
      if (busMap.has(br.from) && busMap.has(br.to) && br.from !== br.to) {
        const before = uf.find(br.from) === uf.find(br.to);
        if (!before) {
          uf.union(br.from, br.to);
          shorted.push(br);
        } else {
          warnings.push(`开关“${br.name}”两端已在同一电气节点，忽略其影响。`);
        }
      }
    }
  }

  const groups = new Map();
  for (const b of buses) {
    const root = uf.find(b.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(b);
  }
  const nodes = [];
  const busNode = new Map();
  for (const [root, members] of groups) {
    const voltages = [...new Set(members.map((m) => Number(m.vn.toFixed(4))))];
    if (voltages.length > 1) {
      warnings.push(`母线 ${members.map((m) => m.name).join('、')} 经零阻抗开关合并，但电压等级不同；计算采用第一段母线基准。`);
    }
    const baseKV = members[0].vn;
    const explicitTypes = members.map((m) => m.type);
    let type = explicitTypes.includes('slack') ? 'slack' : explicitTypes.includes('PV') ? 'PV' : 'PQ';
    const source = members.find((m) => (type === 'slack' ? m.type === 'slack' : type === 'PV' ? m.type === 'PV' : true)) || members[0];
    const node = {
      index: nodes.length,
      id: `node-${nodes.length + 1}`,
      root,
      buses: members,
      busIds: members.map((m) => m.id),
      name: members.map((m) => m.name).join(' / '),
      shortName: members[0].name,
      baseKV,
      baseMVA,
      type,
      vmSet: Number(source.vm) || 1,
      vaSet: (Number(source.va) || 0) * D2R,
      genP: 0, loadP: 0, loadQ: 0, genQfixed: 0,
      generators: [], loads: [], shunts: [],
      qMin: 0, qMax: 0,
      pSpec: 0, qSpec: 0,
      warnings: []
    };
    if (voltages.length > 1) {
      const maxDiff = Math.max(...voltages) - Math.min(...voltages);
      if (maxDiff > 0.02) node.warnings.push('不同电压等级母线被零阻抗连接');
    }
    nodes.push(node);
    for (const m of members) busNode.set(m.id, node);
  }

  for (const inj of injectionsRaw) {
    if (inj.status === 'out') continue;
    const node = busNode.get(inj.bus);
    if (!node) {
      warnings.push(`设备“${inj.name}”连接到不存在的母线，已忽略。`);
      continue;
    }
    if (inj.type === 'generator') {
      if (inj.switchClosed === false) continue;
      node.generators.push(inj);
      node.genP += Number(inj.p) || 0;
      node.genQfixed += Number(inj.q) || 0;
      node.qMin += Number(inj.qMin) || 0;
      node.qMax += Number(inj.qMax) || 0;
    } else if (inj.type === 'load') {
      node.loads.push(inj);
      node.loadP += Number(inj.p) || 0;
      node.loadQ += Number(inj.q) || 0;
    } else if (inj.type === 'shunt') {
      node.shunts.push(inj);
    }
  }

  const threeWStar = new Map();
  for (const br of branchesRaw) {
    if (br.type !== 'transformer3' || br.status !== 'in') continue;
    if (br.fromSwitch === 'open' || br.toSwitch === 'open' || br.thirdSwitch === 'open') continue;
    const ids = [br.from, br.to, br.third];
    if (!ids.every((id) => busMap.has(id))) {
      errors.push(`三绕组变压器“${br.name}”连接了不存在的母线。`);
      continue;
    }
    if (new Set(ids).size !== 3) {
      errors.push(`三绕组变压器“${br.name}”的高、中、低压侧必须连接三条不同母线。`);
      continue;
    }
    const physical = ids.map((id) => busNode.get(id));
    if (new Set(physical.map((n) => n.index)).size < 3) {
      errors.push(`三绕组变压器“${br.name}”的三个绕组被零阻抗开关短接，无法建立星点模型。`);
      continue;
    }
    const hvNode = physical[0];
    const starIndex = nodes.length;
    const star = {
      index: starIndex,
      id: `star-${br.id}`,
      root: null,
      buses: [],
      busIds: [],
      name: `${br.name} 星点`,
      shortName: `${br.tag || 'T'}·星点`,
      baseKV: hvNode.baseKV,
      baseMVA,
      type: 'PQ',
      vmSet: 1,
      vaSet: 0,
      genP: 0, loadP: 0, loadQ: 0, genQfixed: 0,
      generators: [], loads: [], shunts: [],
      qMin: 0, qMax: 0,
      pSpec: 0, qSpec: 0,
      warnings: [],
      virtual: true,
      threeWindingId: br.id
    };
    nodes.push(star);
    threeWStar.set(br.id, star);
  }

  for (const node of nodes) {
    if (node.type === 'PV' && node.generators.length === 0) {
      warnings.push(`节点“${node.name}”设为 PV，但没有投入的发电机，已按 PQ 节点计算。`);
      node.type = 'PQ';
    }
    node.pSpec = node.genP - node.loadP;
    node.qSpec = node.genQfixed - node.loadQ;
  }

  const Y = nodes.map(() => nodes.map(() => C(0, 0)));
  const branches = [];
  const skipped = [];

  const stampShunt = (i, y) => {
    Y[i][i] = add(Y[i][i], y);
  };

  for (const br of branchesRaw) {
    if (!['line', 'transformer'].includes(br.type) && !isSeriesType(br.type)) continue;
    if (br.status !== 'in') continue;
    if (br.fromSwitch === 'open' || br.toSwitch === 'open') continue;
    if (!busMap.has(br.from) || !busMap.has(br.to)) {
      errors.push(`支路“${br.name}”连接到不存在的母线。`);
      continue;
    }
    if (br.from === br.to) {
      warnings.push(`支路“${br.name}”两端为同一母线，已忽略。`);
      continue;
    }
    const nf = busNode.get(br.from);
    const nt = busNode.get(br.to);
    if (nf === nt) {
      warnings.push(`支路“${br.name}”被零阻抗开关短接，已忽略其串联阻抗。`);
      skipped.push(br.id);
      continue;
    }
    const f = nf.index;
    const t = nt.index;
    let y, yff, yft, ytf, ytt, ratingMVA, params;
    if (br.type === 'line') {
      params = lineParameters(br);
      const zBase = (nf.baseKV ** 2) / baseMVA;
      const zPu = div(params.zEq, C(zBase, 0));
      const ySer = inv(zPu);
      const yShuntPu = scale(params.yEq, zBase);
      const yHalf = scale(yShuntPu, 0.5);
      yff = add(ySer, yHalf);
      ytt = add(ySer, yHalf);
      yft = scale(ySer, -1);
      ytf = scale(ySer, -1);
      y = ySer;
      ratingMVA = Number(br.ratingMVA) || (Math.sqrt(3) * (br.voltageClass || nf.baseKV) * 0.8);
      params = {
        ...params,
        zBase, zPu, yPu: ySer, yShuntPu,
        rawR: params.R, rawX: params.X, rawB: params.B
      };
    } else if (br.type === 'transformer') {
      params = transformerParameters(br, nf.baseKV, nt.baseKV, baseMVA);
      y = inv(params.zPu);
      const tap = params.tap;
      const tap2 = mul(tap, conj(tap)).re;
      yff = add(scale(y, 1 / tap2), params.ym);
      // Ideal transformer at the from side: Yft = −y / conj(a), Ytf = −y / a.
      yft = scale(div(y, conj(tap)), -1);
      ytf = scale(div(y, tap), -1);
      ytt = y;
      ratingMVA = Number(br.ratingMVA) || params.sn;
    } else {
      const zBase = (nf.baseKV ** 2) / baseMVA;
      const rOhm = Math.max(0, Number(br.rOhm) || 0);
      let xOhm;
      if (br.type === 'seriesReactor') xOhm = Math.max(0, Number(br.xOhm) || 0);
      else if (br.type === 'seriesCap') xOhm = -Math.max(0, Number(br.xcOhm) || 0);
      else xOhm = Math.max(0, Number(faultCurrent ? br.xFaultOhm : br.xNormalOhm) || 0);
      const zPu = C(rOhm / zBase, xOhm / zBase);
      y = inv(zPu);
      yff = y;
      ytt = y;
      yft = scale(y, -1);
      ytf = scale(y, -1);
      ratingMVA = Number(br.ratingMVA) || Math.sqrt(3) * (Number(br.voltageClass) || nf.baseKV) * (Number(br.ratedCurrent) || 600) / 1000;
      params = {
        zBase, zPu, yPu: y, rOhm, xOhm,
        faultCurrent: br.type === 'fcl' ? faultCurrent : undefined
      };
    }
    Y[f][f] = add(Y[f][f], yff);
    Y[f][t] = add(Y[f][t], yft);
    Y[t][f] = add(Y[t][f], ytf);
    Y[t][t] = add(Y[t][t], ytt);
    branches.push({
      ref: br,
      id: br.id,
      name: br.name,
      tag: br.tag,
      type: br.type,
      from: nf.index,
      to: nt.index,
      fromBus: br.from,
      toBus: br.to,
      y, yff, yft, ytf, ytt,
      yshFrom: br.type === 'line' ? yft ? C(0, 0) : C(0, 0) : C(0, 0),
      ratingMVA,
      params
    });
  }

  // Three-winding transformer: star equivalent with a virtual internal node.
  for (const br of branchesRaw) {
    if (br.type !== 'transformer3' || br.status !== 'in') continue;
    if (br.fromSwitch === 'open' || br.toSwitch === 'open' || br.thirdSwitch === 'open') continue;
    const star = threeWStar.get(br.id);
    if (!star) continue;
    const ids = [br.from, br.to, br.third];
    const physical = ids.map((id) => busNode.get(id));
    if (physical.some((x) => !x)) continue;
    const params = threeWindingParameters(br, physical[0].baseKV, physical[1].baseKV, physical[2].baseKV, baseMVA);
    for (let k = 0; k < params.windings.length; k++) {
      const w = params.windings[k];
      const nf = physical[k];
      const y = inv(w.zPu);
      const tap = Math.max(w.tap, 1e-6);
      const tap2 = tap * tap;
      const yff = add(scale(y, 1 / tap2), k === 0 ? params.ym : C(0, 0));
      const yft = scale(y, -1 / tap);
      const ytf = scale(y, -1 / tap);
      const ytt = y;
      const f = nf.index;
      const t = star.index;
      Y[f][f] = add(Y[f][f], yff);
      Y[f][t] = add(Y[f][t], yft);
      Y[t][f] = add(Y[t][f], ytf);
      Y[t][t] = add(Y[t][t], ytt);
      const ratingMVA = Number(br.ratingMVA) || params.sn;
      branches.push({
        ref: br,
        id: `${br.id}-${w.key}`,
        parentId: br.id,
        name: `${br.name} · ${w.key} 绕组`,
        tag: `${br.tag || 'T'}-${w.key}`,
        type: 'transformer3',
        winding: w.key,
        from: f,
        to: t,
        fromBus: ids[k],
        toBus: null,
        y, yff, yft, ytf, ytt,
        yshFrom: C(0, 0),
        ratingMVA,
        params: { ...w, zPu: w.zPu, tap, sn: params.sn, threeWinding: true, winding: w.key }
      });
    }
  }

  // Shunt devices are admittances in the Y-bus (capacitive supplies reactive power).
  const shunts = [];
  for (const node of nodes) {
    for (const sh of node.shunts) {
      const q = (Number(sh.q) || 0) / baseMVA; // pu at 1.0 p.u. voltage
      const y = C(0, q);
      stampShunt(node.index, y);
      shunts.push({ ref: sh, node: node.index, y, qMvar: Number(sh.q) || 0 });
    }
  }

  // Connectivity / island detection over active impedance branches.
  const adj = nodes.map(() => []);
  for (const br of branches) {
    adj[br.from].push(br.to);
    adj[br.to].push(br.from);
  }
  const visited = new Array(nodes.length).fill(-1);
  const islands = [];
  for (let i = 0; i < nodes.length; i++) {
    if (visited[i] >= 0) continue;
    const stack = [i];
    const island = [];
    visited[i] = islands.length;
    while (stack.length) {
      const u = stack.pop();
      island.push(u);
      for (const v of adj[u]) if (visited[v] < 0) { visited[v] = islands.length; stack.push(v); }
    }
    islands.push(island);
  }
  for (let k = 0; k < islands.length; k++) {
    const hasSlack = islands[k].some((i) => nodes[i].type === 'slack');
    if (!hasSlack) {
      errors.push(`电气岛 ${k + 1}（${islands[k].map((i) => nodes[i].shortName).join('、')}）没有平衡节点，潮流方程无法求解。`);
    }
  }
  for (const island of islands) {
    const slacks = island.filter((i) => nodes[i].type === 'slack');
    if (slacks.length > 1) {
      warnings.push(`电气岛中存在 ${slacks.length} 个平衡节点，各节点电压/相角将分别固定。`);
    }
  }

  // Also validate for singular Y when an isolated node is PQ only.
  if (!branches.length && nodes.length > 1) {
    warnings.push('网络没有可计算的阻抗支路，节点导纳矩阵可能奇异。');
  }

  return {
    project, baseMVA,
    buses, busMap, nodes, busNode,
    branches, shunts, skippedSwitches: skipped, shortedBranches: shorted,
    Y, islands, islandOf: visited,
    warnings, errors,
    injectionRefs: injectionsRaw
  };
}

export function nodeSpec(net, i) {
  const n = net.nodes[i];
  return {
    type: n.type,
    P: n.pSpec / net.baseMVA,
    Q: n.qSpec / net.baseMVA,
    Vm: n.vmSet,
    Va: n.vaSet
  };
}

function calcPQ(net, V, th) {
  const n = net.nodes.length;
  const P = new Array(n).fill(0);
  const Q = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const Yij = net.Y[i][j];
      if (Math.abs(Yij.re) + Math.abs(Yij.im) < 1e-16) continue;
      const d = th[i] - th[j];
      const cs = Math.cos(d);
      const sn = Math.sin(d);
      P[i] += V[i] * V[j] * (Yij.re * cs + Yij.im * sn);
      Q[i] += V[i] * V[j] * (Yij.re * sn - Yij.im * cs);
    }
  }
  return { P, Q };
}

export function buildJacobian(net, V, th, P, Q) {
  const nodes = net.nodes;
  const angleIdx = [];
  const pqIdx = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'slack') angleIdx.push(i);
    if (nodes[i].type === 'PQ') pqIdx.push(i);
  }
  const nA = angleIdx.length;
  const nV = pqIdx.length;
  const H = Array.from({ length: nA }, () => new Array(nA).fill(0));
  const N = Array.from({ length: nA }, () => new Array(nV).fill(0));
  const M = Array.from({ length: nV }, () => new Array(nA).fill(0));
  const L = Array.from({ length: nV }, () => new Array(nV).fill(0));
  const aPos = new Map(angleIdx.map((v, k) => [v, k]));
  const vPos = new Map(pqIdx.map((v, k) => [v, k]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      const g = net.Y[i][j].re;
      const b = net.Y[i][j].im;
      if (Math.abs(g) + Math.abs(b) < 1e-16) continue;
      const d = th[i] - th[j];
      const cs = Math.cos(d);
      const sn = Math.sin(d);
      if (i === j) {
        if (aPos.has(i) && aPos.has(j)) {
          H[aPos.get(i)][aPos.get(j)] = -Q[i] - b * V[i] * V[i];
        }
        if (aPos.has(i) && vPos.has(j)) {
          N[aPos.get(i)][vPos.get(j)] = P[i] / V[i] + g * V[i];
        }
        if (vPos.has(i) && aPos.has(j)) {
          M[vPos.get(i)][aPos.get(j)] = P[i] - g * V[i] * V[i];
        }
        if (vPos.has(i) && vPos.has(j)) {
          L[vPos.get(i)][vPos.get(j)] = Q[i] / V[i] - b * V[i];
        }
      } else {
        if (aPos.has(i) && aPos.has(j)) {
          H[aPos.get(i)][aPos.get(j)] = V[i] * V[j] * (g * sn - b * cs);
        }
        if (aPos.has(i) && vPos.has(j)) {
          N[aPos.get(i)][vPos.get(j)] = V[i] * (g * cs + b * sn);
        }
        if (vPos.has(i) && aPos.has(j)) {
          M[vPos.get(i)][aPos.get(j)] = -V[i] * V[j] * (g * cs + b * sn);
        }
        if (vPos.has(i) && vPos.has(j)) {
          L[vPos.get(i)][vPos.get(j)] = V[i] * (g * sn - b * cs);
        }
      }
    }
  }
  const J = Array.from({ length: nA + nV }, () => new Array(nA + nV).fill(0));
  for (let r = 0; r < nA; r++) {
    for (let c = 0; c < nA; c++) J[r][c] = H[r][c];
    for (let c = 0; c < nV; c++) J[r][nA + c] = N[r][c];
  }
  for (let r = 0; r < nV; r++) {
    for (let c = 0; c < nA; c++) J[nA + r][c] = M[r][c];
    for (let c = 0; c < nV; c++) J[nA + r][nA + c] = L[r][c];
  }
  return { J, H, N, M, L, angleIdx, pqIdx, nA, nV };
}

export function buildDecoupledMatrices(net, variant = 'xb') {
  const n = net.nodes.length;
  const Bp = Array.from({ length: n }, () => new Array(n).fill(0));
  const BppFull = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      BppFull[i][j] = -net.Y[i][j].im;
    }
  }
  // X-only susceptance matrix from series reactances (no shunt/charging).
  for (const br of net.branches) {
    const x = br.params.zPu?.im ?? 0;
    const r = br.params.zPu?.re ?? 0;
    // Fast-decoupled classical approximation uses 1/x; fall back to series B for x≈0.
    let b;
    if (Math.abs(x) > 1e-9) b = 1 / x;
    else {
      const den = (r * r + x * x) || 1;
      b = -(-x / den);
    }
    Bp[br.from][br.from] += b;
    Bp[br.to][br.to] += b;
    Bp[br.from][br.to] -= b;
    Bp[br.to][br.from] -= b;
  }
  const angleIdx = [];
  const pqIdx = [];
  for (let i = 0; i < n; i++) {
    if (net.nodes[i].type !== 'slack') angleIdx.push(i);
    if (net.nodes[i].type === 'PQ') pqIdx.push(i);
  }
  const sub = (M, idx) => idx.map((i) => idx.map((j) => M[i][j]));
  const matrices = {
    BpFull: Bp,
    BppFull,
    Bp: sub(Bp, angleIdx),
    Bpp: sub(BppFull, pqIdx),
    angleIdx,
    pqIdx
  };
  if (variant === 'bx') {
    matrices.Bp = sub(BppFull, angleIdx);
    matrices.Bpp = sub(Bp, pqIdx);
    matrices.note = 'BX 方案：B′ 取完整节点电纳（去并联支路），B″ 取串联电抗支路。';
  } else {
    matrices.note = 'XB 方案：B′ 取串联电抗支路，B″ 取完整节点电纳（含并联充电）。';
  }
  return matrices;
}

function flatStart(net) {
  const V = net.nodes.map((n) => (n.type === 'PQ' ? Math.max(0.8, Math.min(1.2, n.vmSet || 1)) : n.vmSet || 1));
  const th = net.nodes.map((n) => (n.type === 'slack' ? n.vaSet || 0 : 0));
  return { V, th };
}

function maxMismatch(Psp, Qsp, P, Q, nodes) {
  let m = 0;
  let pMax = 0;
  let qMax = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'slack') {
      const d = Math.abs(Psp[i] - P[i]);
      pMax = Math.max(pMax, d);
      m = Math.max(m, d);
    }
    if (nodes[i].type === 'PQ') {
      const d = Math.abs(Qsp[i] - Q[i]);
      qMax = Math.max(qMax, d);
      m = Math.max(m, d);
    }
  }
  return { max: m, pMax, qMax };
}

function makeResultBase(net, algorithm, opts) {
  return {
    algorithm,
    algorithmLabel: ALGO_LABELS[algorithm] || algorithm,
    options: { ...opts },
    net,
    busResults: [],
    branchResults: [],
    generatorResults: [],
    converged: false,
    iterations: 0,
    history: [],
    mismatch: Infinity,
    elapsedMs: 0,
    dc: algorithm === 'dc'
  };
}

const ALGO_LABELS = {
  nr: '牛顿-拉夫逊法（极坐标）',
  'fdpf-xb': 'PQ 分解法 · XB 方案',
  'fdpf-bx': 'PQ 分解法 · BX 方案',
  gs: '高斯-赛德尔迭代法',
  dc: '直流潮流法'
};

export const ALGORITHMS = [
  { id: 'nr', label: '牛顿-拉夫逊法', sub: '极坐标 / 完整雅可比', badge: '推荐' },
  { id: 'fdpf-xb', label: 'PQ 分解法 · XB', sub: '快速解耦 / 工业常用', badge: '' },
  { id: 'fdpf-bx', label: 'PQ 分解法 · BX', sub: '快速解耦 / 变体', badge: '' },
  { id: 'gs', label: '高斯-赛德尔法', sub: '经典迭代 / 教学对比', badge: '' },
  { id: 'dc', label: '直流潮流法', sub: '线性化 / 有功快速估算', badge: '' }
];

export function runPowerFlow(project, options = {}) {
  const opts = {
    algorithm: 'nr',
    tol: 1e-8,
    maxIter: 30,
    damping: 1,
    qLimits: false,
    ...options
  };
  const net = buildNetwork(project, { baseMVA: opts.baseMVA });
  if (net.errors.length) {
    const err = new Error(net.errors[0]);
    err.details = net.errors;
    err.network = net;
    throw err;
  }
  const started = performance.now();
  const result = makeResultBase(net, opts.algorithm, opts);
  const n = net.nodes.length;
  const Psp = net.nodes.map((nd) => nd.pSpec / net.baseMVA);
  const Qsp = net.nodes.map((nd) => nd.qSpec / net.baseMVA);
  let V = net.nodes.map((node) => (node.type === 'slack' || node.type === 'PV' ? node.vmSet : 1.0));
  let th = net.nodes.map((node) => (node.type === 'slack' ? node.vaSet : 0));
  if (opts.algorithm === 'dc') {
    const dc = solveDC(net, Psp, V, th);
    Object.assign(result, dc);
    finalizeResult(net, result, dc.V, dc.th, Psp, Qsp, true, opts);
    result.elapsedMs = performance.now() - started;
    return result;
  }

  let converged = false;
  let iter = 0;
  let mismatch = Infinity;
  let history = [];
  let totalIterations = 0;
  const qLimitActions = [];
  const maxOuter = 5;

  for (let outer = 0; outer < maxOuter; outer++) {
    const stageHistory = [];
    if (opts.algorithm === 'gs') {
      const gs = solveGaussSeidel(net, Psp, Qsp, V, th, opts, stageHistory);
      V = gs.V; th = gs.th; converged = gs.converged; iter = gs.iterations; mismatch = gs.mismatch;
    } else if (opts.algorithm === 'fdpf-xb' || opts.algorithm === 'fdpf-bx') {
      const fd = solveFastDecoupled(net, Psp, Qsp, V, th, opts, stageHistory, opts.algorithm === 'fdpf-bx' ? 'bx' : 'xb');
      V = fd.V; th = fd.th; converged = fd.converged; iter = fd.iterations; mismatch = fd.mismatch;
    } else {
      const nr = solveNewton(net, Psp, Qsp, V, th, opts, stageHistory);
      V = nr.V; th = nr.th; converged = nr.converged; iter = nr.iterations; mismatch = nr.mismatch;
      result.jacobian = nr.jacobian;
    }
    totalIterations += iter;
    history = stageHistory;
    if (!opts.qLimits || !converged) break;
    const pq = calcPQ(net, V, th);
    const convert = [];
    for (let i = 0; i < n; i++) {
      const node = net.nodes[i];
      if (node.type !== 'PV') continue;
      const qGen = pq.Q[i] * net.baseMVA + node.loadQ;
      if (qGen < node.qMin - 1e-4 || qGen > node.qMax + 1e-4) {
        const qLim = Math.max(node.qMin, Math.min(node.qMax, qGen));
        if (!(node.qMax > node.qMin)) continue;
        convert.push({ i, node, qGen, qLim });
      }
    }
    if (!convert.length) break;
    for (const c of convert) {
      c.node.type = 'PQ';
      c.node.qSpec = c.qLim - c.node.loadQ;
      c.node.genQfixed = c.qLim;
      Qsp[c.i] = c.node.qSpec / net.baseMVA;
      qLimitActions.push({
        busId: c.node.busIds[0],
        busName: c.node.name,
        type: 'PV→PQ',
        required: c.qGen,
        limit: c.qLim,
        qMin: c.node.qMin,
        qMax: c.node.qMax
      });
      net.warnings.push(`PV 节点“${c.node.name}”无功需求 ${c.qGen.toFixed(1)} Mvar 越限，已按限值 ${c.qLim.toFixed(1)} Mvar 转为 PQ 节点。`);
    }
  }

  result.converged = converged;
  result.iterations = iter;
  result.totalIterations = totalIterations;
  result.mismatch = mismatch;
  result.history = history;
  result.qLimitActions = qLimitActions;
  finalizeResult(net, result, V, th, Psp, Qsp, converged, opts);
  result.elapsedMs = performance.now() - started;
  return result;
}

function solveNewton(net, Psp, Qsp, V0, th0, opts, history) {
  const nodes = net.nodes;
  const V = V0.slice();
  const th = th0.slice();
  const angleIdx = [];
  const pqIdx = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'slack') angleIdx.push(i);
    if (nodes[i].type === 'PQ') pqIdx.push(i);
  }
  let converged = false;
  let mismatch = Infinity;
  let jacobian = null;
  let iter = 0;
  for (iter = 0; iter <= opts.maxIter; iter++) {
    const { P, Q } = calcPQ(net, V, th);
    const mm = maxMismatch(Psp, Qsp, P, Q, nodes);
    mismatch = mm.max;
    history.push({ iter, pMax: mm.pMax, qMax: mm.qMax, max: mm.max, vMin: Math.min(...V), vMax: Math.max(...V) });
    if (mm.max < opts.tol) { converged = true; break; }
    if (iter === opts.maxIter) break;
    const mis = [];
    for (const i of angleIdx) mis.push(Psp[i] - P[i]);
    for (const i of pqIdx) mis.push(Qsp[i] - Q[i]);
    jacobian = buildJacobian(net, V, th, P, Q);
    let dx;
    try {
      dx = solveReal(jacobian.J, mis);
    } catch (e) {
      e.message = `第 ${iter + 1} 次迭代雅可比矩阵奇异：${e.message}`;
      throw e;
    }
    const nA = angleIdx.length;
    const damping = Number(opts.damping) > 0 ? Math.min(1, Number(opts.damping)) : 1;
    for (let k = 0; k < nA; k++) th[angleIdx[k]] += damping * dx[k];
    for (let k = 0; k < pqIdx.length; k++) {
      V[pqIdx[k]] = Math.max(0.25, Math.min(1.65, V[pqIdx[k]] + damping * dx[nA + k]));
    }
  }
  // final P/Q at the final state for reporting
  const end = calcPQ(net, V, th);
  if (!jacobian) jacobian = buildJacobian(net, V, th, end.P, end.Q);
  return { V, th, converged, iterations: Math.min(iter, opts.maxIter), mismatch, jacobian };
}

function solveFastDecoupled(net, Psp, Qsp, V0, th0, opts, history, variant) {
  const nodes = net.nodes;
  const V = V0.slice();
  const th = th0.slice();
  const mats = buildDecoupledMatrices(net, variant);
  const angleIdx = mats.angleIdx;
  const pqIdx = mats.pqIdx;
  const nA = angleIdx.length;
  const nQ = pqIdx.length;
  const aPos = new Map(angleIdx.map((i, k) => [i, k]));
  const qPos = new Map(pqIdx.map((i, k) => [i, k]));
  let converged = false;
  let mismatch = Infinity;
  let iter = 0;
  const Bp = mats.Bp;
  const Bpp = mats.Bpp;
  for (iter = 0; iter <= opts.maxIter; iter++) {
    const { P, Q } = calcPQ(net, V, th);
    const mm = maxMismatch(Psp, Qsp, P, Q, nodes);
    mismatch = mm.max;
    history.push({ iter, pMax: mm.pMax, qMax: mm.qMax, max: mm.max, vMin: Math.min(...V), vMax: Math.max(...V) });
    if (mm.max < opts.tol) { converged = true; break; }
    if (iter === opts.maxIter) break;
    const dpv = angleIdx.map((i) => (Psp[i] - P[i]) / V[i]);
    const dqv = pqIdx.map((i) => (Qsp[i] - Q[i]) / V[i]);
    let dTheta;
    let dV;
    try {
      dTheta = solveReal(Bp, dpv);
      dV = solveReal(Bpp, dqv);
    } catch (e) {
      e.message = `第 ${iter + 1} 次 PQ 分解迭代矩阵奇异：${e.message}`;
      throw e;
    }
    for (let k = 0; k < nA; k++) th[angleIdx[k]] += dTheta[k];
    for (let k = 0; k < nQ; k++) V[pqIdx[k]] = Math.max(0.25, Math.min(1.65, V[pqIdx[k]] + dV[k]));
    if (nA === 0 && nQ === 0) break;
  }
  return { V, th, converged, iterations: Math.min(iter, opts.maxIter), mismatch };
}

function solveGaussSeidel(net, Psp, Qsp, V0, th0, opts, history) {
  const nodes = net.nodes;
  const Vc = V0.map((v, i) => fromPolar(v, th0[i]));
  let mismatch = Infinity;
  let converged = false;
  let iter = 0;
  for (iter = 0; iter < opts.maxIter; iter++) {
    let maxChange = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].type === 'slack') continue;
      let Iother = C(0, 0);
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        Iother = add(Iother, mul(net.Y[i][j], Vc[j]));
      }
      if (nodes[i].type === 'PQ') {
        const S = C(Psp[i], Qsp[i]);
        const currentInj = conj(div(S, Vc[i]));
        const newV = div(sub(currentInj, Iother), net.Y[i][i]);
        maxChange = Math.max(maxChange, abs(sub(newV, Vc[i])));
        Vc[i] = newV;
      } else {
        // PV: evaluate the reactive injection needed at the present voltage, then
        // update the phase while holding the voltage magnitude.
        const Scalc = mul(Vc[i], conj(add(mul(net.Y[i][i], Vc[i]), Iother)));
        const Q = Scalc.im;
        const S = C(Psp[i], Q);
        const currentInj = conj(div(S, Vc[i]));
        let newV = div(sub(currentInj, Iother), net.Y[i][i]);
        const vm = nodes[i].vmSet;
        newV = fromPolar(vm, arg(newV));
        maxChange = Math.max(maxChange, abs(sub(newV, Vc[i])));
        Vc[i] = newV;
      }
    }
    const V = Vc.map(abs);
    const th = Vc.map(arg);
    const { P, Q } = calcPQ(net, V, th);
    const mm = maxMismatch(Psp, Qsp, P, Q, nodes);
    mismatch = mm.max;
    history.push({ iter: iter + 1, pMax: mm.pMax, qMax: mm.qMax, max: mm.max, vMin: Math.min(...V), vMax: Math.max(...V) });
    if (mm.max < opts.tol) { converged = true; break; }
    // keep angle reference at slack
    for (let i = 0; i < nodes.length; i++) if (nodes[i].type === 'slack') Vc[i] = fromPolar(nodes[i].vmSet, nodes[i].vaSet);
  }
  return { V: Vc.map(abs), th: Vc.map(arg), converged, iterations: Math.min(iter + 1, opts.maxIter), mismatch };
}

function solveDC(net, Psp, V0, th0) {
  const nodes = net.nodes;
  const n = nodes.length;
  const B = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const br of net.branches) {
    const x = br.params.zPu?.im ?? 0;
    if (Math.abs(x) < 1e-9) continue;
    const b = 1 / x;
    B[br.from][br.from] += b;
    B[br.to][br.to] += b;
    B[br.from][br.to] -= b;
    B[br.to][br.from] -= b;
  }
  const angleIdx = [];
  for (let i = 0; i < n; i++) if (nodes[i].type !== 'slack') angleIdx.push(i);
  const rhs = angleIdx.map((i) => Psp[i]);
  let theta = th0.slice();
  if (angleIdx.length) {
    const sub = angleIdx.map((i) => angleIdx.map((j) => B[i][j]));
    const sol = solveReal(sub, rhs);
    angleIdx.forEach((i, k) => { theta[i] = sol[k]; });
  }
  // One DC iteration to enforce slack angle.
  for (let i = 0; i < n; i++) if (nodes[i].type === 'slack') theta[i] = nodes[i].vaSet;
  const V = nodes.map(() => 1.0);
  const history = [{ iter: 1, pMax: 0, qMax: 0, max: 0, vMin: 1, vMax: 1 }];
  return { V, th: theta, converged: true, iterations: 1, mismatch: 0, history, dc: true, dcB: B, dcAngleIdx: angleIdx };
}

function finalizeResult(net, result, V, th, Psp, Qsp, converged, opts) {
  const nodes = net.nodes;
  const baseMVA = net.baseMVA;
  const n = nodes.length;
  const P = new Array(n).fill(0);
  const Q = new Array(n).fill(0);
  if (!result.dc) {
    const pq = calcPQ(net, V, th);
    P.splice(0, n, ...pq.P);
    Q.splice(0, n, ...pq.Q);
  } else {
    for (let i = 0; i < n; i++) {
      P[i] = Psp[i];
      if (nodes[i].type === 'slack') {
        let injection = 0;
        for (const br of net.branches) {
          if (br.from === i) injection += (th[i] - th[br.to]) / (br.params.zPu?.im || 1);
          if (br.to === i) injection += (th[i] - th[br.from]) / (br.params.zPu?.im || 1);
        }
        P[i] = injection;
      }
    }
  }

  const busResults = [];
  const genResults = [];
  const busById = new Map();
  for (const bus of net.buses) {
    const node = net.busNode.get(bus.id);
    const i = node.index;
    const vm = V[i];
    const va = th[i] * R2D;
    const pCalc = P[i] * baseMVA;
    const qCalc = Q[i] * baseMVA;
    const pLoad = node.loadP;
    const qLoad = node.loadQ;
    let pGen;
    let qGen;
    if (opts.algorithm === 'dc') {
      pGen = (node.type === 'slack' ? P[i] * baseMVA + pLoad : node.genP);
      qGen = null;
    } else if (node.type === 'slack') {
      pGen = pCalc + pLoad;
      qGen = qCalc + qLoad;
    } else if (node.type === 'PV') {
      pGen = node.genP;
      qGen = qCalc + qLoad;
    } else {
      pGen = node.genP;
      qGen = node.genQfixed;
    }
    const shuntQ = node.shunts.reduce((s, sh) => s + (Number(sh.q) || 0) * vm * vm, 0);
    const br = {
      busId: bus.id,
      nodeIndex: i,
      name: bus.name,
      tag: bus.tag,
      vn: node.baseKV || bus.vn,
      type: node.type,
      Vm: V[i],
      Va: va,
      VkV: V[i] * (node.baseKV || bus.vn),
      pGen, qGen, pLoad, qLoad,
      pNet: pGen - pLoad,
      qNet: qGen == null ? null : qGen - qLoad,
      shuntQ,
      qMin: node.qMin,
      qMax: node.qMax,
      generators: node.generators.map((g) => g.name),
      loads: node.loads.map((g) => g.name),
      inService: true
    };
    busResults.push(br);
    busById.set(bus.id, br);

    // Allocate aggregate generator output for equipment-level tables.
    if (node.generators.length) {
      const totalRated = node.generators.reduce((s, g) => s + (Number(g.ratedMVA) || 1), 0) || 1;
      let allocP = pGen;
      let allocQ = qGen;
      node.generators.forEach((g, k) => {
        const share = (Number(g.ratedMVA) || 1) / totalRated;
        const gp = node.type === 'slack' ? allocP * share : Number(g.p) || 0;
        const gq = qGen == null ? null : (node.type === 'slack' || node.type === 'PV' ? allocQ * share : Number(g.q) || 0);
        genResults.push({
          id: g.id, name: g.name, tag: g.tag, busId: bus.id, busName: bus.name,
          p: gp, q: gq, ratedMVA: g.ratedMVA, kind: g.kind,
          qMin: g.qMin, qMax: g.qMax
        });
        if (node.type === 'slack') allocP -= gp;
        if (node.type === 'slack' || node.type === 'PV') allocQ -= gq;
      });
    }
  }

  const branchResults = [];
  for (const br of net.branches) {
    const i = br.from;
    const j = br.to;
    const Vf = fromPolar(V[i], th[i]);
    const Vt = fromPolar(V[j], th[j]);
    let If;
    let It;
    if (br.type === 'line') {
      // Recover the half charging admittance from the stamped matrix.
      const yShHalf = sub(br.yff, br.y);
      If = add(mul(br.y, sub(Vf, Vt)), mul(yShHalf, Vf));
      It = add(mul(br.y, sub(Vt, Vf)), mul(yShHalf, Vt));
    } else {
      If = add(mul(br.yff, Vf), mul(br.yft, Vt));
      It = add(mul(br.ytt, Vt), mul(br.ytf, Vf));
    }
    const Sf = scale(mul(Vf, conj(If)), baseMVA);
    const St = scale(mul(Vt, conj(It)), baseMVA);
    const loss = add(Sf, St);
    const iFrom = abs(Sf) / (Math.sqrt(3) * Math.max(V[i] * net.nodes[i].baseKV, 1e-9));
    const iTo = abs(St) / (Math.sqrt(3) * Math.max(V[j] * net.nodes[j].baseKV, 1e-9));
    const flow = Math.max(abs(Sf), abs(St));
    let row = {
      id: br.id, name: br.name, tag: br.tag, type: br.type,
      parentId: br.parentId, winding: br.winding,
      fromBusId: br.fromBus, toBusId: br.toBus,
      fromName: net.nodes[i].shortName, toName: net.nodes[j].shortName,
      pFrom: Sf.re, qFrom: Sf.im, pTo: St.re, qTo: St.im,
      pLoss: loss.re, qLoss: loss.im,
      iFrom, iTo, current: Math.max(iFrom, iTo),
      loading: br.ratingMVA > 0 ? (flow / br.ratingMVA) * 100 : 0,
      ratingMVA: br.ratingMVA,
      status: 'closed', rating: br.ratingMVA
    };
    if (result.dc) {
      const x = br.params.zPu?.im || 1e-6;
      const p = ((th[i] - th[j]) / x) * baseMVA;
      row.pFrom = p;
      row.pTo = -p;
      row.qFrom = 0;
      row.qTo = 0;
      row.pLoss = 0;
      row.qLoss = 0;
      row.current = Math.abs(p) / (Math.sqrt(3) * Math.max((V[i] * net.nodes[i].baseKV), 1e-9));
      row.iFrom = row.current;
      row.iTo = row.current;
      row.loading = br.ratingMVA > 0 ? (Math.abs(p) / br.ratingMVA) * 100 : 0;
    }
    branchResults.push(row);
  }
  // Add explicit zero-impedance branch rows for completeness in diagrams/tables.
  for (const br of net.shortedBranches) {
    branchResults.push({
      id: br.id, name: br.name, tag: br.tag, type: br.type,
      fromBusId: br.from, toBusId: br.to,
      fromName: net.busMap.get(br.from)?.name || '', toName: net.busMap.get(br.to)?.name || '',
      pFrom: 0, qFrom: 0, pTo: 0, qTo: 0, pLoss: 0, qLoss: 0,
      iFrom: 0, iTo: 0, current: 0, loading: 0, ratingMVA: Number(br.ratingMVA) || 0,
      status: 'closed', zeroImpedance: true
    });
  }

  const totalPGen = busResults.reduce((s, b) => s + (b.pGen || 0), 0);
  const totalQGen = busResults.reduce((s, b) => s + (b.qGen || 0), 0);
  const totalPLoad = busResults.reduce((s, b) => s + b.pLoad, 0);
  const totalQLoad = busResults.reduce((s, b) => s + b.qLoad, 0);
  const shuntQ = busResults.reduce((s, b) => s + b.shuntQ, 0);
  const lossP = result.dc ? 0 : branchResults.reduce((s, b) => s + (b.pLoss || 0), 0);
  const lossQ = result.dc ? 0 : branchResults.reduce((s, b) => s + (b.qLoss || 0), 0);
  const vmValues = busResults.map((b) => b.Vm);
  const vMin = Math.min(...vmValues);
  const vMax = Math.max(...vmValues);
  const violations = busResults.filter((b) => b.Vm < 0.95 - 1e-9 || b.Vm > 1.05 + 1e-9);
  const overloads = branchResults.filter((b) => b.loading > 100 + 1e-6);
  result.V = V;
  result.th = th;
  result.P = P;
  result.Q = Q;
  result.busResults = busResults;
  result.branchResults = branchResults;
  result.generatorResults = genResults;
  result.busById = Object.fromEntries(busResults.map((b) => [b.busId, b]));
  result.totals = {
    pGen: totalPGen, qGen: totalQGen,
    pLoad: totalPLoad, qLoad: totalQLoad,
    shuntQ, lossP, lossQ,
    pBalance: totalPGen - totalPLoad - lossP,
    qBalance: totalQGen - totalQLoad + shuntQ - lossQ
  };
  result.vMin = vMin;
  result.vMax = vMax;
  result.violations = violations;
  result.overloads = overloads;
  result.converged = converged;
  result.dc = opts.algorithm === 'dc';
  result.label = ALGO_LABELS[opts.algorithm] || opts.algorithm;
  // Q-limit diagnostics (not enforced automatically).
  result.qLimitViolations = [];
  for (const bus of busResults) {
    if (bus.type === 'PV' && bus.qGen != null && (bus.qGen < bus.qMin - 1e-4 || bus.qGen > bus.qMax + 1e-4)) {
      result.qLimitViolations.push(bus);
    }
  }
}

export function getJacobianForResult(result) {
  if (!result || !result.net) throw new Error('请先计算潮流。');
  const net = result.net;
  const V = result.V;
  const th = result.th;
  if (result.dc) throw new Error('直流潮流不生成极坐标雅可比矩阵。');
  const pq = calcPQ(net, V, th);
  return buildJacobian(net, V, th, pq.P, pq.Q);
}

export function getDecoupledForResult(result, variant = 'xb') {
  if (!result || !result.net) throw new Error('请先计算潮流。');
  return buildDecoupledMatrices(result.net, variant);
}

export function getMatrices(result, variant = 'xb') {
  const jac = getJacobianForResult(result);
  const dec = getDecoupledForResult(result, variant);
  return { jac, dec };
}

export function busVoltageReport(result) {
  if (!result) return [];
  return result.busResults.map((b) => ({
    ...b,
    status: b.Vm < 0.95 ? '低电压' : b.Vm > 1.05 ? '高电压' : '正常'
  }));
}

export function formatAlgorithm(id) {
  return ALGO_LABELS[id] || id;
}

export function networkFingerprint(net) {
  return `${net.nodes.length}:${net.branches.length}:${net.Y.map((r) => r.map((v) => v.re.toFixed(6) + v.im.toFixed(6)).join(',')).join(';')}`;
}

export function lineImpedanceOhm(br) {
  const p = lineParameters(br);
  return { R: p.R, X: p.X, B: p.B, Z: Math.hypot(p.R, p.X), zEq: p.zEq };
}
