import { clone, loadProject, newBus, newBranch, newInjection, newBusRelay, uid, SWITCH_TYPES, SERIES_TYPES } from '../model.js';

const num = (v) => (v === '' || v == null ? '' : Number(v));
const bool = (v) => (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || v === '是');
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const BUS_COLS = ['id', 'tag', 'name', 'vn', 'type', 'vm', 'va', 'scRating', 'x', 'y', 'width', 'note'];
const BRANCH_COLS = [
  'id', 'type', 'tag', 'name', 'from', 'to', 'third', 'status', 'fromSwitch', 'toSwitch', 'thirdSwitch',
  'ratingMVA', 'paramMode', 'length', 'rPerKm', 'xPerKm', 'bPerKm', 'R', 'X', 'B',
  'r0PerKm', 'x0PerKm', 'b0PerKm', 'R0', 'X0', 'B0', 'voltageClass', 'conductor',
  'sn', 'vn1', 'vn2', 'uk', 'pk', 'p0', 'i0', 'tap', 'shift', 'vectorGroup', 'cooling', 'zeroMode', 'zeroUk',
  'vnH', 'vnM', 'vnL', 'ukHM', 'ukHL', 'ukML', 'tapH', 'tapM', 'tapL', 'vectorHM', 'vectorHL',
  'closed', 'ratedCurrent', 'breakingCurrent', 'loadBreakCurrent', 'autoReclose', 'recloseTime', 'recloseAttempts', 'count',
  'rOhm', 'xOhm', 'zeroXOhm', 'xcOhm', 'xNormalOhm', 'xFaultOhm', 'note'
];
const RELAY_COLS = [
  'id', 'targetType', 'branchId', 'busId', 'name', 'enabled', 'mode', 'ctPrimary', 'ctSecondary', 'vtPrimary', 'vtSecondary',
  'z1', 'z2', 'z3', 't1', 't2', 't3', 'ocPickup', 'ocCurve', 'ocTms', 'ocInstPickup', 'ocInstTime',
  'diffPickup', 'diffSlope1', 'diffSlope2', 'diffT', 'recloseEnabled', 'recloseAttempts', 'recloseDeadTime', 'recloseReclaim', 'protectionsJson'
];
const INJ_COLS = [
  'id', 'type', 'tag', 'name', 'bus', 'pos', 'direction', 'status', 'p', 'q', 'qMin', 'qMax',
  'ratedMVA', 'kind', 'inertia', 'xd', 'pMin', 'pMax', 'costA', 'costB', 'grounded', 'xg0',
  'switchClosed', 'loadType', 'motor', 'motorX', 'note'
];
const NUMERIC_BUS = new Set(['vn', 'vm', 'va', 'scRating', 'x', 'y', 'width']);
const NUMERIC_BR = new Set([
  'ratingMVA', 'length', 'rPerKm', 'xPerKm', 'bPerKm', 'R', 'X', 'B', 'r0PerKm', 'x0PerKm', 'b0PerKm',
  'R0', 'X0', 'B0', 'voltageClass', 'ampacity', 'sn', 'vn1', 'vn2', 'uk', 'pk', 'p0', 'i0', 'tap', 'shift', 'zeroUk',
  'vnH', 'vnM', 'vnL', 'ukHM', 'ukHL', 'ukML', 'tapH', 'tapM', 'tapL', 'closed', 'ratedCurrent', 'breakingCurrent',
  'loadBreakCurrent', 'recloseTime', 'recloseAttempts', 'count', 'rOhm', 'xOhm', 'zeroXOhm', 'xcOhm', 'xNormalOhm', 'xFaultOhm'
]);
const NUMERIC_INJ = new Set(['pos', 'p', 'q', 'qMin', 'qMax', 'ratedMVA', 'inertia', 'xd', 'pMin', 'pMax', 'costA', 'costB', 'xg0', 'motorX']);

function cell(value, style = '') {
  const isNum = typeof value === 'number' && Number.isFinite(value);
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="${isNum ? 'Number' : 'String'}">${xmlEsc(isNum ? value : (value ?? ''))}</Data></Cell>`;
}
function row(values, style = '') {
  return `<Row>${values.map((v) => cell(v, style)).join('')}</Row>`;
}
function sheet(name, cols, rows) {
  return `<Worksheet ss:Name="${xmlEsc(name)}"><Table>${row(cols, 'hdr')}${rows.map((r) => row(cols.map((c) => r[c]))).join('')}</Table></Worksheet>`;
}

export function buildWorkbookXML(project) {
  const busRows = project.buses;
  const brRows = project.branches;
  const injRows = project.injections;
  const metaRows = [
    { k: '工程名称', v: project.meta.name },
    { k: '格式', v: 'ELECTRA SpreadsheetML 2003（可被 Excel 打开）' },
    { k: '基准容量 MVA', v: project.meta.baseMVA },
    { k: '频率 Hz', v: project.meta.frequency },
    { k: '外部系统短路容量 MVA', v: project.meta.sourceMVA },
    { k: '母线数', v: project.buses.length },
    { k: '支路数', v: project.branches.length },
    { k: '设备数', v: project.injections.length },
    { k: '说明', v: project.meta.note || '' }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/></Style></Styles>
 ${sheet('工程', ['字段', '值'], metaRows.map((r) => ({ 字段: r.k, 值: r.v })))}
 ${sheet('母线', BUS_COLS, busRows)}
 ${sheet('支路', BRANCH_COLS, brRows)}
 ${sheet('设备', INJ_COLS, injRows)}
 ${sheet('保护', RELAY_COLS, project.relays.map((r) => ({
   id: r.id, targetType: r.targetType || (r.busId ? 'bus' : 'branch'), branchId: r.branchId, busId: r.busId, name: r.name, enabled: r.enabled, mode: r.mode,
   ctPrimary: r.ct?.primary, ctSecondary: r.ct?.secondary, vtPrimary: r.vt?.primary, vtSecondary: r.vt?.secondary,
   z1: r.distance?.z1, z2: r.distance?.z2, z3: r.distance?.z3, t1: r.distance?.t1, t2: r.distance?.t2, t3: r.distance?.t3,
   ocPickup: r.overcurrent?.pickup, ocCurve: r.overcurrent?.curve, ocTms: r.overcurrent?.tms, ocInstPickup: r.overcurrent?.instPickup, ocInstTime: r.overcurrent?.instTime,
   diffPickup: r.differential?.pickup, diffSlope1: r.differential?.slope1, diffSlope2: r.differential?.slope2, diffT: r.differential?.t,
   recloseEnabled: r.reclose?.enabled, recloseAttempts: r.reclose?.attempts, recloseDeadTime: r.reclose?.deadTime, recloseReclaim: r.reclose?.reclaimTime,
   protectionsJson: JSON.stringify(r.protections || {})
 })))}
</Workbook>`;
}

export function buildEquipmentCSV(project) {
  const lines = [['类型', 'ID', '编号', '名称', '所属母线', 'P(MW)', 'Q(Mvar)', '容量(MVA)', '状态', '备注']];
  for (const b of project.buses) lines.push(['母线', b.id, b.tag, b.name, '', '', '', '', b.type, b.note]);
  for (const br of project.branches) lines.push(['支路', br.id, br.tag, br.name, `${br.from}→${br.to}${br.third ? `→${br.third}` : ''}`, '', '', br.ratingMVA, br.status, br.note]);
  for (const x of project.injections) lines.push([x.type, x.id, x.tag, x.name, x.bus, x.p, x.q, x.ratedMVA, x.status, x.note]);
  return lines.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function buildCIMXML(project) {
  const q = (s) => xmlEsc(s);
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');
  const buses = project.buses;
  const baseVoltages = [...new Set(buses.map((b) => Number(b.vn) || 0))].sort((a, b) => b - a);
  const bvId = (vn) => `_BV_${String(vn).replace('.', '_')}`;
  const nodeId = (b) => `_CN_${safe(b.id)}`;
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">`];
  for (const vn of baseVoltages) {
    out.push(`<cim:BaseVoltage rdf:about="#${bvId(vn)}"><cim:IdentifiedObject.name>${q(vn)} kV</cim:IdentifiedObject.name><cim:BaseVoltage.nominalVoltage>${vn}</cim:BaseVoltage.nominalVoltage></cim:BaseVoltage>`);
  }
  for (const b of buses) {
    out.push(`<cim:ConnectivityNode rdf:about="#${nodeId(b)}"><cim:IdentifiedObject.name>${q(b.tag)} CN</cim:IdentifiedObject.name></cim:ConnectivityNode>`);
    out.push(`<cim:BusbarSection rdf:about="#_BS_${safe(b.id)}"><cim:IdentifiedObject.name>${q(b.name)}</cim:IdentifiedObject.name><cim:Equipment.BaseVoltage rdf:resource="#${bvId(Number(b.vn) || 0)}"/></cim:BusbarSection>`);
    out.push(`<cim:Terminal rdf:about="#_T_BS_${safe(b.id)}"><cim:IdentifiedObject.name>${q(b.tag)} bus terminal</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_BS_${safe(b.id)}"/><cim:Terminal.ConnectivityNode rdf:resource="#${nodeId(b)}"/></cim:Terminal>`);
  }
  const terminal = (eqId, busId, n, name) => `<cim:Terminal rdf:about="#_T_${safe(eqId)}_${n}"><cim:IdentifiedObject.name>${q(name)}</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_EQ_${safe(eqId)}"/><cim:Terminal.ConnectivityNode rdf:resource="#${nodeId(project.buses.find((b) => b.id === busId) || { id: busId })}"/></cim:Terminal>`;
  for (const br of project.branches) {
    if (br.type === 'line') {
      out.push(`<cim:ACLineSegment rdf:about="#_EQ_${safe(br.id)}"><cim:IdentifiedObject.name>${q(br.name)}</cim:IdentifiedObject.name><cim:Conductor.length>${Number(br.length) || 0}</cim:Conductor.length><cim:ACLineSegment.r>${Number(br.R) || 0}</cim:ACLineSegment.r><cim:ACLineSegment.x>${Number(br.X) || 0}</cim:ACLineSegment.x><cim:ACLineSegment.bch>${(Number(br.B) || 0) * 1e-6}</cim:ACLineSegment.bch></cim:ACLineSegment>`);
      out.push(terminal(br.id, br.from, 1, `${br.tag} from`));
      out.push(terminal(br.id, br.to, 2, `${br.tag} to`));
    } else if (br.type === 'transformer' || br.type === 'transformer3') {
      out.push(`<cim:PowerTransformer rdf:about="#_EQ_${safe(br.id)}"><cim:IdentifiedObject.name>${q(br.name)}</cim:IdentifiedObject.name></cim:PowerTransformer>`);
      const ends = br.type === 'transformer3'
        ? [[br.from, br.vnH, br.sn], [br.to, br.vnM, br.sn], [br.third, br.vnL, br.sn]]
        : [[br.from, br.vn1, br.sn], [br.to, br.vn2, br.sn]];
      ends.forEach(([busId, vn, sn], idx) => {
        const endId = `_EQ_${safe(br.id)}_E${idx + 1}`;
        out.push(`<cim:PowerTransformerEnd rdf:about="#${endId}"><cim:IdentifiedObject.name>${q(br.tag)} end ${idx + 1}</cim:IdentifiedObject.name><cim:TransformerEnd.endNumber>${idx + 1}</cim:TransformerEnd.endNumber><cim:TransformerEnd.ratedS>${Number(sn) || 0}</cim:TransformerEnd.ratedS><cim:TransformerEnd.ratedU>${Number(vn) || 0}</cim:TransformerEnd.ratedU><cim:TransformerEnd.Terminal rdf:resource="#_T_${safe(br.id)}_${idx + 1}"/><cim:PowerTransformerEnd.r>${br.type === 'transformer3' ? 0 : (Number(br.uk) || 10) * 0.008}</cim:PowerTransformerEnd.r><cim:PowerTransformerEnd.x>${br.type === 'transformer3' ? 0 : (Number(br.uk) || 10) / 100}</cim:PowerTransformerEnd.x><cim:PowerTransformerEnd.PowerTransformer rdf:resource="#_EQ_${safe(br.id)}"/></cim:PowerTransformerEnd>`);
        out.push(`<cim:Terminal rdf:about="#_T_${safe(br.id)}_${idx + 1}"><cim:IdentifiedObject.name>${q(br.tag)} end ${idx + 1} terminal</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_EQ_${safe(br.id)}"/><cim:Terminal.ConnectivityNode rdf:resource="#${nodeId(project.buses.find((b) => b.id === busId) || { id: busId })}"/></cim:Terminal>`);
      });
    }
  }
  for (const inj of project.injections) {
    const eqId = `_EQ_${safe(inj.id)}`;
    if (inj.type === 'generator') {
      out.push(`<cim:SynchronousMachine rdf:about="#${eqId}"><cim:IdentifiedObject.name>${q(inj.name)}</cim:IdentifiedObject.name><cim:RotatingMachine.p>${Number(inj.p) || 0}</cim:RotatingMachine.p><cim:RotatingMachine.q>${Number(inj.q) || 0}</cim:RotatingMachine.q><cim:RotatingMachine.ratedS>${Number(inj.ratedMVA) || 0}</cim:RotatingMachine.ratedS></cim:SynchronousMachine>`);
    } else if (inj.type === 'load') {
      out.push(`<cim:EnergyConsumer rdf:about="#${eqId}"><cim:IdentifiedObject.name>${q(inj.name)}</cim:IdentifiedObject.name><cim:EnergyConsumer.p>${Number(inj.p) || 0}</cim:EnergyConsumer.p><cim:EnergyConsumer.q>${Number(inj.q) || 0}</cim:EnergyConsumer.q></cim:EnergyConsumer>`);
    } else {
      out.push(`<cim:ShuntCompensator rdf:about="#${eqId}"><cim:IdentifiedObject.name>${q(inj.name)}</cim:IdentifiedObject.name><cim:ShuntCompensator.bPerSection>${Number(inj.q) || 0}</cim:ShuntCompensator.bPerSection></cim:ShuntCompensator>`);
    }
    out.push(`<cim:Terminal rdf:about="#_T_${safe(inj.id)}"><cim:IdentifiedObject.name>${q(inj.name)} terminal</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#${eqId}"/><cim:Terminal.ConnectivityNode rdf:resource="#${nodeId(project.buses.find((b) => b.id === inj.bus) || { id: inj.bus })}"/></cim:Terminal>`);
  }
  out.push('</rdf:RDF>');
  return out.join('\n');
}

export function buildBPAText(project) {
  const lines = [
    'C  ELECTRA POWERSTUDIO - PSD-BPA STYLE CARD EXPORT',
    `C  ${project.meta.name}  ${new Date().toISOString().slice(0, 10)}`,
    'C  NOTE: simplified readable adapter card, not a certified BPA production deck.',
    `MVA_BASE ${project.meta.baseMVA}`,
    'C  BUS DATA: B TAG VN TYPE VM ANGLE',
    ...project.buses.map((b) => `B ${b.tag.padEnd(8)} ${String(b.vn).padStart(6)} ${b.type.padEnd(5)} ${Number(b.vm).toFixed(4)} ${Number(b.va || 0).toFixed(2)}`),
    'C  GENERATOR DATA: G TAG BUS P Q PMAX QMAX',
    ...project.injections.filter((x) => x.type === 'generator').map((g) => `G ${g.tag.padEnd(8)} ${(project.buses.find((b) => b.id === g.bus)?.tag || '').padEnd(8)} ${Number(g.p).toFixed(1)} ${Number(g.q || 0).toFixed(1)} ${Number(g.pMax || g.ratedMVA).toFixed(1)} ${Number(g.qMax).toFixed(1)}`),
    'C  LOAD DATA: L TAG BUS P Q MOTOR',
    ...project.injections.filter((x) => x.type === 'load').map((x) => `L ${x.tag.padEnd(8)} ${(project.buses.find((b) => b.id === x.bus)?.tag || '').padEnd(8)} ${Number(x.p).toFixed(1)} ${Number(x.q).toFixed(1)} ${x.motor ? 1 : 0}`),
    'C  LINE DATA: L TAG FROM TO R X B RATING',
    ...project.branches.filter((b) => b.type === 'line').map((b) => `L ${b.tag.padEnd(8)} ${(project.buses.find((x) => x.id === b.from)?.tag || '').padEnd(8)} ${(project.buses.find((x) => x.id === b.to)?.tag || '').padEnd(8)} ${Number(b.R).toFixed(4)} ${Number(b.X).toFixed(4)} ${Number(b.B).toFixed(2)} ${Number(b.ratingMVA).toFixed(1)}`),
    'C  TRANSFORMER DATA: T TAG FROM TO SN UK TAP',
    ...project.branches.filter((b) => b.type === 'transformer' || b.type === 'transformer3').map((b) => `T ${b.tag.padEnd(8)} ${(project.buses.find((x) => x.id === b.from)?.tag || '').padEnd(8)} ${(project.buses.find((x) => x.id === b.to)?.tag || b.third || '').padEnd(8)} ${Number(b.sn).toFixed(1)} ${Number(b.type === 'transformer3' ? b.ukHM : b.uk).toFixed(2)} ${Number(b.tap ?? b.tapH ?? 0).toFixed(2)}`),
    'END'
  ];
  return lines.join('\n');
}

function readCell(c) {
  const d = c.getElementsByTagNameNS('*', 'Data')[0] || c.getElementsByTagName('Data')[0];
  if (!d) return '';
  const t = d.getAttribute('ss:Type') || d.getAttribute('Type');
  const text = d.textContent || '';
  if (t === 'Number') return text === '' ? '' : Number(text);
  return text;
}
function readSheet(ws) {
  const rows = [...ws.getElementsByTagNameNS('*', 'Row')];
  if (!rows.length) return [];
  const header = [...rows[0].getElementsByTagNameNS('*', 'Cell')].map(readCell).map((s) => String(s));
  return rows.slice(1).map((r) => {
    const cells = [...r.getElementsByTagNameNS('*', 'Cell')].map(readCell);
    const obj = {};
    header.forEach((h, i) => { if (h) obj[h] = cells[i] ?? ''; });
    return obj;
  }).filter((o) => Object.values(o).some((v) => v !== ''));
}

function applyNumeric(target, row, numericSet, skip = new Set()) {
  for (const key of Object.keys(row)) {
    if (skip.has(key)) continue;
    const v = row[key];
    if (v === '' || v == null) continue;
    if (numericSet.has(key)) {
      const n = Number(v);
      if (Number.isFinite(n)) target[key] = n;
    } else if (key === 'grounded' || key === 'motor' || key === 'switchClosed' || key === 'closed' || key === 'autoReclose') {
      target[key] = bool(v);
    } else target[key] = v;
  }
}

export function parseWorkbook(xml, baseProject) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Excel XML 解析失败：' + err.textContent.slice(0, 160));
  const sheets = {};
  for (const ws of doc.getElementsByTagNameNS('*', 'Worksheet')) {
    const name = ws.getAttribute('ss:Name') || ws.getAttribute('Name');
    sheets[name] = readSheet(ws);
  }
  if (!sheets['母线'] || !sheets['支路']) throw new Error('文件中缺少“母线”或“支路”工作表，无法导入。');
  const project = clone(baseProject);
  const summary = { buses: 0, branches: 0, injections: 0, protections: 0, added: 0 };
  const busLookup = new Map();
  for (const b of project.buses) { busLookup.set(b.id, b); busLookup.set(b.tag, b); }
  for (const row of sheets['母线']) {
    let bus = project.buses.find((b) => b.id === row.id) || project.buses.find((b) => b.tag === row.tag);
    if (!bus) {
      if (!row.tag || !row.vn) continue;
      bus = newBus({ tag: row.tag, name: row.name || row.tag, vn: Number(row.vn) || 110, x: 300, y: 200 });
      if (row.id) bus.id = String(row.id);
      project.buses.push(bus);
      summary.added++;
    }
    applyNumeric(bus, row, NUMERIC_BUS, new Set(['id']));
    if (row.id) { bus.id = String(row.id); }
    busLookup.set(bus.id, bus); busLookup.set(bus.tag, bus);
    summary.buses++;
  }
  for (const row of sheets['支路']) {
    const from = busLookup.get(row.from) || project.buses.find((b) => b.tag === row.from);
    const to = busLookup.get(row.to) || project.buses.find((b) => b.tag === row.to);
    const third = row.third ? (busLookup.get(row.third) || project.buses.find((b) => b.tag === row.third)) : null;
    if (!from || !to) continue;
    let br = project.branches.find((b) => b.id === row.id);
    if (!br) {
      const type = ['line', 'transformer', 'transformer3', ...SWITCH_TYPES, ...SERIES_TYPES].includes(row.type) ? row.type : 'line';
      if (type === 'transformer3' && !third) continue;
      br = newBranch(type, from.id, to.id, { tag: row.tag || 'BR', name: row.name || '导入支路', third: third?.id || null });
      if (row.id) br.id = String(row.id);
      project.branches.push(br);
      summary.added++;
    }
    applyNumeric(br, row, NUMERIC_BR, new Set(['id', 'type', 'from', 'to', 'third']));
    br.from = from.id; br.to = to.id; if (third) br.third = third.id;
    summary.branches++;
  }
  if (sheets['设备']) {
    for (const row of sheets['设备']) {
      const bus = busLookup.get(row.bus) || project.buses.find((b) => b.tag === row.bus);
      if (!bus) continue;
      let inj = project.injections.find((x) => x.id === row.id);
      if (!inj) {
        const type = ['generator', 'load', 'shunt'].includes(row.type) ? row.type : 'load';
        if (!row.tag) continue;
        inj = newInjection(type, bus.id, { tag: row.tag, name: row.name || row.tag });
        if (row.id) inj.id = String(row.id);
        project.injections.push(inj);
        summary.added++;
      }
      applyNumeric(inj, row, NUMERIC_INJ, new Set(['id', 'type']));
      inj.bus = bus.id;
      summary.injections++;
    }
  }
  if (sheets['保护']) {
    for (const row of sheets['保护']) {
      let relay = project.relays.find((r) => r.id === row.id)
        || project.relays.find((r) => row.targetType === 'bus' ? r.busId === row.busId : r.branchId === row.branchId);
      if (!relay && (row.targetType === 'bus' || row.busId)) {
        const bus = project.buses.find((b) => b.id === row.busId);
        if (bus) {
          relay = newBusRelay(bus, { id: row.id || undefined });
          project.relays.push(relay);
        }
      }
      if (!relay) continue;
      if (row.name) relay.name = String(row.name);
      if (row.enabled !== '' && row.enabled != null) relay.enabled = bool(row.enabled);
      if (row.mode) relay.mode = String(row.mode);
      if (row.protectionsJson) {
        try { relay.protections = JSON.parse(String(row.protectionsJson)); } catch {}
      }
      const setNum = (obj, key, val) => { if (obj && val !== '' && val != null && Number.isFinite(Number(val))) obj[key] = Number(val); };
      setNum(relay.ct, 'primary', row.ctPrimary); setNum(relay.ct, 'secondary', row.ctSecondary);
      setNum(relay.vt, 'primary', row.vtPrimary); setNum(relay.vt, 'secondary', row.vtSecondary);
      setNum(relay.distance, 'z1', row.z1); setNum(relay.distance, 'z2', row.z2); setNum(relay.distance, 'z3', row.z3);
      setNum(relay.distance, 't1', row.t1); setNum(relay.distance, 't2', row.t2); setNum(relay.distance, 't3', row.t3);
      setNum(relay.overcurrent, 'pickup', row.ocPickup); setNum(relay.overcurrent, 'tms', row.ocTms);
      setNum(relay.overcurrent, 'instPickup', row.ocInstPickup); setNum(relay.overcurrent, 'instTime', row.ocInstTime);
      if (row.ocCurve) relay.overcurrent.curve = String(row.ocCurve);
      setNum(relay.differential, 'pickup', row.diffPickup); setNum(relay.differential, 'slope1', row.diffSlope1);
      setNum(relay.differential, 'slope2', row.diffSlope2); setNum(relay.differential, 't', row.diffT);
      if (relay.reclose) {
        if (row.recloseEnabled !== '' && row.recloseEnabled != null) relay.reclose.enabled = bool(row.recloseEnabled);
        setNum(relay.reclose, 'attempts', row.recloseAttempts);
        setNum(relay.reclose, 'deadTime', row.recloseDeadTime);
        setNum(relay.reclose, 'reclaimTime', row.recloseReclaim);
      }
      summary.protections++;
    }
  }
  return { project: loadProject(project), summary };
}
