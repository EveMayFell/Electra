import { icon } from './icons.js';
import { voltageColor } from './diagram.js';
import { lineParameters, transformerParameters, threeWindingParameters } from '../engine/powerflow.js';
import { relayForBranch } from '../engine/protection.js';
import { summarize } from '../model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—');
const num = (v) => (v === '' || v == null ? 0 : Number(v));

const SC_ONLY_FIELDS = new Set(['r0PerKm', 'x0PerKm', 'b0PerKm', 'R0', 'X0', 'B0', 'zeroMode', 'zeroUk', 'grounded', 'xg0', 'motor', 'motorX']);
const STABILITY_ONLY_FIELDS = new Set(['inertia', 'xd', 'pMin', 'pMax', 'costA', 'costB', 'damping']);

const ELECTRICAL_FIELDS = new Set([
  'vn', 'type', 'vm', 'va', 'baseMVA', 'frequency', 'sourceMVA', 'p', 'q', 'qMin', 'qMax', 'ratedMVA',
  'sn', 'vn1', 'vn2', 'uk', 'pk', 'p0', 'i0', 'tap', 'shift', 'ratingMVA', 'length', 'rPerKm', 'xPerKm',
  'third', 'thirdSwitch', 'ukHM', 'ukHL', 'ukML', 'vnH', 'vnM', 'vnL', 'tapH', 'tapM', 'tapL',
  'bPerKm', 'R', 'X', 'B', 'droop', 'governor', 'closed', 'status', 'switchClosed', 'from', 'to', 'fromSwitch', 'toSwitch',
  'voltageClass', 'lineKind', 'insulation', 'ampacity', 'loadType', 'kind', 'pos',
  'rOhm', 'xOhm', 'zeroXOhm', 'xcOhm', 'xNormalOhm', 'xFaultOhm',
  'loadBreakCurrent', 'autoReclose', 'recloseTime', 'recloseAttempts', 'count'
]);

function field(label, name, value, opts = {}) {
  const full = opts.full ? ' full' : '';
  const unit = opts.unit ? `<span class="unit">${esc(opts.unit)}</span>` : '';
  const hint = opts.hint ? `<div class="hint">${opts.hint}</div>` : '';
  if (opts.select) {
    return `<div class="field${full}">
      <label>${esc(label)}${unit}</label>
      <select data-field="${esc(name)}" ${opts.rerender ? 'data-rerender="1"' : ''}>${opts.select.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      ${hint}
    </div>`;
  }
  if (opts.textarea) {
    return `<div class="field${full}"><label>${esc(label)}${unit}</label><textarea data-field="${esc(name)}">${esc(value)}</textarea>${hint}</div>`;
  }
  if (opts.range) {
    return `<div class="field${full}"><label>${esc(label)}${unit}<output data-output-for="${esc(name)}">${esc(value)}</output></label>
      <div class="range-line"><input type="range" data-field="${esc(name)}" value="${esc(value)}" min="${opts.min ?? 0}" max="${opts.max ?? 100}" step="${opts.step ?? 1}"><span class="hint">${esc(opts.rangeHint || '')}</span></div>${hint}</div>`;
  }
  return `<div class="field${full}">
    <label>${esc(label)}${unit}</label>
    ${opts.wrap ? `<div class="input-wrap"><input type="${opts.type || 'text'}" data-field="${esc(name)}" value="${esc(value)}" ${opts.min != null ? `min="${opts.min}"` : ''} ${opts.max != null ? `max="${opts.max}"` : ''} step="${opts.step || 'any'}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>${opts.suffix ? `<span class="suffix">${esc(opts.suffix)}</span>` : ''}</div>` : `<input type="${opts.type || 'text'}" data-field="${esc(name)}" value="${esc(value)}" ${opts.min != null ? `min="${opts.min}"` : ''} ${opts.max != null ? `max="${opts.max}"` : ''} step="${opts.step || 'any'}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>`}
    ${hint}
  </div>`;
}

function toggleRow(label, fieldName, on, iconName = 'play') {
  return `<div class="switch-row">
    <span class="switch-label">${icon(iconName, 13)} ${esc(label)}</span>
    <button class="toggle ${on ? 'on' : ''}" data-action="toggle-field" data-field="${esc(fieldName)}" aria-label="${esc(label)}"></button>
  </div>`;
}

function chip(text, cls = '', dot = false) {
  return `<span class="chip ${cls}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>`;
}

function issueList(issues, limit = 5) {
  if (!issues?.length) return `<div class="issue-item ok">${icon('check', 12)} 暂无规则告警，可继续计算。</div>`;
  const iconName = (level) => level === 'error' ? 'x' : level === 'warning' ? 'warning' : 'info';
  return issues.slice(0, limit).map((i) => `<div class="issue-item ${i.level}">${icon(iconName(i.level), 12)}<span>${esc(i.msg)}</span></div>`).join('');
}

function targetFor(app) {
  const sel = app.selection || { kind: 'project' };
  if (sel.kind === 'bus') return app.project.buses.find((b) => b.id === sel.id);
  if (sel.kind === 'branch') return app.project.branches.find((b) => b.id === sel.id);
  if (sel.kind === 'injection') return app.project.injections.find((x) => x.id === sel.id);
  return app.project.meta;
}

function targetIsMeta(app) { return !app.selection || app.selection.kind === 'project'; }

export function renderInspector(app, root) {
  if (!root) return;
  const sel = app.selection || { kind: 'project' };
  let html = '';
  if (sel.kind === 'bus') {
    const bus = app.project.buses.find((b) => b.id === sel.id);
    if (!bus) { app.selection = { kind: 'project', id: null }; return renderInspector(app, root); }
    html = busInspector(app, bus);
  } else if (sel.kind === 'branch') {
    const br = app.project.branches.find((b) => b.id === sel.id);
    if (!br) { app.selection = { kind: 'project', id: null }; return renderInspector(app, root); }
    html = branchInspector(app, br);
  } else if (sel.kind === 'injection') {
    const inj = app.project.injections.find((x) => x.id === sel.id);
    if (!inj) { app.selection = { kind: 'project', id: null }; return renderInspector(app, root); }
    html = injectionInspector(app, inj);
  } else {
    html = projectInspector(app);
  }
  root.innerHTML = html;
}

function projectInspector(app) {
  const p = app.project;
  const s = summarize(p);
  const issues = app.issues || [];
  const errs = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const recent = issues.slice(0, 4);
  return `
    <div class="inspector-head">
      <div class="inspector-icon">${icon('layers', 19)}</div>
      <div class="inspector-head-copy">
        <div class="inspector-kicker">PROJECT OVERVIEW</div>
        <div class="inspector-title">工程属性与校核</div>
      </div>
      <div class="inspector-head-actions">
        <button class="icon-btn" data-action="project-settings" title="工程设置">${icon('settings', 14)}</button>
      </div>
    </div>
    <div class="overview-hero">
      <div class="ov-kicker">POWER SYSTEM PROJECT</div>
      <div class="ov-name">${esc(p.meta.name)}</div>
      <div class="ov-meta">${esc(p.meta.projectNo)} · ${esc(p.meta.owner || '未填写设计单位')}</div>
      <div class="overview-stats">
        <div class="ov-stat"><div class="v">${s.buses}</div><div class="l">母线节点</div></div>
        <div class="ov-stat"><div class="v">${s.lines + s.transformers}</div><div class="l">线路 / 变压器</div></div>
        <div class="ov-stat"><div class="v">${s.loads}</div><div class="l">负荷</div></div>
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-title">工程参数</div>
      <div class="field-grid">
        ${field('工程名称', 'name', p.meta.name, { full: true })}
        ${field('工程编号', 'projectNo', p.meta.projectNo)}
        ${field('设计单位', 'owner', p.meta.owner)}
        ${field('基准容量', 'baseMVA', p.meta.baseMVA, { type: 'number', unit: 'MVA', min: 1 })}
        ${field('系统频率', 'frequency', p.meta.frequency, { type: 'number', unit: 'Hz' })}
        ${field('系统短路容量', 'sourceMVA', p.meta.sourceMVA || 12000, { type: 'number', unit: 'MVA', hint: '用于短路电流等值电源，可按电网提供的短路容量填写。' })}
        ${field('设计日期', 'date', p.meta.date, { type: 'date' })}
        ${field('工程说明', 'note', p.meta.note, { textarea: true, full: true })}
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-title">设计校核</div>
      <div class="quick-checks">
        <div class="quick-check"><span>拓扑校核</span><span class="qv ${errs ? 'red' : warns ? 'amber' : 'green'}">${errs ? `${errs} 错误` : warns ? `${warns} 提示` : '通过'}</span></div>
        <div class="quick-check"><span>保护配置</span><span class="qv">${s.relays} 套投入</span></div>
        <div class="quick-check"><span>潮流结果</span><span class="qv">${app.results ? (app.results.converged ? '已收敛' : '未收敛') : '未计算'}</span></div>
        <div class="quick-check"><span>短路校验</span><span class="qv">${app.shortCircuit ? `${app.shortCircuit.Ik.toFixed(2)} kA` : '未计算'}</span></div>
      </div>
      <div class="issue-list" style="margin-top:10px">${issueList(recent)}</div>
    </div>
    <div class="inspector-section">
      <div class="section-title">快速操作</div>
      <div class="inspector-actions">
        <button class="btn" data-action="run-flow">${icon('play', 13)} 潮流计算</button>
        <button class="btn" data-action="open-matrices">${icon('matrix', 13)} 矩阵浏览器</button>
        <button class="btn" data-action="project-settings">${icon('settings', 13)} 工程设置</button>
        <button class="btn" data-action="shortcuts">${icon('keyboard', 13)} 快捷键</button>
      </div>
      <div class="inspector-empty-note" style="margin-top:10px">提示：单击画布中的母线、支路或设备可编辑参数。母线可直接拖动，线路端点会自动重排。</div>
    </div>`;
}

function busInspector(app, bus) {
  const result = app.results?.busById?.[bus.id];
  const color = voltageColor(bus.vn);
  const conn = app.project.branches.filter((b) => b.from === bus.id || b.to === bus.id);
  const gens = app.project.injections.filter((x) => x.bus === bus.id && x.type === 'generator');
  const loads = app.project.injections.filter((x) => x.bus === bus.id && x.type === 'load');
  const shunts = app.project.injections.filter((x) => x.bus === bus.id && x.type === 'shunt');
  return `
    <div class="inspector-head">
      <div class="inspector-icon" style="color:${color};background:${color}14;border-color:${color}30">${icon('bus', 20)}</div>
      <div class="inspector-head-copy">
        <div class="inspector-kicker">NODE / 母线</div>
        <div class="inspector-title">${esc(bus.tag)} · ${esc(bus.name)}</div>
      </div>
      <div class="inspector-head-actions">
        <button class="icon-btn" data-action="duplicate" title="复制母线">${icon('copy', 14)}</button>
        <button class="icon-btn" data-action="delete" title="删除母线">${icon('trash', 14)}</button>
      </div>
    </div>
    <div class="chip-row">
      ${chip(`${bus.vn} kV`, '', true)}
      ${chip({ slack: '平衡节点', PV: 'PV 节点', PQ: 'PQ 节点' }[bus.type] || bus.type, bus.type === 'slack' ? 'warn' : bus.type === 'PV' ? 'ok' : '')}
      ${chip(`耐受 ${bus.scRating ?? '—'} kA`, 'purple')}
      ${chip(`${conn.length} 条支路`)}
      ${result ? chip(`V = ${result.Vm.toFixed(4)} pu`, result.Vm < 0.95 || result.Vm > 1.05 ? 'warn' : 'ok') : ''}
    </div>
    <div class="inspector-section">
      <div class="section-title">基本参数</div>
      <div class="field-grid">
        ${field('设备名称', 'name', bus.name, { full: true })}
        ${field('设备编号', 'tag', bus.tag)}
        ${field('电压等级', 'vn', bus.vn, { type: 'number', unit: 'kV', min: 0.1, rerender: true })}
        ${field('节点类型', 'type', bus.type, { select: [{ value: 'PQ', label: 'PQ · 负荷节点' }, { value: 'PV', label: 'PV · 电压控制' }, { value: 'slack', label: 'Slack · 平衡节点' }], rerender: true })}
        ${field('电压幅值', 'vm', bus.vm, { type: 'number', unit: 'pu', min: 0.5, max: 1.5, step: 0.001 })}
        ${field('电压相角', 'va', bus.va, { type: 'number', unit: '°', step: 0.1 })}
        ${field('短路耐受电流', 'scRating', bus.scRating ?? 31.5, { type: 'number', unit: 'kA', min: 0.1, step: 0.1, hint: '母线及开关设备的短时耐受 / 开断能力，用于短路扫描校核。' })}
      </div>
      <div class="field" style="margin-top:9px">
        <label>母线宽度 <span class="unit">px</span><output data-output-for="width">${bus.width}</output></label>
        <div class="range-line"><input type="range" data-field="width" value="${bus.width}" min="180" max="520" step="10"><span class="hint">视觉布局</span></div>
      </div>
      <div class="field-grid" style="margin-top:9px">
        ${field('画布 X', 'x', bus.x, { type: 'number', unit: 'px' })}
        ${field('画布 Y', 'y', bus.y, { type: 'number', unit: 'px' })}
      </div>
      <div class="derived-card">
        <div class="d-head">${icon('info', 10)} 节点说明</div>
        <div class="hint" style="color:var(--muted);line-height:1.65">${
          bus.type === 'slack' ? '平衡节点固定电压幅值与相角，承担系统有功/无功平衡。每个电气岛至少需要一个平衡节点。'
          : bus.type === 'PV' ? 'PV 节点固定有功功率与电压幅值，无功由发电机调节。请确认该母线接有投入运行的发电机。'
          : 'PQ 节点固定有功与无功注入，电压由潮流计算结果确定。负荷与固定无功发电机通常接于 PQ 节点。'
        }</div>
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-title">连接设备</div>
      <div class="chip-row">
        ${gens.length ? chip(`发电机 ×${gens.length}`, 'warn') : ''}
        ${loads.length ? chip(`负荷 ×${loads.length}`) : ''}
        ${shunts.length ? chip(`补偿 ×${shunts.length}`, 'purple') : ''}
        ${conn.length ? chip(`支路 ×${conn.length}`) : ''}
        ${!gens.length && !loads.length && !shunts.length && !conn.length ? '<span class="hint">尚未连接任何设备</span>' : ''}
      </div>
    </div>
    ${result ? `<div class="inspector-section"><div class="section-title">潮流结果</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">电压幅值</div><div class="d-val accent">${result.Vm.toFixed(5)} pu</div></div>
        <div class="d-item"><div class="d-label">相角</div><div class="d-val">${result.Va.toFixed(2)}°</div></div>
        <div class="d-item"><div class="d-label">发电机有功</div><div class="d-val">${result.pGen != null ? result.pGen.toFixed(2) : '—'} MW</div></div>
        <div class="d-item"><div class="d-label">发电机无功</div><div class="d-val">${result.qGen != null ? result.qGen.toFixed(2) : '—'} Mvar</div></div>
        <div class="d-item"><div class="d-label">负荷</div><div class="d-val">${result.pLoad.toFixed(1)} + j${result.qLoad.toFixed(1)}</div></div>
        <div class="d-item"><div class="d-label">节点类型</div><div class="d-val">${result.type}</div></div>
      </div>
    </div>` : ''}
    <div class="inspector-section">
      <div class="section-title">备注</div>
      <textarea data-field="note" style="width:100%;height:58px;border:1px solid var(--line);border-radius:6px;background:#091421;padding:7px;color:var(--text-soft);font-size:10px;outline:none" placeholder="记录母线运行方式、检修说明等">${esc(bus.note || '')}</textarea>
    </div>
    <div class="inspector-actions">
      <button class="btn" data-action="duplicate">${icon('copy', 13)} 复制母线</button>
      <button class="btn btn-danger" data-action="delete">${icon('trash', 13)} 删除母线</button>
    </div>`;
}

function branchInspector(app, br) {
  const a = app.project.buses.find((b) => b.id === br.from);
  const b = app.project.buses.find((x) => x.id === br.to);
  const result = app.results?.branchResults?.find((x) => x.id === br.id);
  const typeLabel = { line: '输电线路', transformer: '电力变压器', transformer3: '三绕组变压器', breaker: '断路器', switch: '隔离开关', disconnector: '隔离开关', loadSwitch: '负荷开关', recloser: '重合器', sectionalizer: '分段器', fuse: '熔断器', seriesReactor: '串联电抗器', seriesCap: '串联电容器', fcl: '故障电流限制器' }[br.type] || br.type;
  const color = br.type === 'transformer' || br.type === 'transformer3' ? '#ffc46e' : br.type === 'line' ? '#65adff' : ['seriesReactor', 'seriesCap', 'fcl'].includes(br.type) ? '#ffb37a' : '#75c8ff';
  const windingResults = br.type === 'transformer3' ? (app.results?.branchResults?.filter((x) => x.parentId === br.id) || []) : [];
  const maxWindingLoad = windingResults.length ? Math.max(...windingResults.map((x) => x.loading || 0)) : 0;
  let settings = '';
  if (br.type === 'line') settings = lineSettings(app, br, a, b);
  else if (br.type === 'transformer') settings = transformerSettings(app, br, a, b);
  else if (br.type === 'transformer3') settings = threeWindingSettings(app, br);
  else if (['seriesReactor', 'seriesCap', 'fcl'].includes(br.type)) settings = seriesSettings(app, br);
  else settings = switchSettings(app, br);
  return `
    <div class="inspector-head">
      <div class="inspector-icon" style="color:${color};background:${color}14;border-color:${color}30">${icon(br.type === 'transformer' ? 'transformer' : br.type === 'line' ? 'line' : br.type, 20)}</div>
      <div class="inspector-head-copy">
        <div class="inspector-kicker">BRANCH / ${br.type.toUpperCase()}</div>
        <div class="inspector-title">${esc(br.tag)} · ${esc(br.name)}</div>
      </div>
      <div class="inspector-head-actions">
        <button class="icon-btn" data-action="duplicate" title="复制支路">${icon('copy', 14)}</button>
        <button class="icon-btn" data-action="delete" title="删除支路">${icon('trash', 14)}</button>
      </div>
    </div>
    <div class="chip-row">
      ${chip(typeLabel, br.type === 'transformer' || br.type === 'transformer3' ? 'warn' : '')}
      ${chip(br.status === 'in' ? '运行' : '停运', br.status === 'in' ? 'ok' : 'neutral', br.status === 'in')}
      ${result ? chip(`负载 ${result.loading.toFixed(0)}%`, result.loading > 100 ? 'error' : result.loading > 80 ? 'warn' : 'ok') : br.type === 'transformer3' && windingResults.length ? chip(`最大绕组负载 ${maxWindingLoad.toFixed(0)}%`, maxWindingLoad > 100 ? 'error' : maxWindingLoad > 80 ? 'warn' : 'ok') : ''}
      ${relayForBranch(app.project, br.id) ? chip('保护已配置', 'ok') : ['line', 'transformer'].includes(br.type) ? chip('未配置保护', 'warn') : br.type === 'transformer3' ? chip('三侧差动需专项配置', 'purple') : ''}
    </div>
    <div class="inspector-section">
      <div class="section-title">连接与状态</div>
      <div class="field-grid">
        ${field('设备名称', 'name', br.name, { full: true })}
        ${field('设备编号', 'tag', br.tag)}
        ${field('运行状态', 'status', br.status, { select: [{ value: 'in', label: '投入运行' }, { value: 'out', label: '停运检修' }], rerender: true })}
        ${field(br.type === 'transformer3' ? '高压侧母线' : '起点母线', 'from', br.from, { select: app.project.buses.map((x) => ({ value: x.id, label: `${x.tag} · ${x.name}` })), rerender: true })}
        ${field(br.type === 'transformer3' ? '中压侧母线' : '终点母线', 'to', br.to, { select: app.project.buses.map((x) => ({ value: x.id, label: `${x.tag} · ${x.name}` })), rerender: true })}
        ${br.type === 'transformer3' ? field('低压侧母线', 'third', br.third, { select: app.project.buses.map((x) => ({ value: x.id, label: `${x.tag} · ${x.name}` })), rerender: true }) : ''}
      </div>
      ${br.type === 'line' || br.type === 'transformer' || br.type === 'transformer3' ? `<div class="field-grid" style="margin-top:9px">
        ${field('首端/高压侧开关', 'fromSwitch', br.fromSwitch || 'closed', { select: [{ value: 'closed', label: '合闸' }, { value: 'open', label: '分闸' }] })}
        ${field('末端/中压侧开关', 'toSwitch', br.toSwitch || 'closed', { select: [{ value: 'closed', label: '合闸' }, { value: 'open', label: '分闸' }] })}
        ${br.type === 'transformer3' ? field('低压侧开关', 'thirdSwitch', br.thirdSwitch || 'closed', { select: [{ value: 'closed', label: '合闸' }, { value: 'open', label: '分闸' }] }) : ''}
      </div>` : ''}
      ${br.from === br.to ? `<div class="issue-item warning" style="margin-top:8px">${icon('warning', 12)} 支路两端不能连接同一母线。</div>` : ''}
    </div>
    ${settings}
    <div class="inspector-section">
      <div class="section-title">显示与备注</div>
      ${field('备注', 'note', br.note || '', { textarea: true })}
    </div>
    ${result ? resultInspector(result, br) : br.type === 'transformer3' ? threeWindingResultInspector(windingResults) : ''}
    <div class="inspector-actions">
      <button class="btn" data-action="${['line', 'transformer'].includes(br.type) ? 'open-protection-branch' : 'duplicate'}">${icon(['line', 'transformer'].includes(br.type) ? 'shield' : 'copy', 13)} ${['line', 'transformer'].includes(br.type) ? '继电保护' : '复制支路'}</button>
      <button class="btn btn-danger" data-action="delete">${icon('trash', 13)} 删除支路</button>
    </div>`;
}

function lineSettings(app, br, a, b) {
  const p = lineParameters(br);
  const z = Math.hypot(p.R, p.X);
  const qc = (p.B * 1e-6) * Math.pow(Number(br.voltageClass) || a?.vn || 110, 2);
  const charging = br.paramMode === 'distributed' ? '精确双曲函数等效 π' : '集中参数 π 模型';
  return `<div class="inspector-section">
    <div class="section-title">线路参数</div>
    <div class="segmented" style="margin-bottom:10px">
      <button class="${br.paramMode === 'distributed' ? 'active' : ''}" data-action="set-param-mode" data-mode="distributed">分布参数</button>
      <button class="${br.paramMode === 'lumped' ? 'active' : ''}" data-action="set-param-mode" data-mode="lumped">集中参数</button>
    </div>
    <div class="field-grid">
      ${field('线路长度', 'length', br.length, { type: 'number', unit: 'km', min: 0, step: 0.1 })}
      ${field('电压等级', 'voltageClass', br.voltageClass || a?.vn || 110, { type: 'number', unit: 'kV', min: 1 })}
      ${field('线路类型', 'lineKind', br.lineKind || 'overhead', { select: [{ value: 'overhead', label: '架空线路' }, { value: 'cable', label: '电力电缆' }], rerender: true })}
      ${br.lineKind === 'cable' ? field('绝缘类型', 'insulation', br.insulation || 'XLPE', { select: ['XLPE', '油纸', 'PVC', 'EPR'].map((x) => ({ value: x, label: x })) }) : ''}
      ${br.lineKind === 'cable' ? field('允许载流量', 'ampacity', br.ampacity ?? 600, { type: 'number', unit: 'A', min: 0 }) : ''}
      ${br.paramMode === 'distributed' ? `
        ${field('正序电阻 r₁', 'rPerKm', br.rPerKm, { type: 'number', unit: 'Ω/km', min: 0, step: 0.001 })}
        ${field('正序电抗 x₁', 'xPerKm', br.xPerKm, { type: 'number', unit: 'Ω/km', min: 0, step: 0.001 })}
        ${field('充电电纳 b₁', 'bPerKm', br.bPerKm, { type: 'number', unit: 'µS/km', min: 0, step: 0.01 })}
      ` : `
        ${field('总电阻 R', 'R', br.R, { type: 'number', unit: 'Ω', min: 0, step: 0.001 })}
        ${field('总电抗 X', 'X', br.X, { type: 'number', unit: 'Ω', min: 0, step: 0.001 })}
        ${field('总电纳 B', 'B', br.B, { type: 'number', unit: 'µS', min: 0, step: 0.1 })}
      `}
      ${field('热稳定容量', 'ratingMVA', br.ratingMVA, { type: 'number', unit: 'MVA', min: 0.1 })}
      ${field(br.lineKind === 'cable' ? '电缆型号' : '导线型号', 'conductor', br.conductor || '', { full: true, placeholder: br.lineKind === 'cable' ? '如 YJV-3×240' : '如 LGJ-400/35' })}
    </div>
    <div class="derived-card">
      <div class="d-head">${icon('matrix', 10)} 计算等值参数 · ${charging}</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">总电阻 R</div><div class="d-val">${fmt(p.R, 4)} Ω</div></div>
        <div class="d-item"><div class="d-label">总电抗 X</div><div class="d-val">${fmt(p.X, 4)} Ω</div></div>
        <div class="d-item"><div class="d-label">阻抗模值 |Z|</div><div class="d-val accent">${fmt(z, 4)} Ω</div></div>
        <div class="d-item"><div class="d-label">总充电电纳</div><div class="d-val">${fmt(p.B, 3)} µS</div></div>
        <div class="d-item"><div class="d-label">额定电压充电功率</div><div class="d-val">${fmt(qc, 2)} Mvar</div></div>
        <div class="d-item"><div class="d-label">R/X 比</div><div class="d-val">${p.X ? fmt(p.R / p.X, 3) : '—'}</div></div>
      </div>
    </div>
    <div class="notice-strip" style="margin-top:9px">${icon('info', 13)} 分布参数模式采用长线双曲函数修正，自动生成等效 π 型电路；集中参数模式直接使用总 R/X/B。${br.lineKind === 'cable' ? ' 电缆的充电电纳通常明显高于架空线，长电缆应重点关注充电功率与过电压。' : ''}</div>
    <div class="section-title" style="margin-top:13px">零序参数 · 单相接地短路</div>
    <div class="field-grid">
      ${br.paramMode === 'distributed' ? `
        ${field('零序电阻 r₀', 'r0PerKm', br.r0PerKm, { type: 'number', unit: 'Ω/km', min: 0, step: 0.001 })}
        ${field('零序电抗 x₀', 'x0PerKm', br.x0PerKm, { type: 'number', unit: 'Ω/km', min: 0, step: 0.001 })}
        ${field('零序电纳 b₀', 'b0PerKm', br.b0PerKm, { type: 'number', unit: 'µS/km', min: 0, step: 0.01 })}
      ` : `
        ${field('总零序电阻 R₀', 'R0', br.R0, { type: 'number', unit: 'Ω', min: 0, step: 0.001 })}
        ${field('总零序电抗 X₀', 'X0', br.X0, { type: 'number', unit: 'Ω', min: 0, step: 0.001 })}
        ${field('总零序电纳 B₀', 'B0', br.B0, { type: 'number', unit: 'µS', min: 0, step: 0.1 })}
      `}
    </div>
    <div class="hint" style="color:var(--dim);margin-top:6px">零序参数仅用于单相接地短路计算；默认按 x₀≈3x₁、b₀≈0.8b₁ 估算，正式工程应替换为实测或设计值。</div>
  </div>`;
}

function threeWindingSettings(app, br) {
  const buses = app.project.buses;
  const p = threeWindingParameters(br, buses.find((b) => b.id === br.from)?.vn || br.vnH || 220, buses.find((b) => b.id === br.to)?.vn || br.vnM || 110, buses.find((b) => b.id === br.third)?.vn || br.vnL || 35, app.project.meta.baseMVA || 100);
  return `<div class="inspector-section">
    <div class="section-title">三绕组变压器参数</div>
    <div class="field-grid">
      ${field('额定容量', 'sn', br.sn, { type: 'number', unit: 'MVA', min: 0.1 })}
      ${field('负载损耗 Pk', 'pk', br.pk, { type: 'number', unit: 'kW', min: 0 })}
      ${field('高中压 Uk HM', 'ukHM', br.ukHM, { type: 'number', unit: '%', min: 0.1, step: 0.1 })}
      ${field('高低压 Uk HL', 'ukHL', br.ukHL, { type: 'number', unit: '%', min: 0.1, step: 0.1 })}
      ${field('中低压 Uk ML', 'ukML', br.ukML, { type: 'number', unit: '%', min: 0.1, step: 0.1 })}
      ${field('空载损耗 P0', 'p0', br.p0, { type: 'number', unit: 'kW', min: 0 })}
      ${field('高压侧额定电压', 'vnH', br.vnH, { type: 'number', unit: 'kV', min: 0.1 })}
      ${field('中压侧额定电压', 'vnM', br.vnM, { type: 'number', unit: 'kV', min: 0.1 })}
      ${field('低压侧额定电压', 'vnL', br.vnL, { type: 'number', unit: 'kV', min: 0.1 })}
      ${field('高压侧分接', 'tapH', br.tapH, { type: 'number', unit: '%', min: -20, max: 20, step: 0.25 })}
      ${field('中压侧分接', 'tapM', br.tapM, { type: 'number', unit: '%', min: -20, max: 20, step: 0.25 })}
      ${field('低压侧分接', 'tapL', br.tapL, { type: 'number', unit: '%', min: -20, max: 20, step: 0.25 })}
      ${field('空载电流 I0', 'i0', br.i0, { type: 'number', unit: '%', min: 0, step: 0.01 })}
      ${field('容量(计算)', 'ratingMVA', br.ratingMVA || br.sn, { type: 'number', unit: 'MVA', min: 0.1 })}
    </div>
    <div class="derived-card">
      <div class="d-head">${icon('matrix', 10)} 星形等值阻抗（系统基准）</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">高压绕组 Uk</div><div class="d-val">${fmt(p.uH * 100, 3)}%</div></div>
        <div class="d-item"><div class="d-label">中压绕组 Uk</div><div class="d-val">${fmt(p.uM * 100, 3)}%</div></div>
        <div class="d-item"><div class="d-label">低压绕组 Uk</div><div class="d-val">${fmt(p.uL * 100, 3)}%</div></div>
        <div class="d-item"><div class="d-label">H 绕组 |Z|</div><div class="d-val accent">${fmt(Math.hypot(p.windings[0].r, p.windings[0].x), 5)} pu</div></div>
        <div class="d-item"><div class="d-label">M 绕组 |Z|</div><div class="d-val">${fmt(Math.hypot(p.windings[1].r, p.windings[1].x), 5)} pu</div></div>
        <div class="d-item"><div class="d-label">L 绕组 |Z|</div><div class="d-val">${fmt(Math.hypot(p.windings[2].r, p.windings[2].x), 5)} pu</div></div>
      </div>
    </div>
    <div class="notice-strip" style="margin-top:9px">${icon('info', 13)} 潮流按星形等值电路求解，三个绕组各接一个虚拟星点。三绕组零序通路与三侧差动保护暂不在本版本自动建模，单相接地短路计算将三绕组视为零序阻断。</div>
  </div>`;
}

function threeWindingResultInspector(rows) {
  if (!rows?.length) return '';
  return `<div class="inspector-section">
    <div class="section-title">三侧潮流结果</div>
    <div class="derived-grid" style="grid-template-columns:1fr 1fr">
      ${rows.map((r) => `<div class="d-item"><div class="d-label">${esc(r.winding || r.tag)} 绕组 · ${r.pFrom >= 0 ? '流入' : '流出'}</div><div class="d-val">${r.pFrom.toFixed(2)} MW / ${r.qFrom.toFixed(2)} Mvar</div></div>`).join('')}
      <div class="d-item"><div class="d-label">合计有功损耗</div><div class="d-val amber">${rows.reduce((s, r) => s + (r.pLoss || 0), 0).toFixed(3)} MW</div></div>
      <div class="d-item"><div class="d-label">最大绕组负载</div><div class="d-val accent">${Math.max(...rows.map((r) => r.loading || 0)).toFixed(1)}%</div></div>
    </div>
  </div>`;
}

function transformerSettings(app, br, a, b) {
  const baseFrom = a?.vn || br.vn1 || 110;
  const baseTo = b?.vn || br.vn2 || 110;
  const p = transformerParameters(br, baseFrom, baseTo, app.project.meta.baseMVA || 100);
  const z = Math.hypot(p.r, p.x);
  return `<div class="inspector-section">
    <div class="section-title">变压器参数</div>
    <div class="field-grid">
      ${field('额定容量', 'sn', br.sn, { type: 'number', unit: 'MVA', min: 0.1 })}
      ${field('短路阻抗 Uk', 'uk', br.uk, { type: 'number', unit: '%', min: 0.1, step: 0.1 })}
      ${field('高压侧电压', 'vn1', br.vn1, { type: 'number', unit: 'kV', min: 0.1 })}
      ${field('低压侧电压', 'vn2', br.vn2, { type: 'number', unit: 'kV', min: 0.1 })}
      ${field('负载损耗 Pk', 'pk', br.pk, { type: 'number', unit: 'kW', min: 0, step: 1 })}
      ${field('空载损耗 P0', 'p0', br.p0, { type: 'number', unit: 'kW', min: 0, step: 1 })}
      ${field('空载电流 I0', 'i0', br.i0, { type: 'number', unit: '%', min: 0, step: 0.01 })}
      ${field('分接位置', 'tap', br.tap, { type: 'number', unit: '%', min: -20, max: 20, step: 0.25 })}
      ${field('相角偏移', 'shift', br.shift, { type: 'number', unit: '°', step: 1 })}
      ${field('联结组别', 'vectorGroup', br.vectorGroup || 'YNd11', { select: ['YNd11', 'Yd11', 'YNyn0', 'Yyn0', 'Dyn11', 'YNd1'].map((x) => ({ value: x, label: x })) })}
      ${field('冷却方式', 'cooling', br.cooling || 'ONAF', { select: ['ONAN', 'ONAF', 'OFAF', 'ODAF'].map((x) => ({ value: x, label: x })) })}
      ${field('额定容量(计算)', 'ratingMVA', br.ratingMVA || br.sn, { type: 'number', unit: 'MVA', min: 0.1 })}
      ${field('零序通路', 'zeroMode', br.zeroMode || 'block', { select: [
        { value: 'through', label: '两侧接地 · 零序穿越' },
        { value: 'ground_from', label: '仅高压侧接地' },
        { value: 'ground_to', label: '仅低压侧接地' },
        { value: 'block', label: '零序阻断' }
      ] })}
      ${field('零序阻抗 Uk₀', 'zeroUk', br.zeroUk ?? 8.4, { type: 'number', unit: '%', min: 0.1, step: 0.1 })}
    </div>
    <div class="derived-card">
      <div class="d-head">${icon('matrix', 10)} 系统基准下的等值参数</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">电阻 R (pu)</div><div class="d-val">${fmt(p.r, 5)}</div></div>
        <div class="d-item"><div class="d-label">电抗 X (pu)</div><div class="d-val">${fmt(p.x, 5)}</div></div>
        <div class="d-item"><div class="d-label">阻抗 |Z| (pu)</div><div class="d-val accent">${fmt(z, 5)}</div></div>
        <div class="d-item"><div class="d-label">变比标幺</div><div class="d-val">${fmt(p.tapMag, 4)}</div></div>
        <div class="d-item"><div class="d-label">高压侧额定电流</div><div class="d-val">${fmt((br.sn * 1e6) / (Math.sqrt(3) * (br.vn1 || 110) * 1e3), 1)} A</div></div>
        <div class="d-item"><div class="d-label">低压侧额定电流</div><div class="d-val">${fmt((br.sn * 1e6) / (Math.sqrt(3) * (br.vn2 || 110) * 1e3), 1)} A</div></div>
      </div>
    </div>
  </div>`;
}

function switchSettings(app, br) {
  const typeLabel = { breaker: '断路器', switch: '隔离开关', disconnector: '隔离开关', loadSwitch: '负荷开关', recloser: '重合器', sectionalizer: '分段器', fuse: '熔断器' }[br.type] || '开关';
  const canBreak = ['breaker', 'recloser', 'fuse'].includes(br.type);
  const notes = {
    breaker: '断路器可开断负荷电流与短路电流；合闸时按零阻抗支路参与潮流。',
    loadSwitch: '负荷开关可开断负荷电流，不能开断短路电流；合闸时按零阻抗支路参与潮流。',
    disconnector: '隔离开关仅用于隔离，不能带负荷操作；合闸时按零阻抗支路参与潮流。',
    recloser: '重合器具备自动重合闸逻辑参数；本版本按零阻抗开关参与稳态计算，重合过程作为定值记录。',
    sectionalizer: '分段器在失压后按计数动作，本身不能开断短路电流；本版本按零阻抗开关参与稳态计算。',
    fuse: '熔断器按额定电流与开断能力记录；本版本按零阻抗支路参与潮流，熔断过程需人工设置开断。'
  };
  return `<div class="inspector-section">
    <div class="section-title">${typeLabel}参数</div>
    ${toggleRow(br.closed !== false ? '合闸位置' : '分闸位置', 'closed', br.closed !== false, 'breaker')}
    <div class="field-grid" style="margin-top:9px">
      ${field('额定电流', 'ratedCurrent', br.ratedCurrent, { type: 'number', unit: 'A', min: 0 })}
      ${canBreak ? field('开断电流', 'breakingCurrent', br.breakingCurrent, { type: 'number', unit: 'kA', min: 0 }) : ''}
      ${br.type === 'loadSwitch' ? field('负荷开断电流', 'loadBreakCurrent', br.loadBreakCurrent, { type: 'number', unit: 'A', min: 0 }) : ''}
      ${br.type === 'recloser' ? field('重合次数', 'recloseAttempts', br.recloseAttempts, { type: 'number', min: 0, max: 5 }) : ''}
      ${br.type === 'recloser' ? field('重合间隔', 'recloseTime', br.recloseTime, { type: 'number', unit: 's', min: 0, step: 0.1 }) : ''}
      ${br.type === 'sectionalizer' ? field('动作计数', 'count', br.count, { type: 'number', min: 0, max: 5 }) : ''}
    </div>
    ${br.type === 'recloser' ? toggleRow('自动重合闸', 'autoReclose', br.autoReclose !== false, 'clock') : ''}
    <div class="notice-strip" style="margin-top:9px">${icon('info', 13)} ${notes[br.type] || '合闸的开关设备按零阻抗支路处理，潮流计算时自动合并两端节点。'}</div>
  </div>`;
}

function seriesSettings(app, br) {
  const isReactor = br.type === 'seriesReactor';
  const isCap = br.type === 'seriesCap';
  const x = isReactor ? Number(br.xOhm) || 0 : isCap ? -Number(br.xcOhm) || 0 : Number(br.xNormalOhm) || 0;
  const z = Math.hypot(Number(br.rOhm) || 0, x);
  return `<div class="inspector-section">
    <div class="section-title">${isReactor ? '串联电抗器参数' : isCap ? '串联电容器参数' : '故障电流限制器参数'}</div>
    <div class="field-grid">
      ${field('电阻 R', 'rOhm', br.rOhm, { type: 'number', unit: 'Ω', min: 0, step: 0.001 })}
      ${isReactor ? field('电抗 X', 'xOhm', br.xOhm, { type: 'number', unit: 'Ω', min: 0.001, step: 0.01 }) : ''}
      ${isCap ? field('容抗 Xc', 'xcOhm', br.xcOhm, { type: 'number', unit: 'Ω', min: 0.001, step: 0.01 }) : ''}
      ${br.type === 'fcl' ? field('正常态电抗', 'xNormalOhm', br.xNormalOhm, { type: 'number', unit: 'Ω', min: 0, step: 0.001 }) : ''}
      ${br.type === 'fcl' ? field('故障态电抗', 'xFaultOhm', br.xFaultOhm, { type: 'number', unit: 'Ω', min: 0.001, step: 0.01 }) : ''}
      ${isReactor ? field('零序电抗 X₀', 'zeroXOhm', br.zeroXOhm, { type: 'number', unit: 'Ω', min: 0, step: 0.01 }) : ''}
      ${field('电压等级', 'voltageClass', br.voltageClass, { type: 'number', unit: 'kV', min: 1 })}
      ${field('额定电流', 'ratedCurrent', br.ratedCurrent, { type: 'number', unit: 'A', min: 0 })}
      ${field('热稳定容量', 'ratingMVA', br.ratingMVA, { type: 'number', unit: 'MVA', min: 0.1 })}
    </div>
    <div class="derived-card">
      <div class="d-head">${icon('matrix', 10)} 限流效果</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">等值阻抗 |Z|</div><div class="d-val accent">${z.toFixed(4)} Ω</div></div>
        <div class="d-item"><div class="d-label">额定电流下压降</div><div class="d-val">${(z * (Number(br.ratedCurrent) || 0) / (Math.sqrt(3) * (Number(br.voltageClass) || 110) * 1000) * 100).toFixed(2)}%</div></div>
        <div class="d-item"><div class="d-label">${isCap ? '补偿方式' : '限流方式'}</div><div class="d-val">${isCap ? '串联容性补偿' : br.type === 'fcl' ? '故障态高阻抗' : '串联电抗限流'}</div></div>
      </div>
    </div>
    <div class="notice-strip" style="margin-top:9px">${icon('info', 13)} ${isReactor ? '串联电抗器正常与故障态阻抗相同，用于限制母线短路电流和并联支路涌流。' : isCap ? '串联电容器以负电抗参与潮流，可补偿线路电抗；短路计算中按容抗等值。' : '故障电流限制器在正常潮流中使用正常态电抗，在短路计算中使用故障态高电抗。'}</div>
  </div>`;
}

function resultInspector(result, br) {
  if (!result) return '';
  return `<div class="inspector-section">
    <div class="section-title">潮流结果</div>
    <div class="derived-grid">
      <div class="d-item"><div class="d-label">首端有功</div><div class="d-val">${result.pFrom.toFixed(2)} MW</div></div>
      <div class="d-item"><div class="d-label">首端无功</div><div class="d-val">${result.qFrom.toFixed(2)} Mvar</div></div>
      <div class="d-item"><div class="d-label">末端有功</div><div class="d-val">${result.pTo.toFixed(2)} MW</div></div>
      <div class="d-item"><div class="d-label">有功损耗</div><div class="d-val amber">${result.pLoss.toFixed(3)} MW</div></div>
      <div class="d-item"><div class="d-label">最大电流</div><div class="d-val">${result.current.toFixed(3)} kA</div></div>
      <div class="d-item"><div class="d-label">负载率</div><div class="d-val ${result.loading > 100 ? 'red' : result.loading > 80 ? 'amber' : 'accent'}">${result.loading.toFixed(1)}%</div></div>
    </div>
  </div>`;
}

function injectionInspector(app, inj) {
  const bus = app.project.buses.find((b) => b.id === inj.bus);
  const result = inj.type === 'generator' ? app.results?.generatorResults?.find((g) => g.id === inj.id) : null;
  const color = inj.type === 'generator' ? '#ffc46e' : inj.type === 'load' ? '#ff7d8c' : '#b79bff';
  const iconName = inj.type === 'generator' ? 'generator' : inj.type === 'load' ? 'load' : inj.kind === 'reactor' ? 'reactor' : 'capacitor';
  let settings = '';
  if (inj.type === 'generator') settings = generatorSettings(app, inj, bus, result);
  else if (inj.type === 'load') settings = loadSettings(app, inj);
  else settings = shuntSettings(app, inj);
  return `
    <div class="inspector-head">
      <div class="inspector-icon" style="color:${color};background:${color}14;border-color:${color}30">${icon(iconName, 20)}</div>
      <div class="inspector-head-copy">
        <div class="inspector-kicker">${inj.type === 'generator' ? 'SOURCE / 电源' : inj.type === 'load' ? 'DEMAND / 负荷' : 'SHUNT / 补偿'}</div>
        <div class="inspector-title">${esc(inj.tag)} · ${esc(inj.name)}</div>
      </div>
      <div class="inspector-head-actions">
        <button class="icon-btn" data-action="duplicate" title="复制设备">${icon('copy', 14)}</button>
        <button class="icon-btn" data-action="delete" title="删除设备">${icon('trash', 14)}</button>
      </div>
    </div>
    <div class="chip-row">
      ${chip(bus ? bus.tag : '未连接', bus ? 'ok' : 'error', !!bus)}
      ${chip(inj.type === 'generator' ? inj.kind || '发电机' : inj.type === 'load' ? inj.loadType || '负荷' : inj.kind === 'reactor' ? '电抗器' : '电容器', 'purple')}
      ${result?.q != null ? chip(`Q = ${result.q.toFixed(1)} Mvar`, result.q > (inj.qMax || 0) || result.q < (inj.qMin || 0) ? 'warn' : '') : ''}
    </div>
    <div class="inspector-section">
      <div class="section-title">接入与状态</div>
      <div class="field-grid">
        ${field('设备名称', 'name', inj.name, { full: true })}
        ${field('设备编号', 'tag', inj.tag)}
        ${field('接入母线', 'bus', inj.bus, { select: app.project.buses.map((x) => ({ value: x.id, label: `${x.tag} · ${x.name}` })), rerender: true })}
        ${field('运行状态', 'status', inj.status, { select: [{ value: 'in', label: '投入运行' }, { value: 'out', label: '退出运行' }] })}
      </div>
      <div class="field-grid" style="margin-top:9px">
        ${field('母线位置', 'pos', Math.round((inj.pos ?? 0.5) * 100), { type: 'number', unit: '%', min: 4, max: 96, hint: '沿母线长度方向的位置。' })}
        ${field('图形方向', 'direction', inj.direction || 'up', { select: [{ value: 'up', label: '向上' }, { value: 'down', label: '向下' }] })}
      </div>
    </div>
    ${settings}
    ${result ? `<div class="inspector-section"><div class="section-title">潮流结果</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">有功出力</div><div class="d-val accent">${result.p.toFixed(2)} MW</div></div>
        <div class="d-item"><div class="d-label">无功出力</div><div class="d-val">${result.q == null ? '—' : `${result.q.toFixed(2)} Mvar`}</div></div>
        <div class="d-item"><div class="d-label">容量</div><div class="d-val">${result.ratedMVA} MVA</div></div>
        <div class="d-item"><div class="d-label">功率因数</div><div class="d-val">${result.q != null && Math.abs(result.p) + Math.abs(result.q) > 1e-6 ? (Math.abs(result.p) / Math.hypot(result.p, result.q)).toFixed(3) : '—'}</div></div>
      </div>
    </div>` : ''}
    <div class="inspector-section">
      <div class="section-title">备注</div>
      <textarea data-field="note" style="width:100%;height:52px;border:1px solid var(--line);border-radius:6px;background:#091421;padding:7px;color:var(--text-soft);font-size:10px;outline:none" placeholder="记录设备运行说明">${esc(inj.note || '')}</textarea>
    </div>
    <div class="inspector-actions">
      <button class="btn" data-action="duplicate">${icon('copy', 13)} 复制设备</button>
      <button class="btn btn-danger" data-action="delete">${icon('trash', 13)} 删除设备</button>
    </div>`;
}

function generatorSettings(app, inj, bus, result) {
  const q = result?.q;
  const qWarn = q != null && ((inj.qMax != null && q > inj.qMax + 1e-3) || (inj.qMin != null && q < inj.qMin - 1e-3));
  return `<div class="inspector-section">
    <div class="section-title">发电机参数</div>
    <div class="field-grid">
      ${field('有功出力', 'p', inj.p, { type: 'number', unit: 'MW' })}
      ${field('无功出力', 'q', inj.q, { type: 'number', unit: 'Mvar', hint: bus?.type === 'PQ' ? 'PQ 节点下的固定无功。' : 'PV / Slack 节点由计算确定。' })}
      ${field('无功下限', 'qMin', inj.qMin, { type: 'number', unit: 'Mvar' })}
      ${field('无功上限', 'qMax', inj.qMax, { type: 'number', unit: 'Mvar' })}
      ${field('额定容量', 'ratedMVA', inj.ratedMVA, { type: 'number', unit: 'MVA', min: 0.1 })}
      ${field('电源类型', 'kind', inj.kind, { select: ['火电', '水电', '燃气', '核电', '风电', '光伏', '储能'].map((x) => ({ value: x, label: x })) })}
      ${field('惯性时间常数', 'inertia', inj.inertia, { type: 'number', unit: 's', min: 0, step: 0.1 })}
      ${field('调差率', 'droop', inj.droop ?? 5, { type: 'number', unit: '%', min: 0, step: 0.5 })}
      ${field('有功下限', 'pMin', inj.pMin ?? 0, { type: 'number', unit: 'MW' })}
      ${field('有功上限', 'pMax', inj.pMax ?? inj.ratedMVA, { type: 'number', unit: 'MW' })}
      ${field('暂态电抗 x′d', 'xd', inj.xd ?? 0.25, { type: 'number', unit: 'pu', min: 0.01, step: 0.01 })}
      ${field('零序接地电抗 xg0', 'xg0', inj.xg0 ?? 0.05, { type: 'number', unit: 'pu', min: 0, step: 0.01 })}
      ${field('成本常数 a', 'costA', inj.costA ?? 0, { type: 'number', unit: '元/h' })}
      ${field('成本系数 b', 'costB', inj.costB ?? 300, { type: 'number', unit: '元/MWh' })}
    </div>
    <div class="switch-row" style="margin-top:9px">
      <span class="switch-label">${icon('breaker', 13)} 发电机出口开关</span>
      <button class="toggle ${inj.switchClosed !== false ? 'on' : ''}" data-action="toggle-field" data-field="switchClosed"></button>
    </div>
    <div class="switch-row compact" style="margin-top:6px">
      <span class="switch-label">${icon('sliders', 13)} 一次调频 / 调速器</span>
      <button class="toggle ${inj.governor !== false ? 'on' : ''}" data-action="toggle-field" data-field="governor"></button>
    </div>
    <div class="switch-row compact" style="margin-top:6px">
      <span class="switch-label">${icon('bolt', 13)} 中性点接地（零序）</span>
      <button class="toggle ${inj.grounded !== false ? 'on' : ''}" data-action="toggle-field" data-field="grounded"></button>
    </div>
    ${qWarn ? `<div class="issue-item warning" style="margin-top:8px">${icon('warning', 12)} 计算无功 ${q.toFixed(1)} Mvar 超出设定限值，建议校核电压或调整容量。</div>` : ''}
    <div class="notice-strip" style="margin-top:9px">${icon('info', 13)} ${bus?.type === 'slack' ? '平衡节点发电机承担系统功率平衡，有功与无功由潮流决定。' : bus?.type === 'PV' ? 'PV 节点发电机维持母线电压，无功由潮流计算确定。' : 'PQ 节点发电机按固定 P/Q 注入，若需调压请将母线设为 PV。'}</div>
  </div>`;
}

function loadSettings(app, inj) {
  const pf = Math.abs(inj.p) + Math.abs(inj.q) > 0 ? Math.abs(inj.p) / Math.hypot(inj.p, inj.q) : 0;
  return `<div class="inspector-section">
    <div class="section-title">负荷参数</div>
    <div class="field-grid">
      ${field('有功负荷', 'p', inj.p, { type: 'number', unit: 'MW', min: 0 })}
      ${field('无功负荷', 'q', inj.q, { type: 'number', unit: 'Mvar', min: 0 })}
      ${field('负荷类型', 'loadType', inj.loadType, { select: ['工业', '商业', '居民', '农业', '站用', '数据中心', '其他'].map((x) => ({ value: x, label: x })) })}
      ${field('功率因数', 'pf_display', pf.toFixed(3), { type: 'text', hint: '由 P/Q 自动计算' })}
      ${field('电动机次暂态电抗', 'motorX', inj.motorX ?? 0.2, { type: 'number', unit: 'pu', min: 0.05, step: 0.01 })}
    </div>
    <div class="switch-row compact" style="margin-top:6px">
      <span class="switch-label">${icon('bolt', 13)} 短路时计入电动机反馈</span>
      <button class="toggle ${inj.motor ? 'on' : ''}" data-action="toggle-field" data-field="motor"></button>
    </div>
    <div class="derived-card">
      <div class="d-head">${icon('info', 10)} 负荷等值</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">视在功率</div><div class="d-val">${Math.hypot(inj.p, inj.q).toFixed(2)} MVA</div></div>
        <div class="d-item"><div class="d-label">功率因数角</div><div class="d-val">${pf > 0 ? (Math.acos(Math.min(1, pf)) * 180 / Math.PI).toFixed(1) : '—'}°</div></div>
        <div class="d-item"><div class="d-label">电动机反馈</div><div class="d-val ${inj.motor ? 'accent' : ''}">${inj.motor ? '计入' : '不计入'}</div></div>
      </div>
    </div>
  </div>`;
}

function shuntSettings(app, inj) {
  return `<div class="inspector-section">
    <div class="section-title">补偿装置参数</div>
    <div class="segmented" style="margin-bottom:10px;grid-auto-flow:row;grid-template-columns:1fr 1fr">
      <button class="${inj.kind !== 'reactor' && inj.kind !== 'filter' && inj.kind !== 'svc' && inj.kind !== 'statcom' ? 'active' : ''}" data-action="set-shunt-kind" data-kind="capacitor">并联电容器</button>
      <button class="${inj.kind === 'reactor' ? 'active' : ''}" data-action="set-shunt-kind" data-kind="reactor">并联电抗器</button>
      <button class="${inj.kind === 'filter' ? 'active' : ''}" data-action="set-shunt-kind" data-kind="filter">滤波器</button>
      <button class="${inj.kind === 'svc' ? 'active' : ''}" data-action="set-shunt-kind" data-kind="svc">SVC</button>
      <button class="${inj.kind === 'statcom' ? 'active' : ''}" data-action="set-shunt-kind" data-kind="statcom">STATCOM</button>
    </div>
    <div class="field-grid">
      ${field('额定容量', 'q', inj.q, { type: 'number', unit: 'Mvar', hint: '容性为正，感性为负。' })}
      ${field('额定电压', 'ratedKV', inj.ratedKV, { type: 'number', unit: 'kV', min: 0.1 })}
    </div>
    <div class="derived-card">
      <div class="d-head">${icon('info', 10)} 补偿效果</div>
      <div class="derived-grid">
        <div class="d-item"><div class="d-label">额定注入无功</div><div class="d-val ${inj.q >= 0 ? 'accent' : 'amber'}">${inj.q >= 0 ? '+' : ''}${inj.q} Mvar</div></div>
        <div class="d-item"><div class="d-label">等值电纳</div><div class="d-val">${(inj.q / (inj.ratedKV * inj.ratedKV) * 1000).toFixed(3)} mS</div></div>
      </div>
    </div>
    ${['svc', 'statcom', 'filter'].includes(inj.kind) ? `<div class="notice-strip" style="margin-top:9px">${icon('info', 13)} ${inj.kind === 'filter' ? '滤波器按静态容性无功等值，谐波阻抗与调谐频率作为后续扩展字段。' : 'SVC / STATCOM 按静态无功等值参与潮流；正值为发出无功，负值为吸收无功，暂不模拟动态电压闭环。'}</div>` : ''}
  </div>`;
}

export function bindInspector(root, app) {
  if (!root || root.dataset.bound) return;
  root.dataset.bound = '1';

  const setFieldValue = (el, value) => {
    const target = targetFor(app);
    if (!target) return;
    const name = el.dataset.field;
    if (!name) return;
    if (targetIsMeta(app)) {
      // Project fields belong to meta; "pos" and similar never appear here.
      if (name === 'pf_display') return;
      target[name] = value;
      if (name === 'sourceMVA') app.scOptions.sourceMVA = Number(value) || app.scOptions.sourceMVA;
      return;
    }
    if (name === 'pf_display') return;
    if (name === 'pos') target.pos = Math.max(0.04, Math.min(0.96, Number(value) / 100));
    else target[name] = value;
  };
  const parseValue = (el) => {
    if (el.type === 'number' || el.tagName === 'INPUT' && el.type === 'range') return el.value === '' ? 0 : Number(el.value);
    return el.value;
  };
  const isElectrical = (el) => ELECTRICAL_FIELDS.has(el.dataset.field);
  const updateOutputs = (el) => {
    if (el.type !== 'range') return;
    const fieldName = el.dataset.field;
    const out = root.querySelector(`[data-output-for="${fieldName}"]`);
    if (out) out.textContent = fieldName === 'pos' ? `${Math.round(el.value)}%` : el.value;
  };

  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    let value = parseValue(el);
    if (el.dataset.field === 'pos') value = value; // handled in setter
    setFieldValue(el, value);
    updateOutputs(el);
    app.scheduleDiagramRender();
    app.scheduleSave();
    if (el.dataset.rerender) return;
  });

  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    const field = el.dataset.field;
    let value = parseValue(el);
    if (field === 'pos') value = value;
    setFieldValue(el, value);
    if (isElectrical(el)) app.invalidateResults();
    else if (SC_ONLY_FIELDS.has(field)) app.invalidateShortCircuitResults?.();
    else if (STABILITY_ONLY_FIELDS.has(field)) app.invalidateStabilityResults?.();
    if (field === 'scRating') app.scanShortCircuitResult = null;
    app.commit(`修改${field}`);
    if (['name', 'tag'].includes(field)) app.syncResultLabels();
    app.refreshValidation();
    app.refreshShellStats();
    app.renderDiagram();
    if (el.dataset.rerender || el.tagName === 'SELECT') app.renderInspector();
    else if (['name', 'tag', 'vn', 'type'].includes(field)) app.renderInspector();
    app.scheduleSave();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'delete') { app.deleteSelection(); return; }
    if (action === 'duplicate') { app.editor?.duplicateSelected(); return; }
    if (action === 'project-settings') { app.openProjectSettings(); return; }
    if (action === 'run-flow') { app.runAnalysis(); return; }
    if (action === 'open-matrices') { app.openMatricesForCurrent(); return; }
    if (action === 'shortcuts') { app.openShortcuts(); return; }
    if (action === 'open-protection-branch') {
      const br = targetFor(app);
      app.setMode('protection');
      if (br) app.selectProtectionBranch(br.id);
      return;
    }
    if (action === 'set-param-mode') {
      const br = targetFor(app);
      if (!br) return;
      const nextMode = btn.dataset.mode;
      if (nextMode === br.paramMode) return;
      const current = lineParameters(br);
      let detail = '';
      if (nextMode === 'lumped') {
        // Preserve the physical total R/X/B when moving from distributed to lumped.
        br.R = Number((current.rawR ?? current.R).toFixed(6));
        br.X = Number((current.rawX ?? current.X).toFixed(6));
        br.B = Number((current.rawB ?? current.B).toFixed(6));
        detail = `已保留总参数 R=${br.R} Ω、X=${br.X} Ω、B=${br.B} µS。`;
      } else {
        const L = Number(br.length) > 0 ? Number(br.length) : 30;
        br.length = L;
        br.rPerKm = Number(((Number(br.R) || 0) / L).toFixed(6));
        br.xPerKm = Number(((Number(br.X) || 0) / L).toFixed(6));
        br.bPerKm = Number(((Number(br.B) || 0) / L).toFixed(6));
        detail = `已按长度 ${L} km 折算为每公里参数。`;
      }
      br.paramMode = nextMode;
      app.invalidateResults();
      app.commit('切换线路模型');
      app.refreshAll();
      app.toast('线路模型已切换', `${br.paramMode === 'distributed' ? '采用分布参数长线等效 π 模型。' : '采用集中参数 π 模型。'}${detail}`);
      return;
    }
    if (action === 'set-shunt-kind') {
      const inj = targetFor(app);
      if (!inj) return;
      inj.kind = btn.dataset.kind;
      if (inj.kind === 'reactor') inj.q = -Math.abs(Number(inj.q) || 0);
      else if (inj.kind === 'capacitor' || inj.kind === 'filter') inj.q = Math.abs(Number(inj.q) || 0);
      app.invalidateResults();
      app.commit('修改补偿类型');
      app.refreshAll();
      return;
    }
    if (action === 'toggle-field') {
      const target = targetFor(app);
      const field = btn.dataset.field;
      if (!target || !field) return;
      target[field] = !target[field];
      if (SC_ONLY_FIELDS.has(field)) app.invalidateShortCircuitResults?.();
      else if (STABILITY_ONLY_FIELDS.has(field)) app.invalidateStabilityResults?.();
      else app.invalidateResults();
      app.commit('切换状态');
      app.refreshAll();
      app.scheduleSave();
    }
  });
}
