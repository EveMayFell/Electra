import { newBus, newBranch, newInjection, ensureRelays, emptyProject } from '../model.js';
import { createIndustrialProject, createLargeProject } from './largeExamples.js';

// A compact 7-bus, three-voltage-level demonstration network.
// It is intentionally lossy and meshed so that all solvers show meaningful flows.
export function createRegionalProject() {
  const p = emptyProject();
  p.meta = {
    ...p.meta,
    name: '滨江区域 500/220/110 kV 输配电网',
    projectNo: 'BJ-GRID-2026-04',
    owner: '滨江电力设计院 · 系统规划室',
    baseMVA: 100,
    frequency: 50,
    date: new Date().toISOString().slice(0, 10),
    note: '示例工程：含 500 kV 平衡节点、220 kV 环网、110 kV 负荷中心与 35 kV 风电汇集站。可自由修改参数并重新计算。'
  };

  const bus = (id, name, tag, vn, type, x, y, width, vm = 1.0, va = 0) => {
    const b = newBus({ name, tag, vn, type, x, y, width, vm, va });
    b.id = id;
    return b;
  };

  p.buses = [
    bus('bus-500', '江北 500 kV 母线', 'BUS-500', 500, 'slack', 205, 185, 390, 1.03, 0),
    bus('bus-220a', '江城 220 kV 母线', 'BUS-220A', 220, 'PQ', 790, 178, 365, 1.0, 0),
    bus('bus-220b', '临港 220 kV 母线', 'BUS-220B', 220, 'PV', 1400, 178, 320, 1.025, 0),
    bus('bus-110a', '高新 110 kV 母线', 'BUS-110A', 110, 'PQ', 660, 470, 330, 1.0, 0),
    bus('bus-110b', '化工 110 kV 母线', 'BUS-110B', 110, 'PQ', 1230, 470, 310, 1.0, 0),
    bus('bus-110c', '新城 110 kV 母线', 'BUS-110C', 110, 'PQ', 1230, 740, 310, 1.0, 0),
    bus('bus-35a', '风电汇集 35 kV 母线', 'BUS-35A', 35, 'PQ', 630, 760, 300, 1.0, 0)
  ];

  const branch = (id, type, from, to, opts) => {
    const br = newBranch(type, from, to, opts);
    br.id = id;
    return br;
  };

  p.branches = [
    branch('br-t1', 'transformer', 'bus-500', 'bus-220a', {
      name: '江北—江城 主变', tag: 'T1', sn: 750, vn1: 525, vn2: 230, uk: 14, pk: 460, p0: 180, i0: 0.28,
      tap: 0, shift: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 11.2, ratingMVA: 750, fromSwitch: 'closed', toSwitch: 'closed'
    }),
    branch('br-l1', 'line', 'bus-220a', 'bus-220b', {
      name: '江临 220 kV 线路', tag: 'L221', length: 62, paramMode: 'distributed',
      rPerKm: 0.08, xPerKm: 0.42, bPerKm: 2.7, voltageClass: 220, conductor: '2×LGJ-400/35',
      ratingMVA: 420, fromSwitch: 'closed', toSwitch: 'closed'
    }),
    branch('br-t2', 'transformer', 'bus-220a', 'bus-110a', {
      name: '江城—高新 主变', tag: 'T2', sn: 240, vn1: 230, vn2: 115, uk: 10.5, pk: 520, p0: 95, i0: 0.22,
      tap: 1.25, shift: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4, ratingMVA: 240
    }),
    branch('br-t3', 'transformer', 'bus-220b', 'bus-110b', {
      name: '临港—化工 主变', tag: 'T3', sn: 240, vn1: 230, vn2: 115, uk: 10.5, pk: 520, p0: 95, i0: 0.22,
      tap: 0, shift: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4, ratingMVA: 240
    }),
    branch('br-l2', 'line', 'bus-110a', 'bus-110b', {
      name: '高化 110 kV 线路', tag: 'L111', length: 24, paramMode: 'distributed',
      rPerKm: 0.12, xPerKm: 0.39, bPerKm: 2.8, voltageClass: 110, conductor: 'LGJ-240/30', ratingMVA: 130
    }),
    branch('br-l3', 'line', 'bus-110b', 'bus-110c', {
      name: '化新 110 kV 线路', tag: 'L112', length: 18, paramMode: 'distributed',
      rPerKm: 0.12, xPerKm: 0.39, bPerKm: 2.8, voltageClass: 110, conductor: 'LGJ-240/30', ratingMVA: 130
    }),
    branch('br-t4', 'transformer', 'bus-110a', 'bus-35a', {
      name: '高新—风电 主变', tag: 'T4', sn: 63, vn1: 115, vn2: 37, uk: 10.5, pk: 180, p0: 32, i0: 0.35,
      tap: 0, shift: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4, ratingMVA: 63
    }),
    branch('br-qf1', 'breaker', 'bus-220a', 'bus-220a', {
      name: '江城母联（示例备用）', tag: 'QF-220', closed: false, ratedCurrent: 2500, breakingCurrent: 50,
      status: 'out', note: '演示用母联开关，默认停运。'
    })
  ];

  // Remove the demonstration loop branch: it references the same bus, which is deliberately
  // not allowed for a meaningful branch. Keep the editor clean instead of shipping a warning.
  p.branches = p.branches.filter((b) => b.id !== 'br-qf1');

  const inj = (id, type, busId, opts) => {
    const x = newInjection(type, busId, opts);
    x.id = id;
    return x;
  };

  p.injections = [
    inj('gen-g1', 'generator', 'bus-500', {
      name: '江北电厂 1 号机', tag: 'G1', pos: 0.2, direction: 'up', p: 0, q: 0,
      qMin: -200, qMax: 300, ratedMVA: 660, kind: '火电', inertia: 7.2
    }),
    inj('gen-g2', 'generator', 'bus-220b', {
      name: '临港燃机 2 号机', tag: 'G2', pos: 0.48, direction: 'up', p: 180, q: 0,
      qMin: -80, qMax: 130, ratedMVA: 220, kind: '燃气', inertia: 5.1
    }),
    inj('gen-wf', 'generator', 'bus-35a', {
      name: '滨海风电汇集', tag: 'WF', pos: 0.3, direction: 'up', p: 45, q: 0, grounded: false,
      qMin: -30, qMax: 30, ratedMVA: 60, kind: '风电', inertia: 2.4
    }),
    inj('load-220a', 'load', 'bus-220a', {
      name: '江城城区负荷', tag: 'LD-220', pos: 0.86, direction: 'down', p: 120, q: 45, loadType: '商业'
    }),
    inj('load-110a', 'load', 'bus-110a', {
      name: '高新工业园负荷', tag: 'LD-110A', pos: 0.94, direction: 'down', p: 92, q: 31, loadType: '工业', motor: true, motorX: 0.2
    }),
    inj('load-110b', 'load', 'bus-110b', {
      name: '化工园负荷', tag: 'LD-110B', pos: 0.15, direction: 'down', labelAlign: 'center', p: 84, q: 29, loadType: '工业', motor: true, motorX: 0.18
    }),
    inj('load-110c', 'load', 'bus-110c', {
      name: '新城综合负荷', tag: 'LD-110C', pos: 0.55, direction: 'down', p: 68, q: 22, loadType: '居民'
    }),
    inj('load-35a', 'load', 'bus-35a', {
      name: '汇集站站用电', tag: 'LD-35', pos: 0.82, direction: 'down', p: 3.2, q: 1.0, loadType: '站用'
    }),
    inj('sh-220a', 'shunt', 'bus-220a', {
      name: '江城并联电抗器', tag: 'R-220', pos: 0.28, direction: 'up', q: -15, kind: 'reactor', ratedKV: 220
    }),
    inj('sh-110a', 'shunt', 'bus-110a', {
      name: '高新电容器组', tag: 'C-110A', pos: 0.55, direction: 'up', q: 25, kind: 'capacitor', ratedKV: 110
    }),
    inj('sh-110c', 'shunt', 'bus-110c', {
      name: '新城电容器组', tag: 'C-110C', pos: 0.3, direction: 'up', q: 15, kind: 'capacitor', ratedKV: 110
    })
  ];

  ensureRelays(p);
  for (const relay of p.relays) relay.mode = 'auto';
  return p;
}

export function createBlankProject() {
  const p = emptyProject();
  p.meta.name = '新建电力工程';
  const b1 = newBus({ name: '220 kV 母线 I', tag: 'BUS-01', vn: 220, type: 'slack', x: 350, y: 260, width: 360, vm: 1.02 });
  const b2 = newBus({ name: '110 kV 母线 I', tag: 'BUS-02', vn: 110, type: 'PQ', x: 900, y: 470, width: 330 });
  const t = newBranch('transformer', b1.id, b2.id, { name: '1 号主变', tag: 'T1', vn1: 230, vn2: 115, sn: 240, uk: 10.5, pk: 520, p0: 95, i0: 0.22, tap: 0 });
  const gen = newInjection('generator', b1.id, { name: '平衡机组', tag: 'G1', pos: 0.28, direction: 'up', p: 0, qMin: -100, qMax: 150, ratedMVA: 300 });
  const load = newInjection('load', b2.id, { name: '综合负荷', tag: 'LD1', pos: 0.55, direction: 'down', p: 80, q: 26 });
  p.buses.push(b1, b2);
  p.branches.push(t);
  p.injections.push(gen, load);
  ensureRelays(p);
  p.view = { x: 140, y: 110, k: 0.9 };
  return p;
}

export { createIndustrialProject, createLargeProject };

export const SAMPLE_PROJECTS = [
  {
    id: 'regional',
    name: '滨江区域输配电网',
    short: '7 节点 · 500/220/110/35 kV',
    description: '区域输配电网，含 500 kV 平衡节点、220 kV 环网、110 kV 负荷中心与 35 kV 风电汇集站。',
    tags: ['区域电网', '风电', '三电压等级'],
    create: createRegionalProject
  },
  {
    id: 'industrial',
    name: '临港装备制造园',
    short: '10 节点 · 220/110/10 kV',
    description: '工业园区配电网，含双回 220 kV 进线、110 kV 环网、10 kV 配电馈线、电动机负荷与自备机组。',
    tags: ['工业园区', '电动机', '配电'],
    create: createIndustrialProject
  },
  {
    id: 'large',
    name: '华东 25 节点环网',
    short: '25 节点 · 500/220/110 kV',
    description: '复杂大型输电网，5 座 500 kV 枢纽、15 座 220 kV 变电站、5 座 110 kV 负荷站、40 条支路与 6 台机组。',
    tags: ['大型电网', '40 支路', 'N-1 / 稳定'],
    create: createLargeProject
  }
];

export function createSampleProject(id = 'regional') {
  const item = SAMPLE_PROJECTS.find((x) => x.id === id) || SAMPLE_PROJECTS[0];
  return item.create();
}
