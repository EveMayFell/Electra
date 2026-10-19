import { protectionById, protectionsFor } from '../data/protectionCatalog.js';

const num = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));

function elementOf(project, relay) {
  if (relay.targetType === 'bus') {
    return { kind: 'bus', element: project.buses.find((b) => b.id === relay.busId) || null };
  }
  return { kind: 'branch', element: project.branches.find((b) => b.id === relay.branchId) || null };
}

export function relayContext(project, relay, result = null, options = {}) {
  if (relay.targetType === 'bus') {
    const bus = project.buses.find((b) => b.id === relay.busId);
    const br = result?.busResults?.find((b) => b.busId === relay.busId);
    return {
      kind: 'bus', element: bus, bus,
      voltage: Number(br?.Vm) || (bus?.type === 'slack' ? 1.0 : 1.0),
      loadCurrent: Number(relay.ct?.primary || 2000) * 0.35,
      ratedCurrent: Number(relay.ct?.primary || 2000) * 0.8,
      faultCurrent: Number(options.faultCurrentA) || (Number(bus?.scRating) || 31.5) * 1000 * 0.5,
      p: Number(br?.pLoad) || 0,
      q: Number(br?.qLoad) || 0,
      lineZ: 0,
      length: 0
    };
  }
  const branch = project.branches.find((b) => b.id === relay.branchId);
  const from = project.buses.find((b) => b.id === branch?.from);
  const to = project.buses.find((b) => b.id === branch?.to);
  const br = result?.branchResults?.find((b) => b.id === branch?.id);
  const vn = Number(branch?.voltageClass) || from?.vn || 110;
  const mva = Number(branch?.ratingMVA) || Number(branch?.sn) || 100;
  const ratedCurrent = mva * 1e6 / (Math.sqrt(3) * vn * 1e3);
  const loadCurrent = Math.max(0, Math.max(Number(br?.iFrom) || 0, Number(br?.iTo) || 0) * 1000);
  const lineZ = branch?.type === 'line'
    ? Math.hypot((Number(branch.rPerKm) || 0) * (Number(branch.length) || 0), (Number(branch.xPerKm) || 0) * (Number(branch.length) || 0))
    : 0;
  return {
    kind: 'branch', element: branch, branch, from, to,
    voltage: Number(result?.busResults?.find((b) => b.busId === branch?.from)?.Vm) || 1.0,
    loadCurrent, ratedCurrent, faultCurrent: Number(options.faultCurrentA) || Math.max(1000, Number(relay.overcurrent?.pickup) * 4 || 4000),
    p: 0, q: 0, lineZ, length: Number(branch?.length) || 0
  };
}

function coreVerdict(project, relay, entry, ctx) {
  if (entry.id === 'line_distance') {
    if (!relay.functions?.distance) return { status: 'off', setting: '距离保护退出', message: '相间距离保护未投入。' };
    const d = relay.distance || {};
    if (!(d.z1 > 0 && d.z1 < d.z2 && d.z2 < d.z3)) return { status: 'error', setting: `Z1 ${num(d.z1)} Ω`, message: '距离定值不满足 0 < Z1 < Z2 < Z3。' };
    if (ctx.lineZ > 0 && d.z1 > ctx.lineZ) return { status: 'warn', setting: `Z1 ${num(d.z1)} Ω`, message: 'I 段阻抗大于线路全长，存在超越风险。' };
    return { status: 'ok', setting: `Z1 ${num(d.z1)} Ω / 线路 ${num(ctx.lineZ)} Ω`, message: '三段式距离定值满足基本范围。' };
  }
  if (entry.id === 'line_overcurrent' || entry.id === 'xfmr_overcurrent') {
    if (!relay.functions?.overcurrent || !relay.overcurrent) return { status: 'off', setting: '过流后备退出', message: '过流后备保护未投入。' };
    const oc = relay.overcurrent;
    if (!(oc.pickup > 0)) return { status: 'error', setting: 'Iop 无效', message: '过流启动值无效。' };
    const k = ctx.faultCurrent / oc.pickup;
    if (!Number.isFinite(k)) return { status: 'ok', setting: `Iop ${num(oc.pickup, 0)} A`, message: '过流定值已配置。' };
    if (k < 1.3) return { status: 'warn', setting: `Iop ${num(oc.pickup, 0)} A`, message: `Ksen ${num(k)} < 1.30，灵敏度不足。` };
    return { status: 'ok', setting: `Iop ${num(oc.pickup, 0)} A`, message: `Ksen ${num(k)}，满足灵敏性。` };
  }
  if (entry.id === 'line_reclose') {
    const enabled = relay.reclose?.enabled !== false && relay.reclose?.enabled !== 'false' && relay.reclose?.enabled !== 0;
    return { status: enabled ? 'ok' : 'off', setting: `${relay.reclose?.attempts ?? 0} 次 / ${num(relay.reclose?.deadTime, 2)} s`, message: enabled ? '重合闸定值已配置。' : '重合闸退出。' };
  }
  if (entry.id === 'xfmr_differential') {
    if (!relay.functions?.differential || !relay.differential) return { status: 'off', setting: '差动退出', message: '变压器差动保护未投入。' };
    const d = relay.differential;
    if (!(d.pickup > 0) || !(d.slope1 < d.slope2)) return { status: 'error', setting: `Isd ${num(d.pickup)} Ie`, message: '差动启动值或斜率配合无效。' };
    return { status: 'ok', setting: `Isd ${num(d.pickup)} Ie / 斜率 ${num(d.slope1)}-${num(d.slope2)}`, message: '差动定值满足比率制动基本关系。' };
  }
  return null;
}

/**
 * Evaluate every catalog function configured on a relay. Numeric functions use
 * the current power-flow/SC context; non-electric functions return a
 * configuration-level verdict that can be handed to a commissioning checklist.
 */
export function evaluateRelayProtections(project, relay, result = null, options = {}) {
  const ctx = relayContext(project, relay, result, options);
  if (!ctx.element) return [];
  const category = relay.targetType === 'bus' ? 'bus' : (ctx.element.type === 'line' ? 'line' : 'transformer');
  const rows = [];
  for (const entry of protectionsFor(category)) {
    const inst = relay.protections?.[entry.id];
    const enabled = inst?.enabled !== false;
    const core = coreVerdict(project, relay, entry, ctx);
    if (core) {
      rows.push({ ...entry, enabled: enabled && core.status !== 'off', status: core.status, setting: core.setting, message: core.message, quantity: entry.quantity });
      continue;
    }
    if (!inst) {
      rows.push({ ...entry, enabled: false, status: 'off', setting: '未配置', message: '该保护功能尚未配置。' });
      continue;
    }
    const st = inst.settings || {};
    if (!enabled) {
      rows.push({ ...entry, enabled: false, status: 'off', setting: '退出', message: '该保护功能已退出。' });
      continue;
    }
    const quantity = entry.quantity;
    if (quantity === 'current') {
      const pickup = Number(st.pickup ?? st.i0 ?? st.i2 ?? st.threshold);
      if (!(pickup > 0)) {
        rows.push({ ...entry, enabled, status: 'error', setting: '定值无效', message: '启动电流必须大于 0。' });
        continue;
      }
      const test = Math.max(ctx.faultCurrent, ctx.loadCurrent);
      const k = test / pickup;
      const voltageName = /电压/.test(entry.name);
      const setting = `Iop ${num(pickup, 0)} A`;
      if (voltageName) {
        rows.push({ ...entry, enabled, status: 'ok', setting, message: '定值已配置。' });
      } else if (k < 1.05) {
        rows.push({ ...entry, enabled, status: 'warn', setting, message: `校验电流 ${num(test, 0)} A 低于启动值（K ${num(k)}）。` });
      } else if (k < 1.3 && /过流|零序|负序/.test(entry.name)) {
        rows.push({ ...entry, enabled, status: 'warn', setting, message: `Ksen ${num(k)} < 1.30，需复核灵敏度。` });
      } else {
        rows.push({ ...entry, enabled, status: 'ok', setting, message: `K ${num(k)}，定值可启动。` });
      }
      continue;
    }
    if (quantity === 'voltage') {
      const pickup = Number(st.pickup ?? st.vHz ?? st.vMin ?? st.threshold ?? st.zReach);
      if (!(pickup > 0)) {
        rows.push({ ...entry, enabled, status: 'error', setting: '定值无效', message: '电压/阻抗定值无效。' });
        continue;
      }
      const isUnder = /低电压|欠压/.test(entry.name);
      const isOver = /过电压|过励磁/.test(entry.name);
      const setting = `${num(pickup, 3)} pu`;
      if (isUnder) {
        const op = ctx.voltage < pickup;
        rows.push({ ...entry, enabled, status: op ? 'warn' : 'ok', setting, message: op ? `当前 ${num(ctx.voltage, 3)} pu 低于定值，保护应启动。` : `当前 ${num(ctx.voltage, 3)} pu 未低于定值。` });
      } else if (isOver) {
        const op = ctx.voltage > pickup;
        rows.push({ ...entry, enabled, status: op ? 'warn' : 'ok', setting, message: op ? `当前 ${num(ctx.voltage, 3)} pu 高于定值，保护应启动。` : `当前 ${num(ctx.voltage, 3)} pu 未超过定值。` });
      } else {
        rows.push({ ...entry, enabled, status: 'ok', setting, message: '电压相关定值已配置。' });
      }
      continue;
    }
    if (quantity === 'frequency') {
      const pickup = Number(st.pickup ?? st.stage1);
      if (!(pickup > 0)) {
        rows.push({ ...entry, enabled, status: 'error', setting: '频率定值无效', message: '频率定值无效。' });
        continue;
      }
      const setting = `${num(pickup, 2)} Hz`;
      rows.push({ ...entry, enabled, status: 'ok', setting, message: '频率定值已配置，实际动作需频率仿真结果。' });
      continue;
    }
    if (quantity === 'impedance') {
      const z = Number(st.zReach ?? st.z1);
      if (!(z > 0)) {
        rows.push({ ...entry, enabled, status: 'error', setting: '阻抗定值无效', message: '阻抗定值必须大于 0。' });
        continue;
      }
      const setting = `Z ${num(z, 3)} Ω`;
      rows.push({ ...entry, enabled, status: ctx.lineZ && z > ctx.lineZ * 2.5 ? 'warn' : 'ok', setting, message: ctx.lineZ && z > ctx.lineZ * 2.5 ? '阻抗定值超过线路阻抗 2.5 倍，需校核配合。' : '阻抗定值已配置。' });
      continue;
    }
    if (quantity === 'differential') {
      const pickup = Number(st.pickup);
      if (!(pickup > 0)) {
        rows.push({ ...entry, enabled, status: 'error', setting: '差动定值无效', message: '差动启动值无效。' });
        continue;
      }
      rows.push({ ...entry, enabled, status: 'ok', setting: `Isd ${num(pickup, 2)} Ie`, message: '差动定值已配置，需结合 CT 变比与接线组别校验。' });
      continue;
    }
    if (quantity === 'temperature') {
      const alarm = Number(st.alarm);
      const trip = Number(st.trip);
      if (alarm && trip && alarm >= trip) {
        rows.push({ ...entry, enabled, status: 'warn', setting: `${num(alarm, 0)}/${num(trip, 0)} °C`, message: '告警温度应低于跳闸温度。' });
      } else {
        rows.push({ ...entry, enabled, status: 'ok', setting: `${num(alarm, 0)}/${num(trip, 0)} °C`, message: '非电量温度定值已配置，需现场校验。' });
      }
      continue;
    }
    if (quantity === 'gas' || quantity === 'pressure') {
      rows.push({ ...entry, enabled, status: 'ok', setting: quantity === 'gas' ? `${num(st.light, 0)} mL / ${num(st.heavy, 1)} m/s` : `${num(st.pressure, 0)} kPa`, message: '非电量定值已配置，需结合厂家说明书校验。' });
      continue;
    }
    rows.push({ ...entry, enabled, status: 'ok', setting: '配置完成', message: '状态/辅助保护已配置。' });
  }
  return rows;
}

export function evaluationSummary(rows) {
  return {
    total: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    ok: rows.filter((r) => r.enabled && r.status === 'ok').length,
    warn: rows.filter((r) => r.enabled && r.status === 'warn').length,
    error: rows.filter((r) => r.enabled && r.status === 'error').length,
    off: rows.filter((r) => !r.enabled || r.status === 'off').length
  };
}

export function protectionMeta(id) {
  return protectionById(id);
}
