// Project state, factory helpers, validation and persistence.
export const APP_VERSION = 1;

let seq = 1;
export const uid = (prefix = 'el') => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const clone = (obj) => JSON.parse(JSON.stringify(obj));
import { createProtectionSet, ensureProtectionSet } from './data/protectionCatalog.js';

export const emptyProject = () => ({
  version: APP_VERSION,
  meta: {
    name: '未命名电网工程',
    projectNo: 'PWR-2026-001',
    owner: '设计院 · 电气一次室',
    baseMVA: 100,
    frequency: 50,
    date: new Date().toISOString().slice(0, 10),
    note: '在画布中添加母线、线路、变压器与电源，即可开始潮流分析。'
  },
  buses: [],
  branches: [],
  injections: [],
  relays: [],
  scenarios: [],
  view: { x: 80, y: 70, k: 0.78 }
});

const busPalette = ['#49d7c0', '#5eb7ff', '#f3a95f', '#c69bff', '#ed7e8b', '#8fd36a'];

export function defaultScRating(vn) {
  const v = Number(vn) || 110;
  if (v >= 500) return 63;
  if (v >= 330) return 50;
  if (v >= 220) return 40;
  if (v >= 110) return 31.5;
  if (v >= 35) return 25;
  return 20;
}

export function newBus(opts = {}) {
  return {
    id: uid('bus'),
    name: opts.name || '新母线',
    tag: opts.tag || 'BUS',
    vn: opts.vn ?? 110,
    type: opts.type || 'PQ',
    vm: opts.vm ?? 1.0,
    va: opts.va ?? 0,
    scRating: opts.scRating ?? defaultScRating(opts.vn ?? 110),
    x: opts.x ?? 400,
    y: opts.y ?? 300,
    width: opts.width ?? 300,
    color: opts.color || null,
    note: ''
  };
}

export const SWITCH_TYPES = ['breaker', 'switch', 'loadSwitch', 'disconnector', 'recloser', 'sectionalizer', 'fuse'];
export const SERIES_TYPES = ['seriesReactor', 'seriesCap', 'fcl'];
export const isSwitchType = (type) => SWITCH_TYPES.includes(type);
export const isSeriesType = (type) => SERIES_TYPES.includes(type);

const BRANCH_LABELS = {
  line: ['新建线路', 'L'],
  transformer: ['新建变压器', 'T'],
  transformer3: ['新建三绕组变压器', 'T'],
  breaker: ['母联断路器', 'QF'],
  switch: ['隔离开关', 'QS'],
  loadSwitch: ['负荷开关', 'QL'],
  disconnector: ['隔离开关', 'QS'],
  recloser: ['重合器', 'REC'],
  sectionalizer: ['分段器', 'SEC'],
  fuse: ['熔断器', 'FU'],
  seriesReactor: ['新建串联电抗器', 'SR'],
  seriesCap: ['新建串联电容器', 'SC'],
  fcl: ['故障电流限制器', 'FCL']
};

export function newBranch(type, from, to, opts = {}) {
  const [defaultName, defaultTag] = BRANCH_LABELS[type] || ['支路', 'BR'];
  const base = {
    id: uid('br'),
    type,
    name: opts.name || defaultName,
    tag: opts.tag || defaultTag,
    from,
    to,
    third: opts.third || null,
    status: opts.status || 'in',
    fromSwitch: opts.fromSwitch || 'closed',
    toSwitch: opts.toSwitch || 'closed',
    thirdSwitch: opts.thirdSwitch || 'closed',
    ratingMVA: opts.ratingMVA ?? (type === 'line' ? 150 : isSwitchType(type) ? 0 : 240),
    note: ''
  };
  if (type === 'line') {
    Object.assign(base, {
      lineKind: opts.lineKind || 'overhead',
      insulation: opts.insulation || 'XLPE',
      ampacity: opts.ampacity ?? 600,
      paramMode: 'distributed',
      length: 30,
      rPerKm: 0.12,
      xPerKm: 0.39,
      bPerKm: 2.8,
      R: 3.6,
      X: 11.7,
      B: 84,
      r0PerKm: 0.18,
      x0PerKm: 1.17,
      b0PerKm: 2.24,
      R0: 5.4,
      X0: 35.1,
      B0: 67.2,
      voltageClass: 110,
      conductor: 'LGJ-240/30'
    });
  } else if (type === 'transformer') {
    Object.assign(base, {
      sn: 180,
      vn1: 115,
      vn2: 37,
      uk: 10.5,
      pk: 450,
      p0: 80,
      i0: 0.25,
      tap: 0,
      shift: 0,
      vectorGroup: 'YNd11',
      cooling: 'ONAF',
      zeroMode: 'ground_from',
      zeroUk: 8.4
    });
  } else if (type === 'transformer3') {
    Object.assign(base, {
      sn: 180,
      vnH: 230,
      vnM: 115,
      vnL: 37,
      ukHM: 10.5,
      ukHL: 17,
      ukML: 6.5,
      pk: 600,
      p0: 100,
      i0: 0.25,
      tapH: 0,
      tapM: 0,
      tapL: 0,
      vectorHM: 'YNyn0',
      vectorHL: 'YNd11',
      cooling: 'ONAF',
      zeroMode: 'block'
    });
  } else if (type === 'seriesReactor') {
    Object.assign(base, {
      rOhm: 0.05, xOhm: 2, zeroXOhm: 6, voltageClass: 110, ratedCurrent: 600, ratingMVA: 100
    });
  } else if (type === 'seriesCap') {
    Object.assign(base, {
      rOhm: 0.02, xcOhm: 2, zeroXOhm: 0, voltageClass: 110, ratedCurrent: 600, ratingMVA: 100
    });
  } else if (type === 'fcl') {
    Object.assign(base, {
      rOhm: 0.01, xNormalOhm: 0.02, xFaultOhm: 2, voltageClass: 110, ratedCurrent: 1200, ratingMVA: 200
    });
  } else {
    const switchDefaults = {
      breaker: { ratedCurrent: 2000, breakingCurrent: 40 },
      loadSwitch: { ratedCurrent: 630, breakingCurrent: 0, loadBreakCurrent: 630 },
      switch: { ratedCurrent: 1250, breakingCurrent: 0 },
      disconnector: { ratedCurrent: 1250, breakingCurrent: 0 },
      recloser: { ratedCurrent: 630, breakingCurrent: 20, autoReclose: true, recloseTime: 0.5, recloseAttempts: 2 },
      sectionalizer: { ratedCurrent: 630, breakingCurrent: 0, count: 1 },
      fuse: { ratedCurrent: 100, breakingCurrent: 25 }
    };
    Object.assign(base, { closed: true, ...(switchDefaults[type] || switchDefaults.switch) });
  }
  return Object.assign(base, opts);
}

export function newInjection(type, busId, opts = {}) {
  const base = {
    id: uid('inj'),
    type,
    name: opts.name || ({ generator: '新建发电机', load: '新建负荷', shunt: '并联补偿装置' }[type] || '设备'),
    tag: opts.tag || ({ generator: 'G', load: 'LD', shunt: 'C' }[type] || 'EQ'),
    bus: busId,
    pos: opts.pos ?? 0.5,
    direction: opts.direction || (type === 'load' ? 'down' : 'up'),
    status: 'in',
    note: ''
  };
  if (type === 'generator') {
    Object.assign(base, {
      p: 100,
      q: 0,
      qMin: -60,
      qMax: 80,
      ratedMVA: 150,
      kind: '火电',
      switchClosed: true,
      inertia: 6.5,
      droop: 5,
      governor: true,
      xd: 0.25,
      grounded: true,
      xg0: 0.05,
      pMin: 0,
      pMax: 150,
      costA: 0,
      costB: 280
    });
  } else if (type === 'load') {
    Object.assign(base, { p: 50, q: 16, loadType: '工业', motor: false, motorX: 0.2 });
  } else {
    Object.assign(base, { q: 20, kind: 'capacitor', ratedKV: 110 });
  }
  const result = Object.assign(base, opts);
  if (result.type === 'generator' && opts.pMax == null) result.pMax = Number(result.ratedMVA) || 150;
  return result;
}

export function newRelay(branch, opts = {}) {
  const isLine = branch.type === 'line';
  const ctStandard = [200, 300, 400, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000];
  const rated = Math.max(1, Number(branch.ratingMVA) || 150);
  const vn = Number(branch.voltageClass) || 110;
  const iRated = (rated * 1e6) / (Math.sqrt(3) * vn * 1e3);
  const ct = ctStandard.find((x) => x >= iRated * 1.2) || 3000;
  const result = {
    id: uid('rly'),
    targetType: 'branch',
    branchId: branch.id,
    name: `${branch.tag || branch.name} 保护`,
    enabled: true,
    mode: 'auto',
    functions: isLine ? { distance: true, overcurrent: true } : { differential: true, overcurrent: true },
    ct: { primary: ct, secondary: 5 },
    vt: { primary: vn, secondary: 0.1 },
    distance: {
      z1: (Number(branch.length) || 30) * 0.12 || 4,
      z2: (Number(branch.length) || 30) * 0.16 || 6,
      z3: (Number(branch.length) || 30) * 0.24 || 9,
      t1: 0,
      t2: 0.4,
      t3: 1.2,
      angle: 78,
      k0: 0.67
    },
    overcurrent: {
      pickup: Math.round(iRated * 1.35),
      curve: 'standard',
      tms: 0.2,
      instPickup: Math.round(iRated * 6),
      instTime: 0.05
    },
    reclose: {
      enabled: isLine,
      attempts: isLine ? 1 : 0,
      deadTime: 1.0,
      reclaimTime: 30
    },
    differential: {
      pickup: 0.3,
      slope1: 0.3,
      slope2: 0.7,
      t2: 0.5,
      harmonicBlock: 15,
      t: 0.03
    },
    lastAutoAt: null,
    ...opts
  };
  const category = isLine ? 'line' : 'transformer';
  const z = isLine ? Math.hypot((Number(branch.length) || 30) * (Number(branch.xPerKm) || 0.39), (Number(branch.length) || 30) * (Number(branch.rPerKm) || 0.12)) : 0;
  result.protections = createProtectionSet(category, { z, length: Number(branch.length) || 30, rated: iRated });
  return result;
}

export function newBusRelay(bus, opts = {}) {
  const vn = Number(bus.vn) || 110;
  const scA = (Number(bus.scRating) || 31.5) * 1000;
  const ctStandard = [600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000];
  const ct = ctStandard.find((x) => x >= scA * 0.45) || 5000;
  const result = {
    id: uid('rly'),
    targetType: 'bus',
    busId: bus.id,
    name: `${bus.tag || bus.name} 母线保护`,
    enabled: true,
    mode: 'auto',
    functions: { overcurrent: false },
    ct: { primary: ct, secondary: 5 },
    vt: { primary: vn, secondary: 0.1 },
    distance: null,
    overcurrent: null,
    differential: null,
    reclose: { enabled: false, attempts: 0, deadTime: 1.0, reclaimTime: 30 },
    lastAutoAt: null,
    ...opts
  };
  result.protections = createProtectionSet('bus', { rated: ct * 0.8, vn });
  return result;
}

export function syncRelayLegacyFunctions(relay) {
  if (!relay?.protections) return relay;
  if (relay.targetType === 'bus') return relay;
  const p = relay.protections;
  relay.functions = relay.functions || {};
  if (p.line_distance) relay.functions.distance = !!p.line_distance.enabled;
  if (p.line_overcurrent) relay.functions.overcurrent = !!p.line_overcurrent.enabled;
  if (p.xfmr_differential) relay.functions.differential = !!p.xfmr_differential.enabled;
  if (p.xfmr_overcurrent) relay.functions.overcurrent = !!p.xfmr_overcurrent.enabled;
  if (p.line_reclose && relay.reclose) relay.reclose.enabled = !!p.line_reclose.enabled;
  return relay;
}

export function ensureRelays(project) {
  const active = project.branches.filter((b) => b.type === 'line' || b.type === 'transformer');
  const busIds = new Set(project.buses.map((b) => b.id));
  for (const r of project.relays) {
    if (!r.targetType) r.targetType = r.busId ? 'bus' : 'branch';
  }
  const existing = new Set(project.relays.filter((r) => r.targetType !== 'bus').map((r) => r.branchId));
  for (const branch of active) {
    if (!existing.has(branch.id)) project.relays.push(newRelay(branch));
  }
  const existingBus = new Set(project.relays.filter((r) => r.targetType === 'bus').map((r) => r.busId));
  for (const bus of project.buses) {
    if (!existingBus.has(bus.id)) project.relays.push(newBusRelay(bus));
  }
  project.relays = project.relays.filter((r) => r.targetType === 'bus' ? busIds.has(r.busId) : active.some((b) => b.id === r.branchId));
  for (const r of project.relays) {
    if (r.targetType === 'bus') {
      const bus = project.buses.find((b) => b.id === r.busId);
      ensureProtectionSet(r, 'bus', { rated: (Number(r.ct?.primary) || 2000) * 0.8, vn: bus?.vn });
    } else {
      const br = project.branches.find((b) => b.id === r.branchId);
      const category = br?.type === 'line' ? 'line' : 'transformer';
      const length = Number(br?.length) || 30;
      const z = br?.type === 'line' ? Math.hypot(length * (Number(br.xPerKm) || 0.39), length * (Number(br.rPerKm) || 0.12)) : 0;
      ensureProtectionSet(r, category, { z, length, rated: r.ct?.primary || 500 });
    }
  }
  return project;
}

export function validateProject(project) {
  const issues = [];
  const error = (msg, ref) => issues.push({ level: 'error', msg, ref });
  const warn = (msg, ref) => issues.push({ level: 'warning', msg, ref });
  const info = (msg, ref) => issues.push({ level: 'info', msg, ref });

  if (!project.buses.length) error('画布为空：至少需要一条母线。');
  if (project.buses.length && !project.buses.some((b) => b.type === 'slack')) {
    error('没有平衡节点（Slack）。请将一条母线的节点类型设为“平衡节点”。');
  }
  const busIds = new Set(project.buses.map((b) => b.id));
  const busLookup = new Map(project.buses.map((b) => [b.id, b]));
  const typeCount = project.buses.filter((b) => b.type === 'slack').length;
  if (typeCount > 1) info(`检测到 ${typeCount} 个平衡节点，将按电气岛分别作为参考节点。`);

  for (const b of project.buses) {
    if (!(b.vn > 0)) error(`母线“${b.name}”的额定电压无效。`, { kind: 'bus', id: b.id });
    if (!(b.scRating > 0)) error(`母线“${b.name}”的短路耐受电流必须大于 0。`, { kind: 'bus', id: b.id });
    if (b.type === 'PV' && !project.injections.some((x) => x.type === 'generator' && x.bus === b.id && x.status === 'in')) {
      warn(`母线“${b.name}”为 PV 节点但没有投入运行的发电机，计算时将按 PQ 节点处理。`, { kind: 'bus', id: b.id });
    }
  }

  for (const br of project.branches) {
    if (!busIds.has(br.from) || !busIds.has(br.to)) {
      error(`支路“${br.name}”连接到不存在的母线。`, { kind: 'branch', id: br.id });
    }
    if (br.from === br.to) error(`支路“${br.name}”的两端在同一母线上，已从计算中忽略。`, { kind: 'branch', id: br.id });
    if (br.type === 'line') {
      const a = busLookup.get(br.from);
      const b = busLookup.get(br.to);
      if (a && b && Math.abs(a.vn - b.vn) > 0.01) {
        const mismatch = Math.abs(a.vn - b.vn) / Math.max(a.vn, b.vn);
        const msg = `线路“${br.name}”连接了 ${a.vn} kV 与 ${b.vn} kV 母线；线路通常应位于同一电压等级，请确认是否应使用变压器。`;
        if (mismatch > 0.08) error(msg, { kind: 'branch', id: br.id });
        else warn(msg, { kind: 'branch', id: br.id });
      }
      if (br.paramMode === 'distributed') {
        if (!(br.length > 0)) error(`线路“${br.name}”长度必须大于 0。`, { kind: 'branch', id: br.id });
        if (!(br.rPerKm >= 0) || !(br.xPerKm > 0)) error(`线路“${br.name}”的 r/x 参数无效。`, { kind: 'branch', id: br.id });
      } else if (!(br.R >= 0) || !(br.X > 0)) {
        error(`线路“${br.name}”的集中参数 R/X 无效。`, { kind: 'branch', id: br.id });
      }
    }
    if (br.type === 'transformer') {
      if (!(br.sn > 0) || !(br.uk > 0)) error(`变压器“${br.name}”的容量或短路阻抗无效。`, { kind: 'branch', id: br.id });
      if (br.vn1 <= 0 || br.vn2 <= 0) error(`变压器“${br.name}”的额定电压无效。`, { kind: 'branch', id: br.id });
      if (!(br.tap >= -20 && br.tap <= 20)) warn(`变压器“${br.name}”分接位置超出 ±20% 常见范围。`, { kind: 'branch', id: br.id });
    }
    if (br.type === 'transformer3') {
      if (!br.third || !busIds.has(br.third)) error(`三绕组变压器“${br.name}”的低压侧母线不存在。`, { kind: 'branch', id: br.id });
      if (new Set([br.from, br.to, br.third]).size < 3) error(`三绕组变压器“${br.name}”必须连接三条不同母线。`, { kind: 'branch', id: br.id });
      if (!(br.sn > 0)) error(`三绕组变压器“${br.name}”的容量无效。`, { kind: 'branch', id: br.id });
      if (!(br.vnH > 0) || !(br.vnM > 0) || !(br.vnL > 0)) error(`三绕组变压器“${br.name}”的额定电压无效。`, { kind: 'branch', id: br.id });
      if (!(br.ukHM > 0) || !(br.ukHL > 0) || !(br.ukML > 0)) error(`三绕组变压器“${br.name}”的短路阻抗无效。`, { kind: 'branch', id: br.id });
      if (!(br.tapH >= -20 && br.tapH <= 20 && br.tapM >= -20 && br.tapM <= 20 && br.tapL >= -20 && br.tapL <= 20)) {
        warn(`三绕组变压器“${br.name}”分接位置超出 ±20% 常见范围。`, { kind: 'branch', id: br.id });
      }
      if ((Number(br.ukHM) || 0) + (Number(br.ukML) || 0) <= (Number(br.ukHL) || 0) + 0.01
        || (Number(br.ukHM) || 0) + (Number(br.ukHL) || 0) <= (Number(br.ukML) || 0) + 0.01
        || (Number(br.ukHL) || 0) + (Number(br.ukML) || 0) <= (Number(br.ukHM) || 0) + 0.01) {
        warn(`三绕组变压器“${br.name}”的 Uk 参数不能构成有效三角形，星形等值可能出现过小阻抗。`, { kind: 'branch', id: br.id });
      }
    }
    if (isSeriesType(br.type)) {
      if (!(Number(br.rOhm) >= 0)) warn(`串联设备“${br.name}”的电阻无效。`, { kind: 'branch', id: br.id });
      if (br.type === 'seriesReactor' && !(Number(br.xOhm) > 0)) error(`串联电抗器“${br.name}”的电抗必须大于 0。`, { kind: 'branch', id: br.id });
      if (br.type === 'seriesCap' && !(Number(br.xcOhm) > 0)) error(`串联电容器“${br.name}”的容抗必须大于 0。`, { kind: 'branch', id: br.id });
      if (br.type === 'fcl' && !(Number(br.xFaultOhm) > 0)) error(`故障电流限制器“${br.name}”的故障态电抗必须大于 0。`, { kind: 'branch', id: br.id });
      if (!(Number(br.voltageClass) > 0)) warn(`串联设备“${br.name}”的电压等级无效。`, { kind: 'branch', id: br.id });
    }
    if (isSwitchType(br.type) && br.from !== br.to) {
      const a = project.buses.find((b) => b.id === br.from);
      const b = project.buses.find((b) => b.id === br.to);
      if (a && b && Math.abs(a.vn - b.vn) > 0.01 && br.status === 'in' && br.closed) {
        warn(`零阻抗开关“${br.name}”连接了不同电压等级的母线。`, { kind: 'branch', id: br.id });
      }
    }
  }

  for (const inj of project.injections) {
    if (!busIds.has(inj.bus)) error(`设备“${inj.name}”未连接到有效母线。`, { kind: 'injection', id: inj.id });
    if (inj.type === 'generator' && !(inj.ratedMVA > 0)) warn(`发电机“${inj.name}”额定容量无效。`, { kind: 'injection', id: inj.id });
    if (inj.type === 'shunt' && !Number.isFinite(Number(inj.q))) error(`补偿装置“${inj.name}”容量无效。`, { kind: 'injection', id: inj.id });
  }

  // island / connectivity check with closed zero-impedance branches collapsed
  if (project.buses.length) {
    const parent = new Map(project.buses.map((b) => [b.id, b.id]));
    const find = (x) => {
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    };
    const union = (a, b) => parent.set(find(a), find(b));
    for (const br of project.branches) {
      if (br.status === 'in' && isSwitchType(br.type) && br.closed) union(br.from, br.to);
    }
    for (const br of project.branches) {
      if (br.status !== 'in' || !['line', 'transformer'].includes(br.type)) continue;
      if (!busIds.has(br.from) || !busIds.has(br.to)) continue;
      union(br.from, br.to);
    }
    const groups = new Map();
    for (const b of project.buses) {
      const root = find(b.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(b);
    }
    let islands = [...groups.values()].filter((g) => g.length > 0);
    if (islands.length > 1) {
      warn(`网络被识别为 ${islands.length} 个电气岛；每个电气岛都必须包含平衡节点。`);
    }
    for (const island of islands) {
      if (!island.some((b) => b.type === 'slack')) {
        error(`电气岛（${island.map((b) => b.name).slice(0, 3).join('、')}${island.length > 3 ? ' 等' : ''}）缺少平衡节点。`, { kind: 'bus', id: island[0].id });
      }
    }
  }

  if (project.branches.filter((b) => b.type === 'line' || b.type === 'transformer' || b.type === 'transformer3').length === 0) {
    warn('尚无线路或变压器，潮流计算的规模将只有母线节点。');
  }

  return issues;
}

export function loadProject(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('工程文件格式无效。');
  const project = {
    ...emptyProject(),
    ...raw,
    meta: { ...emptyProject().meta, ...(raw.meta || {}) },
    buses: Array.isArray(raw.buses) ? raw.buses : [],
    branches: Array.isArray(raw.branches) ? raw.branches : [],
    injections: Array.isArray(raw.injections) ? raw.injections : [],
    relays: Array.isArray(raw.relays) ? raw.relays : [],
    scenarios: Array.isArray(raw.scenarios) ? raw.scenarios : [],
    view: { ...emptyProject().view, ...(raw.view || {}) }
  };
  project.version = APP_VERSION;
  const legacyZero = raw.meta?.zeroSeqMigrated !== true;
  for (const b of project.buses) {
    if (!b.id) b.id = uid('bus');
    b.width = Number(b.width) || 300;
    b.vn = Number(b.vn) || 110;
    b.vm = Number(b.vm) || 1;
    b.va = Number(b.va) || 0;
    b.scRating = Number(b.scRating) || defaultScRating(b.vn);
  }
  for (const br of project.branches) {
    if (!br.id) br.id = uid('br');
    if (br.type === 'line') {
      if (!br.lineKind) br.lineKind = 'overhead';
      if (!br.insulation) br.insulation = 'XLPE';
      if (br.ampacity == null) br.ampacity = 600;
      if (br.paramMode === 'distributed') {
        if (br.r0PerKm == null) br.r0PerKm = Number(((Number(br.rPerKm) || 0.12) * 1.5).toFixed(6));
        if (br.x0PerKm == null) br.x0PerKm = Number(((Number(br.xPerKm) || 0.39) * 3).toFixed(6));
        if (br.b0PerKm == null) br.b0PerKm = Number(((Number(br.bPerKm) || 2.8) * 0.8).toFixed(6));
      }
      if (br.R0 == null) br.R0 = Number(((Number(br.R) || 3.6) * 1.5).toFixed(6));
      if (br.X0 == null) br.X0 = Number(((Number(br.X) || 11.7) * 3).toFixed(6));
      if (br.B0 == null) br.B0 = Number(((Number(br.B) || 84) * 0.8).toFixed(6));
    }
    if (br.type === 'transformer') {
      if (legacyZero || !br.zeroMode) {
        const vg = String(br.vectorGroup || '').toUpperCase();
        const rest = vg.slice(2);
        if (vg.startsWith('YN') && rest.startsWith('YN')) br.zeroMode = 'through';
        else if (vg.startsWith('YN')) br.zeroMode = 'ground_from';
        else if (vg.startsWith('D') && rest.startsWith('YN')) br.zeroMode = 'ground_to';
        else br.zeroMode = 'block';
      }
      if (br.zeroUk == null) br.zeroUk = Number((((Number(br.uk) || 10.5) * 0.8)).toFixed(2));
    }
    if (br.type === 'transformer3') {
      if (!br.thirdSwitch) br.thirdSwitch = 'closed';
    }
  }
  for (const inj of project.injections) {
    if (!inj.id) inj.id = uid('inj');
    if (!inj.status) inj.status = 'in';
    if (inj.type === 'generator') {
      if (!inj.xd) inj.xd = 0.25;
      if (inj.droop == null) inj.droop = 5;
      if (inj.governor == null) inj.governor = true;
      if (inj.grounded == null) inj.grounded = true;
      if (inj.xg0 == null) inj.xg0 = 0.05;
      if (inj.pMin == null) inj.pMin = 0;
      if (inj.pMax == null) inj.pMax = Number(inj.ratedMVA) || 150;
      if (inj.costA == null) inj.costA = 0;
      if (inj.costB == null) inj.costB = inj.kind === '风电' || inj.kind === '光伏' ? 0 : 300;
    }
    if (inj.type === 'load') {
      if (inj.motor == null) inj.motor = false;
      if (inj.motorX == null) inj.motorX = 0.2;
    }
  }
  project.meta.zeroSeqMigrated = true;
  ensureRelays(project);
  return project;
}

export function summarize(project) {
  return {
    buses: project.buses.length,
    lines: project.branches.filter((b) => b.type === 'line').length,
    transformers: project.branches.filter((b) => b.type === 'transformer' || b.type === 'transformer3').length,
    generators: project.injections.filter((x) => x.type === 'generator').length,
    loads: project.injections.filter((x) => x.type === 'load').length,
    shunts: project.injections.filter((x) => x.type === 'shunt').length,
    relays: project.relays.filter((r) => r.enabled).length
  };
}

export function nextTag(project, type) {
  const prefix = { bus: 'BUS', line: 'L', transformer: 'T', transformer3: 'T', breaker: 'QF', switch: 'QS', loadSwitch: 'QL', disconnector: 'QS', recloser: 'REC', sectionalizer: 'SEC', fuse: 'FU', seriesReactor: 'SR', seriesCap: 'SC', fcl: 'FCL', generator: 'G', load: 'LD', shunt: 'C' }[type] || 'EQ';
  let n = 1;
  const tags = new Set([
    ...project.buses.map((b) => b.tag),
    ...project.branches.map((b) => b.tag),
    ...project.injections.map((b) => b.tag)
  ]);
  while (tags.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function busDisplayName(project, id) {
  const b = project.buses.find((x) => x.id === id);
  return b ? b.name : '未连接';
}

export function makeIdMap(project) {
  return new Map(project.buses.map((b, i) => [b.id, i + 1]));
}

export { busPalette };
