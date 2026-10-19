import { newBus, newBranch, newInjection, ensureRelays, emptyProject } from '../model.js';

function projectShell(meta) {
  const p = emptyProject();
  p.meta = { ...p.meta, ...meta, date: new Date().toISOString().slice(0, 10) };
  return p;
}

function addBus(p, id, name, tag, vn, type, x, y, width = 300, vm = 1.0) {
  const b = newBus({ name, tag, vn, type, x, y, width, vm });
  b.id = id;
  p.buses.push(b);
  return b;
}

function addBranch(p, id, type, from, to, opts) {
  const br = newBranch(type, from, to, opts);
  br.id = id;
  p.branches.push(br);
  return br;
}

function addInjection(p, id, type, busId, opts) {
  const x = newInjection(type, busId, opts);
  x.id = id;
  p.injections.push(x);
  return x;
}

function finish(p, view = { x: 60, y: 50, k: 0.78 }) {
  ensureRelays(p);
  for (const relay of p.relays) relay.mode = 'auto';
  p.view = view;
  return p;
}

/**
 * 10-bus industrial park: 220 kV incoming supply, 110 kV ring and 10 kV
 * distribution feeders. Includes motor loads, PV generators and shunts.
 */
export function createIndustrialProject() {
  const p = projectShell({
    name: '临港装备制造园 220/110/10 kV 配电网',
    projectNo: 'LG-IND-2026-07',
    owner: '临港园区能源中心',
    baseMVA: 100,
    frequency: 50,
    compactLabels: true,
    note: '示例工程：220 kV 双回进线、110 kV 环网、10 kV 配电馈线，含工业电动机负荷、燃气机组与无功补偿。'
  });

  addBus(p, 'ind-220a', '临港 220 kV 枢纽', 'IND-220A', 220, 'slack', 80, 170, 330, 1.03);
  addBus(p, 'ind-220b', '装备园 220 kV 母线', 'IND-220B', 220, 'PV', 720, 170, 330, 1.02);
  addBus(p, 'ind-220c', '数据中心 220 kV 母线', 'IND-220C', 220, 'PQ', 1310, 170, 280);
  addBus(p, 'ind-110a', '轧钢 110 kV 母线', 'IND-110A', 110, 'PQ', 80, 470, 300);
  addBus(p, 'ind-110b', '汽车 110 kV 母线', 'IND-110B', 110, 'PQ', 540, 470, 300);
  addBus(p, 'ind-110c', '电子 110 kV 母线', 'IND-110C', 110, 'PQ', 1000, 470, 300);
  addBus(p, 'ind-110d', '化工 110 kV 母线', 'IND-110D', 110, 'PQ', 1360, 470, 270);
  addBus(p, 'ind-10a', '1# 配电母线', 'IND-10A', 10, 'PQ', 280, 770, 280);
  addBus(p, 'ind-10b', '2# 配电母线', 'IND-10B', 10, 'PQ', 760, 770, 280);
  addBus(p, 'ind-10c', '3# 配电母线', 'IND-10C', 10, 'PQ', 1240, 770, 280);

  addBranch(p, 'ind-l1', 'line', 'ind-220a', 'ind-220b', {
    name: '临港—装备园 220 kV 线路', tag: 'IL-221', length: 38, paramMode: 'distributed',
    rPerKm: 0.08, xPerKm: 0.41, bPerKm: 2.8, voltageClass: 220, ratingMVA: 600, conductor: '2×LGJ-400/35'
  });
  addBranch(p, 'ind-l2', 'line', 'ind-220b', 'ind-220c', {
    name: '装备园—数据中心 220 kV 线路', tag: 'IL-222', length: 32, paramMode: 'distributed',
    rPerKm: 0.08, xPerKm: 0.41, bPerKm: 2.8, voltageClass: 220, ratingMVA: 500, conductor: '2×LGJ-400/35'
  });
  addBranch(p, 'ind-t1', 'transformer', 'ind-220a', 'ind-110a', {
    name: '临港 1 号主变', tag: 'IT-1', sn: 240, vn1: 230, vn2: 115, uk: 10.5, pk: 520, p0: 95, i0: 0.22,
    tap: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4, ratingMVA: 240
  });
  addBranch(p, 'ind-t2', 'transformer', 'ind-220b', 'ind-110b', {
    name: '装备园 1 号主变', tag: 'IT-2', sn: 240, vn1: 230, vn2: 115, uk: 10.5, pk: 520, p0: 95, i0: 0.22,
    tap: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4, ratingMVA: 240
  });
  addBranch(p, 'ind-t3', 'transformer', 'ind-220c', 'ind-110c', {
    name: '数据中心主变', tag: 'IT-3', sn: 180, vn1: 230, vn2: 115, uk: 10.5, pk: 420, p0: 78, i0: 0.2,
    tap: 0, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4, ratingMVA: 180
  });
  addBranch(p, 'ind-l3', 'line', 'ind-110a', 'ind-110b', {
    name: '轧钢—汽车 110 kV 线路', tag: 'IL-111', length: 18, paramMode: 'lumped', R: 1.4, X: 5.2, B: 42,
    voltageClass: 110, ratingMVA: 150, conductor: 'LGJ-240/30'
  });
  addBranch(p, 'ind-l4', 'line', 'ind-110b', 'ind-110c', {
    name: '汽车—电子 110 kV 线路', tag: 'IL-112', length: 20, paramMode: 'lumped', R: 1.7, X: 5.8, B: 46,
    voltageClass: 110, ratingMVA: 150, conductor: 'LGJ-240/30'
  });
  addBranch(p, 'ind-l5', 'line', 'ind-110c', 'ind-110d', {
    name: '电子—化工 110 kV 线路', tag: 'IL-113', length: 16, paramMode: 'lumped', R: 1.3, X: 4.8, B: 38,
    voltageClass: 110, ratingMVA: 130, conductor: 'LGJ-185/30'
  });
  addBranch(p, 'ind-t4', 'transformer', 'ind-110a', 'ind-10a', {
    name: '轧钢 10 kV 配变', tag: 'IT-4', sn: 63, vn1: 115, vn2: 10.5, uk: 8, pk: 180, p0: 28, i0: 0.3,
    tap: 0, vectorGroup: 'Dyn11', zeroMode: 'ground_to', zeroUk: 6.4, ratingMVA: 63
  });
  addBranch(p, 'ind-t5', 'transformer', 'ind-110b', 'ind-10b', {
    name: '汽车 10 kV 配变', tag: 'IT-5', sn: 50, vn1: 115, vn2: 10.5, uk: 8, pk: 150, p0: 24, i0: 0.3,
    tap: 0, vectorGroup: 'Dyn11', zeroMode: 'ground_to', zeroUk: 6.4, ratingMVA: 50
  });
  addBranch(p, 'ind-t6', 'transformer', 'ind-110d', 'ind-10c', {
    name: '化工 10 kV 配变', tag: 'IT-6', sn: 50, vn1: 115, vn2: 10.5, uk: 8, pk: 150, p0: 24, i0: 0.3,
    tap: 0, vectorGroup: 'Dyn11', zeroMode: 'ground_to', zeroUk: 6.4, ratingMVA: 50
  });
  addBranch(p, 'ind-l6', 'line', 'ind-10a', 'ind-10b', {
    name: '1#—2# 10 kV 电缆联络', tag: 'IL-101', lineKind: 'cable', insulation: 'XLPE', ampacity: 400,
    length: 4, paramMode: 'lumped', R: 0.08, X: 0.12, B: 0, voltageClass: 10, ratingMVA: 35, conductor: 'YJV-3×240'
  });
  addBranch(p, 'ind-l7', 'line', 'ind-10b', 'ind-10c', {
    name: '2#—3# 10 kV 电缆联络', tag: 'IL-102', lineKind: 'cable', insulation: 'XLPE', ampacity: 400,
    length: 5, paramMode: 'lumped', R: 0.1, X: 0.15, B: 0, voltageClass: 10, ratingMVA: 35, conductor: 'YJV-3×240'
  });

  addInjection(p, 'ind-g1', 'generator', 'ind-220a', {
    name: '临港燃机 1 号机', tag: 'IG-1', pos: 0.2, direction: 'up', p: 0, qMin: -80, qMax: 180,
    ratedMVA: 300, kind: '燃气', inertia: 5.5
  });
  addInjection(p, 'ind-g2', 'generator', 'ind-220b', {
    name: '园区燃气机组', tag: 'IG-2', pos: 0.5, direction: 'up', p: 140, qMin: -60, qMax: 100,
    ratedMVA: 180, kind: '燃气', inertia: 4.8
  });
  addInjection(p, 'ind-g3', 'generator', 'ind-220c', {
    name: '数据中心自备机组', tag: 'IG-3', pos: 0.78, direction: 'up', p: 70, qMin: -30, qMax: 60,
    ratedMVA: 100, kind: '燃气', inertia: 3.2
  });
  addInjection(p, 'ind-ld1', 'load', 'ind-110a', {
    name: '轧钢电动机负荷', tag: 'ILD-1', pos: 0.84, direction: 'down', p: 60, q: 20, loadType: '工业', motor: true, motorX: 0.18
  });
  addInjection(p, 'ind-ld2', 'load', 'ind-110b', {
    name: '汽车制造负荷', tag: 'ILD-2', pos: 0.84, direction: 'down', p: 55, q: 18, loadType: '工业', motor: true, motorX: 0.2
  });
  addInjection(p, 'ind-ld3', 'load', 'ind-110c', {
    name: '电子园区负荷', tag: 'ILD-3', pos: 0.84, direction: 'down', p: 50, q: 16, loadType: '工业'
  });
  addInjection(p, 'ind-ld4', 'load', 'ind-110d', {
    name: '化工园负荷', tag: 'ILD-4', pos: 0.84, direction: 'down', p: 40, q: 14, loadType: '工业', motor: true, motorX: 0.2
  });
  addInjection(p, 'ind-ld5', 'load', 'ind-10a', {
    name: '1# 配电负荷', tag: 'ILD-5', pos: 0.5, direction: 'down', p: 30, q: 10, loadType: '工业', motor: true, motorX: 0.22
  });
  addInjection(p, 'ind-ld6', 'load', 'ind-10b', {
    name: '2# 配电负荷', tag: 'ILD-6', pos: 0.5, direction: 'down', p: 25, q: 8, loadType: '工业'
  });
  addInjection(p, 'ind-ld7', 'load', 'ind-10c', {
    name: '3# 配电负荷', tag: 'ILD-7', pos: 0.5, direction: 'down', p: 20, q: 7, loadType: '工业'
  });
  addInjection(p, 'ind-sh1', 'shunt', 'ind-110b', {
    name: '汽车园电容器', tag: 'IC-1', pos: 0.68, direction: 'up', q: 20, kind: 'capacitor', ratedKV: 110
  });
  addInjection(p, 'ind-sh2', 'shunt', 'ind-110d', {
    name: '化工园电容器', tag: 'IC-2', pos: 0.68, direction: 'up', q: 15, kind: 'capacitor', ratedKV: 110
  });

  return finish(p, { x: 20, y: 20, k: 0.8 });
}

/**
 * 25-bus 500/220/110 kV meshed transmission example with five 500 kV hubs,
 * a 15-bus 220 kV grid, a 5-bus 110 kV distribution ring and multiple generators.
 */
export function createLargeProject() {
  const p = projectShell({
    name: '华东 500/220/110 kV 25 节点环网',
    projectNo: 'HD-TRAN-2026-01',
    owner: '华东电力规划研究中心',
    baseMVA: 100,
    frequency: 50,
    compactLabels: true,
    note: '大型示例：5 座 500 kV 枢纽、15 座 220 kV 变电站、5 座 110 kV 负荷站，40 条线路/变压器，含 6 台机组与多组无功补偿。适合测试大网潮流、矩阵规模、N-1 与稳定分析。'
  });

  const xs = [70, 380, 690, 1000, 1310];
  const names500 = ['海州 500 kV 枢纽', '临江 500 kV 枢纽', '平原 500 kV 枢纽', '山口 500 kV 枢纽', '东湾 500 kV 枢纽'];
  const names220 = [
    ['海北 220 kV', '海西 220 kV', '海东 220 kV', '海南 220 kV', '海港 220 kV'],
    ['江城 220 kV', '江阴 220 kV', '江都 220 kV', '江海 220 kV', '江湾 220 kV'],
    ['山北 220 kV', '山南 220 kV', '山前 220 kV', '山谷 220 kV', '山门 220 kV']
  ];
  const names110 = ['城西 110 kV', '城东 110 kV', '城南 110 kV', '城北 110 kV', '滨江 110 kV'];

  for (let c = 0; c < 5; c++) {
    const type = c === 0 ? 'slack' : c === 2 || c === 4 ? 'PV' : 'PQ';
    addBus(p, `lg-${String(c + 1).padStart(2, '0')}`, names500[c], `B${String(c + 1).padStart(2, '0')}`, 500, type, xs[c], 130, 250, type === 'PQ' ? 1.0 : 1.03);
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const n = 6 + r * 5 + c;
      const type = (n === 8 || n === 14 || n === 18) ? 'PV' : 'PQ';
      addBus(p, `lg-${String(n).padStart(2, '0')}`, names220[r][c], `B${String(n).padStart(2, '0')}`, 220, type, xs[c], 330 + r * 190, 250, type === 'PV' ? 1.02 : 1.0);
    }
  }
  for (let c = 0; c < 5; c++) {
    const n = 21 + c;
    addBus(p, `lg-${String(n).padStart(2, '0')}`, names110[c], `B${String(n).padStart(2, '0')}`, 110, 'PQ', xs[c], 890, 250);
  }

  const tag = (n) => `B${String(n).padStart(2, '0')}`;
  const line = (id, from, to, opts) => addBranch(p, id, 'line', `lg-${String(from).padStart(2, '0')}`, `lg-${String(to).padStart(2, '0')}`, opts);
  const transformer = (id, from, to, opts) => addBranch(p, id, 'transformer', `lg-${String(from).padStart(2, '0')}`, `lg-${String(to).padStart(2, '0')}`, opts);
  const gen = (id, n, opts) => addInjection(p, id, 'generator', `lg-${String(n).padStart(2, '0')}`, { labelAlign: 'center', direction: 'up', pos: 0.5, ...opts });
  const load = (id, n, opts) => addInjection(p, id, 'load', `lg-${String(n).padStart(2, '0')}`, { labelAlign: 'center', direction: 'down', pos: 0.5, ...opts });
  const shunt = (id, n, opts) => addInjection(p, id, 'shunt', `lg-${String(n).padStart(2, '0')}`, { labelAlign: 'center', direction: 'up', pos: 0.5, ...opts });

  for (let i = 0; i < 5; i++) {
    line(`lg-l500-${i + 1}`, i + 1, ((i + 1) % 5) + 1, {
      name: `500 kV 环网 ${i + 1}—${((i + 1) % 5) + 1}`, tag: `L500-${i + 1}`, length: 85 + i * 9,
      paramMode: 'distributed', rPerKm: 0.045, xPerKm: 0.32, bPerKm: 3.1, voltageClass: 500,
      ratingMVA: 1200, conductor: '4×LGJ-500/45'
    });
  }
  transformer('lg-t500-1', 1, 6, { name: '海州—海北 500/220 主变', tag: 'T500-1', sn: 750, vn1: 525, vn2: 230, uk: 14, pk: 460, p0: 180, i0: 0.28, tap: 0, ratingMVA: 750, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 11.2 });
  transformer('lg-t500-2', 2, 7, { name: '临江—江阴 500/220 主变', tag: 'T500-2', sn: 750, vn1: 525, vn2: 230, uk: 14, pk: 460, p0: 180, i0: 0.28, tap: 0, ratingMVA: 750, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 11.2 });
  transformer('lg-t500-3', 4, 9, { name: '山口—海南 500/220 主变', tag: 'T500-3', sn: 750, vn1: 525, vn2: 230, uk: 14, pk: 460, p0: 180, i0: 0.28, tap: 0, ratingMVA: 750, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 11.2 });
  transformer('lg-t500-4', 5, 10, { name: '东湾—海港 500/220 主变', tag: 'T500-4', sn: 750, vn1: 525, vn2: 230, uk: 14, pk: 460, p0: 180, i0: 0.28, tap: 0, ratingMVA: 750, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 11.2 });

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const from = 6 + r * 5 + c;
      line(`lg-l220-h${r + 1}-${c + 1}`, from, from + 1, {
        name: `${tag(from)}—${tag(from + 1)} 220 kV 线路`, tag: `L220-${r + 1}${c + 1}`,
        length: 55 + c * 6, paramMode: 'distributed', rPerKm: 0.075, xPerKm: 0.4, bPerKm: 2.8,
        voltageClass: 220, ratingMVA: 500, conductor: '2×LGJ-400/35'
      });
    }
  }
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const from = 6 + r * 5 + c;
      line(`lg-l220-v${r + 1}-${c + 1}`, from, from + 5, {
        name: `${tag(from)}—${tag(from + 5)} 220 kV 线路`, tag: `L220-V${r + 1}${c + 1}`,
        length: 48 + c * 4, paramMode: 'distributed', rPerKm: 0.075, xPerKm: 0.4, bPerKm: 2.8,
        voltageClass: 220, ratingMVA: 500, conductor: '2×LGJ-400/35'
      });
    }
  }
  transformer('lg-t110-1', 16, 21, { name: '山北—城西 220/110 主变', tag: 'T110-1', sn: 240, vn1: 230, vn2: 115, uk: 10.5, pk: 520, p0: 95, i0: 0.22, tap: 0, ratingMVA: 240, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4 });
  transformer('lg-t110-2', 17, 22, { name: '山南—城东 220/110 主变', tag: 'T110-2', sn: 240, vn1: 230, vn2: 115, uk: 10.5, pk: 520, p0: 95, i0: 0.22, tap: 0, ratingMVA: 240, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4 });
  transformer('lg-t110-3', 19, 24, { name: '山谷—城北 220/110 主变', tag: 'T110-3', sn: 180, vn1: 230, vn2: 115, uk: 10.5, pk: 420, p0: 78, i0: 0.22, tap: 0, ratingMVA: 180, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4 });
  transformer('lg-t110-4', 20, 25, { name: '山门—滨江 220/110 主变', tag: 'T110-4', sn: 180, vn1: 230, vn2: 115, uk: 10.5, pk: 420, p0: 78, i0: 0.22, tap: 0, ratingMVA: 180, vectorGroup: 'YNd11', zeroMode: 'ground_from', zeroUk: 8.4 });
  for (let i = 0; i < 5; i++) {
    const from = 21 + i;
    const to = 21 + ((i + 1) % 5);
    line(`lg-l110-${i + 1}`, from, to, {
      name: `${tag(from)}—${tag(to)} 110 kV 线路`, tag: `L110-${i + 1}`,
      length: 15 + i * 2, paramMode: 'lumped', R: 1.2 + i * 0.1, X: 4.6 + i * 0.2, B: 32,
      voltageClass: 110, ratingMVA: 120, conductor: 'LGJ-240/30'
    });
  }

  gen('lg-g1', 1, { name: '海州电厂 1 号机', tag: 'G1', p: 0, qMin: -300, qMax: 500, ratedMVA: 900, kind: '火电', inertia: 8.5 });
  gen('lg-g2', 3, { name: '平原电厂 2 号机', tag: 'G2', p: 250, qMin: -100, qMax: 180, ratedMVA: 300, kind: '火电', inertia: 6.5 });
  gen('lg-g3', 5, { name: '东湾燃机 3 号机', tag: 'G3', p: 200, qMin: -80, qMax: 150, ratedMVA: 300, kind: '燃气', inertia: 4.8 });
  gen('lg-g4', 8, { name: '江阴燃机 4 号机', tag: 'G4', p: 150, qMin: -60, qMax: 120, ratedMVA: 220, kind: '燃气', inertia: 4.2 });
  gen('lg-g5', 14, { name: '山谷燃机 5 号机', tag: 'G5', p: 150, qMin: -60, qMax: 120, ratedMVA: 220, kind: '燃气', inertia: 4.0 });
  gen('lg-g6', 18, { name: '山门燃机 6 号机', tag: 'G6', p: 100, qMin: -50, qMax: 90, ratedMVA: 150, kind: '燃气', inertia: 3.5 });

  const loads = [
    [6, 80, 24], [7, 70, 21], [9, 90, 27], [10, 60, 18],
    [11, 70, 21], [12, 60, 18], [13, 80, 24], [15, 65, 20],
    [16, 60, 18], [17, 55, 17], [19, 50, 15], [20, 45, 14],
    [21, 35, 10], [22, 30, 9], [23, 25, 8], [24, 30, 9], [25, 20, 6]
  ];
  for (const [n, pw, qv] of loads) {
    load(`lg-ld${n}`, n, { name: `${tag(n)} 综合负荷`, tag: `LD${n}`, p: pw, q: qv, loadType: '工业', motor: n >= 21 });
  }
  shunt('lg-sh1', 9, { name: '海港电容器组', tag: 'C1', q: 60, kind: 'capacitor', ratedKV: 220 });
  shunt('lg-sh2', 13, { name: '山谷电容器组', tag: 'C2', q: 40, kind: 'capacitor', ratedKV: 220 });
  shunt('lg-sh3', 23, { name: '城南电容器组', tag: 'C3', q: 15, kind: 'capacitor', ratedKV: 110 });
  shunt('lg-sh4', 4, { name: '山口并联电抗器', tag: 'R1', q: -50, kind: 'reactor', ratedKV: 500 });
  shunt('lg-sh5', 20, { name: '山门电容器组', tag: 'C4', q: 30, kind: 'capacitor', ratedKV: 220 });

  return finish(p, { x: 20, y: 20, k: 0.7 });
}
