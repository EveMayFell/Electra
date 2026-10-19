import { icon } from './icons.js';
import { relayCurveChart } from './charts.js';
import {
  protectionIssues, coordinationChecks, relayTripTimeSeconds, relaySecondaryOhms,
  lineZPrimary, OC_CURVES, CURVES
} from '../engine/protection.js';
import { evaluateRelayProtections, evaluationSummary } from '../engine/protectionFunctions.js';
import { PROTECTION_COUNT, protectionsFor, protectionById, protectionDefaults } from '../data/protectionCatalog.js';
import { syncRelayLegacyFunctions } from '../model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
const levelIcon = (level) => level === 'error' ? 'x' : level === 'warning' ? 'warning' : level === 'ok' ? 'check' : 'info';
const GROUP_ORDER = ['主保护', '后备保护', '异常运行', '非电量', '辅助与监视'];

function elementOf(app, relay) {
  if (!relay) return { branch: null, bus: null, category: 'line' };
  if (relay.targetType === 'bus') {
    return { branch: null, bus: app.project.buses.find((b) => b.id === relay.busId), category: 'bus' };
  }
  const branch = app.project.branches.find((b) => b.id === relay.branchId);
  return { branch, bus: null, category: branch?.type === 'transformer' ? 'transformer' : 'line' };
}

function relayType(relay, branch, bus) {
  if (relay?.targetType === 'bus') return '母线保护';
  if (!branch) return '未知';
  return branch.type === 'transformer' ? '变压器保护' : '线路保护';
}

function categoryLabel(category) {
  return category === 'bus' ? '母线' : category === 'transformer' ? '变压器' : '线路';
}

function enabledCount(relay) {
  return Object.values(relay?.protections || {}).filter((x) => x.enabled !== false).length;
}

function functionGroups(relay, category, app) {
  const entries = protectionsFor(category);
  const selectedId = app.protectionFunctionId;
  return GROUP_ORDER.map((group) => {
    const rows = entries.filter((x) => x.group === group);
    if (!rows.length) return '';
    return `<div class="protection-fn-group">
      <div class="protection-fn-group-title">${group}<span>${rows.filter((x) => relay.protections?.[x.id]?.enabled !== false).length}/${rows.length}</span></div>
      <div class="protection-fn-grid">
        ${rows.map((entry) => {
          const inst = relay.protections?.[entry.id];
          const on = inst?.enabled !== false;
          return `<button class="protection-fn ${on ? 'on' : 'off'} ${selectedId === entry.id ? 'active' : ''}" data-protection-select="${entry.id}" title="${esc(entry.description)}">
            <span class="protection-fn-dot"></span>
            <span class="protection-fn-code">${esc(entry.code)}</span>
            <span class="protection-fn-name">${esc(entry.name)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function functionLibraryCard(app, relay, category, evalRows) {
  const applicable = protectionsFor(category);
  const enabled = applicable.filter((x) => relay.protections?.[x.id]?.enabled !== false).length;
  return `<div class="card protection-card">
    <div class="card-head">
      <div><div class="card-title">${icon('shield', 15)} 保护功能库 <span class="card-sub" style="display:inline;margin-left:6px">${categoryLabel(category)} · ${applicable.length} 种可用</span></div><div class="card-sub">点击功能查看定值；圆点为投入状态，全库 ${PROTECTION_COUNT} 种</div></div>
      <div style="display:flex;gap:6px;align-items:center"><span class="status-pill neutral">${enabled}/${applicable.length} 投入</span><button class="btn btn-sm" data-action="protection-library">${icon('database', 12)} 查看全库</button></div>
    </div>
    ${functionGroups(relay, category, app)}
  </div>`;
}

function functionDetailCard(app, relay, category, evalRows) {
  const applicable = protectionsFor(category);
  let entry = protectionById(app.protectionFunctionId);
  if (!entry || entry.category !== category) {
    entry = applicable.find((x) => relay.protections?.[x.id]?.enabled !== false && !x.core) || applicable.find((x) => !x.core) || applicable[0];
  }
  if (!entry) return '';
  const inst = relay.protections?.[entry.id] || { enabled: false, settings: {} };
  const on = inst.enabled !== false;
  const row = evalRows.find((x) => x.id === entry.id);
  if (entry.core) {
    return `<div class="card protection-card">
      <div class="function-header"><div class="function-title">${icon('shield', 15)} ${esc(entry.name)} <span class="sub">${esc(entry.description)}</span></div><span class="status-pill ${on ? 'ok' : 'neutral'}">${on ? '投入' : '退出'}</span></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="toggle ${on ? 'on' : ''}" data-protection-enable title="投退该功能"></button></div>
      <div class="method-note">${icon('info', 12)} 该功能属于核心定值，请在上方对应的距离 / 差动 / 过流卡片中修改；投退开关会同步核心功能状态。</div>
    </div>`;
  }
  const fields = (entry.settings || []).map((field) => {
    const value = inst.settings?.[field.key] ?? field.value;
    return `<div class="setting-field"><label>${esc(field.label)} ${field.unit ? `<span class="unit">${esc(field.unit)}</span>` : ''}</label><input type="number" data-protection-field="${esc(field.key)}" value="${value}" ${field.min != null ? `min="${field.min}"` : ''} ${field.max != null ? `max="${field.max}"` : ''} ${field.step != null ? `step="${field.step}"` : ''}></div>`;
  }).join('');
  return `<div class="card protection-card protection-fn-detail">
    <div class="card-head">
      <div><div class="card-title">${icon('sliders', 15)} ${esc(entry.code)} · ${esc(entry.name)}</div><div class="card-sub">${esc(entry.description)}</div></div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="status-pill ${row?.status === 'ok' ? 'ok' : row?.status === 'warn' ? 'warn' : row?.status === 'error' ? 'bad' : 'neutral'}">${row?.status === 'ok' ? '定值通过' : row?.status === 'warn' ? '需关注' : row?.status === 'error' ? '异常' : '退出'}</span>
        <button class="toggle ${on ? 'on' : ''}" data-protection-enable title="投退该功能"></button>
      </div>
    </div>
    <div class="settings-grid">${fields || '<div class="method-note">该功能为状态/辅助保护，无需数值定值。</div>'}</div>
    ${row?.message ? `<div class="method-note" style="margin-top:8px">${icon('info', 11)} ${esc(row.message)}${row.setting ? ` · 当前定值 ${esc(row.setting)}` : ''}</div>` : ''}
    <div class="inspector-actions" style="margin-top:9px;grid-template-columns:1fr 1fr">
      <button class="btn btn-sm" data-action="protection-recommend">${icon('sparkles', 12)} 恢复本功能推荐值</button>
      <button class="btn btn-sm" data-action="protection-library">${icon('database', 12)} 保护全库</button>
    </div>
  </div>`;
}

function busStatusCard(app, bus, relay, evalSum, faultCurrentA) {
  const br = app.results?.busResults?.find((b) => b.busId === bus.id);
  return `<div class="card curve-card">
    <div class="card-head" style="padding:0 0 9px"><div><div class="card-title">${icon('bus', 14)} 母线运行状态</div><div class="card-sub">${esc(bus.tag)} · ${esc(bus.name)}</div></div><span class="status-pill neutral">${bus.vn} kV</span></div>
    <div class="derived-grid">
      <div class="d-item"><div class="d-label">母线电压</div><div class="d-val accent">${f(br?.Vm, 4)} <small>pu</small></div></div>
      <div class="d-item"><div class="d-label">短路电流</div><div class="d-val">${f(faultCurrentA / 1000, 2)} <small>kA</small></div></div>
      <div class="d-item"><div class="d-label">保护功能</div><div class="d-val">${evalSum.enabled} / ${evalSum.total}</div></div>
      <div class="d-item"><div class="d-label">异常 / 关注</div><div class="d-val ${evalSum.error ? 'red' : evalSum.warn ? 'amber' : 'green'}">${evalSum.error} / ${evalSum.warn}</div></div>
    </div>
    <div class="curve-caption" style="margin-top:10px"><span>CT ${relay.ct.primary}/${relay.ct.secondary}</span><span>PT ${relay.vt.primary}/${relay.vt.secondary} kV</span></div>
    <div class="method-note" style="margin-top:9px">${icon('info', 11)} 母线保护按母差、失灵、死区、充电、PT/CT 断线、绝缘、弧光、低频/过频、备自投与联锁等 ${evalSum.total} 项功能配置。</div>
  </div>`;
}

export function renderProtection(app) {
  const relays = app.project.relays;
  const filter = app.protectionFilter || 'all';
  const visible = relays.filter((r) => {
    if (filter === 'bus') return r.targetType === 'bus';
    if (r.targetType === 'bus') return filter === 'all';
    const br = app.project.branches.find((b) => b.id === r.branchId);
    if (!br) return false;
    if (filter === 'line') return br.type === 'line';
    if (filter === 'transformer') return br.type === 'transformer';
    return true;
  });
  if (!relays.length) {
    return `<div class="page-shell"><div class="page-scroll"><div class="empty-state" style="margin-top:90px"><div class="es-icon">${icon('shield', 32)}</div><h2>尚未配置继电保护</h2><p>为线路、变压器或母线添加保护后，可进行手动整定或一键自动整定。</p><button class="btn btn-primary" data-action="protection-add-all">${icon('sparkles', 14)} 自动生成保护配置</button></div></div></div>`;
  }
  let selected = relays.find((r) => r.id === app.protectionSelectedId);
  if (!selected || !visible.includes(selected)) selected = visible[0] || relays[0];
  const { branch, bus, category } = elementOf(app, selected);
  const result = app.results;
  const summary = app.protectionSummary;
  const faultCurrentA = branch
    ? (Number(app.protectionFaultCurrent) || Math.max(1000, Number(selected?.overcurrent?.pickup) * 4 || 4000))
    : (app.shortCircuit?.busId === bus?.id ? app.shortCircuit.Ik * 1000 : (Number(bus?.scRating) || 31.5) * 1000 * 0.5);
  const evalRows = selected ? evaluateRelayProtections(app.project, selected, result, { faultCurrentA }) : [];
  const evalSum = evaluationSummary(evalRows);
  const issues = selected ? protectionIssues(app.project, selected, result) : [];
  const coord = branch ? coordinationChecks(app.project, result) : [];
  const tripTime = branch ? relayTripTimeSeconds(selected, faultCurrentA) : Infinity;
  const sensitivity = branch && selected?.overcurrent?.pickup > 0 ? faultCurrentA / selected.overcurrent.pickup : null;
  if (branch && selected?.functions?.overcurrent && sensitivity != null) {
    const okIndex = issues.findIndex((i) => i.level === 'ok' && i.msg.includes('通过规则校验'));
    if (okIndex >= 0) issues.splice(okIndex, 1);
    if (sensitivity < 1.0) issues.push({ level: 'error', msg: `校验电流低于过流启动值，保护不动作（Ksen = ${f(sensitivity, 2)}）。` });
    else if (sensitivity < 1.3) issues.push({ level: 'warning', msg: `过流保护灵敏系数 Ksen = ${f(sensitivity, 2)}，低于 1.30。` });
    else if (sensitivity < 1.5) issues.push({ level: 'info', msg: `过流保护灵敏系数 Ksen = ${f(sensitivity, 2)}，处于临界区间。` });
    else issues.push({ level: 'ok', msg: `过流保护灵敏系数 Ksen = ${f(sensitivity, 2)}，满足要求。` });
  }
  if (!app.protectionFunctionId || !protectionsFor(category).some((x) => x.id === app.protectionFunctionId)) {
    app.protectionFunctionId = protectionsFor(category).find((x) => !x.core)?.id || protectionsFor(category)[0]?.id;
  }

  const left = `<aside class="relay-side">
    <div class="relay-side-head"><div class="side-label" style="margin:0">保护装置</div><span class="count-badge">${relays.filter((r) => r.enabled).length}/${relays.length}</span></div>
    <div class="relay-filter">
      <button class="${filter === 'all' ? 'active' : ''}" data-relay-filter="all">全部</button>
      <button class="${filter === 'line' ? 'active' : ''}" data-relay-filter="line">线路</button>
      <button class="${filter === 'transformer' ? 'active' : ''}" data-relay-filter="transformer">变压器</button>
      <button class="${filter === 'bus' ? 'active' : ''}" data-relay-filter="bus">母线</button>
    </div>
    <div class="relay-list">
      ${visible.map((r) => {
        const { branch: br, bus: bs } = elementOf(app, r);
        const iss = summary?.perRelay?.[r.id] || [];
        const bad = iss.some((x) => x.level === 'error') ? 'warn' : r.enabled ? '' : 'off';
        const tag = r.targetType === 'bus' ? bs?.tag : br?.tag;
        const ico = r.targetType === 'bus' ? 'bus' : br?.type === 'transformer' ? 'transformer' : 'shield';
        return `<button class="relay-item ${selected?.id === r.id ? 'active' : ''}" data-relay-select="${r.id}">
          <span class="relay-status-dot ${bad}"></span>
          <span class="relay-type-icon">${icon(ico, 13)}</span>
          <span class="relay-item-body">
            <span class="relay-item-top"><span class="relay-item-name">${esc(r.name)}</span><span class="relay-item-type">${esc(tag || '—')}</span></span>
            <span class="relay-item-meta"><span>CT ${r.ct.primary}/${r.ct.secondary}</span><span>${enabledCount(r)} 项功能</span></span>
          </span>
        </button>`;
      }).join('')}
    </div>
    <div class="side-note" style="margin-top:13px">保护定值与 ${PROTECTION_COUNT} 种功能配置保存在工程文件中。线路、变压器和母线保护使用同一套功能库与校验框架。</div>
  </aside>`;

  const hero = `<div class="relay-hero">
    <div class="rh-icon">${icon(bus ? 'bus' : branch?.type === 'transformer' ? 'transformer' : 'shield', 20)}</div>
    <div class="rh-copy"><h2>${esc(selected.name)}</h2><div class="rh-sub">${esc(relayType(selected, branch, bus))} · ${esc(bus?.tag || branch?.tag || '—')} · ${esc(bus?.name || branch?.name || '')} · ${selected.mode === 'auto' ? '自动整定' : '手动整定'}</div></div>
    <div class="rh-status">
      ${selected.enabled ? '<span class="status-pill ok">投入</span>' : '<span class="status-pill bad">退出</span>'}
      <button class="toggle ${selected.enabled ? 'on' : ''}" data-relay-enable title="投退保护"></button>
    </div>
  </div>`;

  const relayDetail = `<div class="card protection-card">
      <div class="settings-grid two">
        <div class="setting-field"><label>CT 一次电流 <span class="unit">A</span></label><input type="number" data-relay-field="ct.primary" value="${selected.ct.primary}"></div>
        <div class="setting-field"><label>CT 二次电流 <span class="unit">A</span></label><input type="number" data-relay-field="ct.secondary" value="${selected.ct.secondary}"></div>
        <div class="setting-field"><label>PT 一次电压 <span class="unit">kV</span></label><input type="number" data-relay-field="vt.primary" value="${selected.vt.primary}"></div>
        <div class="setting-field"><label>PT 二次电压 <span class="unit">kV</span></label><input type="number" data-relay-field="vt.secondary" value="${selected.vt.secondary}"></div>
        <div class="settings-foot">${icon('info', 10)} CT/PT 变比用于将一次定值折算至保护装置二次侧。已投入 ${evalSum.enabled}/${evalSum.total} 项保护功能，${evalSum.warn} 项关注、${evalSum.error} 项异常。</div>
      </div>
    </div>
    ${branch && selected.functions?.distance && branch.type === 'line' ? distanceCard(app, selected, branch) : ''}
    ${branch && selected.functions?.differential && branch.type === 'transformer' ? differentialCard(selected) : ''}
    ${branch && selected.functions?.overcurrent ? overcurrentCard(selected, faultCurrentA, tripTime) : ''}
    ${branch && branch.type === 'line' ? recloseCard(selected) : ''}
    ${functionLibraryCard(app, selected, category, evalRows)}
    ${functionDetailCard(app, selected, category, evalRows)}
    <div class="inspector-actions" style="margin-top:12px;grid-template-columns:${branch ? '1fr 1fr 1fr' : '1fr 1fr'}">
      ${branch ? `<button class="btn" data-action="protection-auto-selected">${icon('sparkles', 13)} 自动整定本套</button>` : ''}
      <button class="btn" data-action="protection-reset-selected">${icon('undo', 13)} 恢复推荐值</button>
      <button class="btn" data-action="protection-open-branch">${icon('target', 13)} 在画布中定位</button>
    </div>
    <div class="method-note" style="margin-top:10px">${icon('info', 12)} 核心保护（距离/差动/过流）使用专用整定卡片；扩展保护使用功能库统一配置。修改任一功能或定值即切换为手动模式。母线保护不设置过流反时限曲线，按母差、失灵与辅助功能评估。</div>`;

  const right = branch ? `<aside class="protection-right">
    <div class="side-label">动作特性</div>
    <div class="card curve-card">
      <div class="card-head" style="padding:0 0 9px"><div><div class="card-title">${icon('wave', 14)} 过流反时限曲线</div><div class="card-sub">${esc(selected.name)}</div></div><span class="status-pill ${Number.isFinite(tripTime) ? 'ok' : 'neutral'}">${Number.isFinite(tripTime) ? `${f(tripTime, 2)} s` : '不动作'}</span></div>
      ${relayCurveChart(selected, { faultCurrentA })}
      <div class="curve-caption"><span>故障电流 ${(faultCurrentA / 1000).toFixed(2)} kA</span><span>${selected?.overcurrent?.curve ? CURVES[selected.overcurrent.curve]?.label : ''}</span></div>
      <div style="display:flex;gap:6px;margin-top:7px">
        <input class="mini-input" style="width:100%;text-align:left;flex:1" type="number" data-protection-current value="${Math.round(faultCurrentA)}" title="保护校验电流（一次侧 A）">
        <button class="btn btn-sm" data-action="protection-use-sc" ${app.shortCircuit ? '' : 'disabled'}>${icon('bolt', 12)} 用短路结果</button>
      </div>
      <div class="hint" style="font-size:8px;color:var(--dim);margin-top:4px">校验电流（A，一次侧）。可用短路计算页结果一键带入。</div>
    </div>
    <div class="side-label" style="margin-top:14px">定值校验</div>
    <div class="issue-panel"><div class="issue-list">${issues.map((it) => `<div class="issue-item ${it.level}">${icon(levelIcon(it.level), 12)}<span>${esc(it.msg)}</span></div>`).join('')}</div></div>
    <div class="side-label" style="margin-top:14px">时间级差配合</div>
    <div class="card" style="padding:7px 9px">${coord.length ? coord.slice(0, 5).map((c) => `<div class="coord-row ${c.level}"><span class="coord-icon">${icon(c.level === 'ok' ? 'check' : 'warning', 13)}</span><span class="coord-names">${esc(c.a)} ↔ ${esc(c.b)}</span><span class="coord-time">Δ${f(c.margin, 2)}s</span></div>`).join('') : `<div class="hint" style="color:var(--dim);font-size:8.5px;padding:4px">共享母线的不同层级保护之间将执行时间级差校核。</div>`}</div>
    ${selected ? `<div class="side-label" style="margin-top:14px">整定计算书</div><div class="formula-box">负荷电流 <b>I_L = max(S, I_rated)</b><br>CT 变比 <b>${selected.ct.primary}/${selected.ct.secondary}</b><br>过流启动 <b>I_op = ${selected.overcurrent.pickup} A</b><br>二次启动 <b>${f(selected.overcurrent.pickup / (selected.ct.primary / selected.ct.secondary), 2)} A</b><br>${branch.type === 'line' ? `线路阻抗 <b>${f(lineZPrimary(branch), 3)} Ω</b><br>Z1 二次值 <b>${f(relaySecondaryOhms(selected, selected.distance.z1), 3)} Ω</b>` : ''}</div>` : ''}
  </aside>` : `<aside class="protection-right">
    <div class="side-label">母线保护概览</div>
    ${busStatusCard(app, bus, selected, evalSum, faultCurrentA)}
    <div class="side-label" style="margin-top:14px">定值校验</div>
    <div class="issue-panel"><div class="issue-list">${issues.map((it) => `<div class="issue-item ${it.level}">${icon(levelIcon(it.level), 12)}<span>${esc(it.msg)}</span></div>`).join('')}</div></div>
    <div class="side-label" style="margin-top:14px">保护功能分布</div>
    <div class="card" style="padding:8px 10px">${GROUP_ORDER.map((g) => { const rows = evalRows.filter((x) => x.group === g); if (!rows.length) return ''; const on = rows.filter((x) => x.enabled).length; return `<div class="coord-row" style="border-bottom:1px solid rgba(80,110,140,.1)"><span class="coord-names">${g}</span><span class="coord-time">${on}/${rows.length}</span></div>`; }).join('')}</div>
    <div class="method-note" style="margin-top:10px">${icon('info', 11)} 母线保护定值以母差、失灵、死区、充电、PT/CT 断线、绝缘、弧光、低频/过频、备自投和联锁为主；非电量与现场校验项以配置清单形式输出。</div>
  </aside>`;

  return `<div class="protection-shell">${left}<div class="protection-main"><div class="protection-inner">
    <div class="protection-header">
      <div><div class="analysis-title"><div class="eyebrow">PROTECTION ENGINEERING · ${PROTECTION_COUNT} FUNCTIONS</div><h1>继电保护整定</h1><p>${relays.length} 套保护 · 线路 / 变压器 / 母线 · ${summary?.errors || 0} 项错误 / ${summary?.warnings || 0} 项提示</p></div></div>
      <div class="protection-actions">
        <button class="btn btn-sm" data-action="protection-sensitivity">${icon('target', 13)} 灵敏度 / 距离扫描</button>
        <button class="btn btn-sm" data-action="protection-runflow">${icon('play', 13)} 潮流计算</button>
        <button class="btn btn-sm btn-primary" data-action="protection-auto-all">${icon('sparkles', 13)} 一键自动整定</button>
      </div>
    </div>
    ${hero}${relayDetail}
  </div></div>${right}</div>`;
}

function recloseCard(relay) {
  const rc = relay.reclose || {};
  const enabled = rc.enabled !== false && rc.enabled !== 'false' && rc.enabled !== 0 && rc.enabled !== '0';
  return `<div class="card protection-card">
    <div class="card-head"><div><div class="card-title">${icon('clock', 14)} 自动重合闸</div><div class="card-sub">线路故障跳闸后的自动重合时序</div></div><span class="status-pill ${enabled ? 'ok' : 'neutral'}">${enabled ? '投入' : '退出'}</span></div>
    <div class="settings-grid two">
      <div class="setting-field"><label>重合闸方式</label><select data-relay-field="reclose.enabled"><option value="true" ${enabled ? 'selected' : ''}>投入</option><option value="false" ${!enabled ? 'selected' : ''}>退出</option></select></div>
      <div class="setting-field"><label>重合次数 <span class="unit">次</span></label><input type="number" min="0" max="5" data-relay-field="reclose.attempts" value="${rc.attempts ?? 1}"></div>
      <div class="setting-field"><label>死区时间 <span class="unit">s</span></label><input type="number" min="0.05" step="0.05" data-relay-field="reclose.deadTime" value="${rc.deadTime ?? 1}"></div>
      <div class="setting-field"><label>重合确认时间 <span class="unit">s</span></label><input type="number" min="1" step="1" data-relay-field="reclose.reclaimTime" value="${rc.reclaimTime ?? 30}"></div>
    </div>
    <div class="settings-foot">${icon('info', 10)} 重合时序使用过流保护动作时间与断路器分闸时间；瞬时故障重合一次成功，永久故障达到次数后闭锁。正式设计还需校核检同期/检无压与潜供电流。</div>
    <div style="margin-top:8px"><button class="btn btn-sm" data-action="protection-reclose">${icon('clock', 12)} 生成重合闸时序</button></div>
  </div>`;
}

function distanceCard(app, relay, branch) {
  const z = lineZPrimary(branch);
  const sec = (v) => relaySecondaryOhms(relay, v);
  return `<div class="card protection-card">
    <div class="function-header"><div class="function-title">${icon('line', 15)} 距离保护 <span class="sub">三段式 · 线路正序阻抗 ${f(z, 3)} Ω</span></div><span class="status-pill neutral">多边形特性近似</span></div>
    <div class="settings-grid">
      ${distField('I 段 Z1', 'distance.z1', relay.distance.z1, 'Ω', `${f(sec(relay.distance.z1), 3)} Ω 二次`)}
      ${distField('II 段 Z2', 'distance.z2', relay.distance.z2, 'Ω', `${f(sec(relay.distance.z2), 3)} Ω 二次`)}
      ${distField('III 段 Z3', 'distance.z3', relay.distance.z3, 'Ω', `${f(sec(relay.distance.z3), 3)} Ω 二次`)}
      ${distField('I 段时间 t1', 'distance.t1', relay.distance.t1, 's')}
      ${distField('II 段时间 t2', 'distance.t2', relay.distance.t2, 's')}
      ${distField('III 段时间 t3', 'distance.t3', relay.distance.t3, 's')}
      ${distField('灵敏角 φ', 'distance.angle', relay.distance.angle, '°')}
      ${distField('零序补偿 K0', 'distance.k0', relay.distance.k0, '', '')}
      <div class="setting-field"><label>I 段保护范围</label><input value="${f(relay.distance.z1 / Math.max(z, 1e-9) * 100, 1)}%" readonly></div>
      <div class="settings-foot">${icon('info', 10)} 自动整定按 I 段 80%、II 段 120%、III 段延伸至相邻元件并校核灵敏度。二次阻抗已按 CT/PT 变比折算。</div>
    </div>
  </div>`;
}

function distField(label, name, value, unit, sub = '') {
  return `<div class="setting-field"><label>${esc(label)} ${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</label><input type="number" step="0.01" data-relay-field="${esc(name)}" value="${value}">${sub ? `<div class="hint" style="font-size:7.5px;color:var(--dim);margin-top:2px">${esc(sub)}</div>` : ''}</div>`;
}

function differentialCard(relay) {
  return `<div class="card protection-card">
    <div class="function-header"><div class="function-title">${icon('transformer', 15)} 变压器差动保护 <span class="sub">比率制动 · 二次谐波闭锁</span></div><span class="status-pill ok">主保护</span></div>
    <div class="settings-grid">
      <div class="setting-field"><label>启动值 I_sd <span class="unit">Ie</span></label><input type="number" step="0.01" data-relay-field="differential.pickup" value="${relay.differential.pickup}"></div>
      <div class="setting-field"><label>斜率 1 <span class="unit">pu</span></label><input type="number" step="0.01" data-relay-field="differential.slope1" value="${relay.differential.slope1}"></div>
      <div class="setting-field"><label>斜率 2 <span class="unit">pu</span></label><input type="number" step="0.01" data-relay-field="differential.slope2" value="${relay.differential.slope2}"></div>
      <div class="setting-field"><label>差动动作时间 <span class="unit">s</span></label><input type="number" step="0.01" data-relay-field="differential.t" value="${relay.differential.t}"></div>
      <div class="setting-field"><label>斜率 2 起始制动 <span class="unit">Ie</span></label><input type="number" step="0.01" data-relay-field="differential.t2" value="${relay.differential.t2}"></div>
      <div class="setting-field"><label>二次谐波制动 <span class="unit">%</span></label><input type="number" step="1" data-relay-field="differential.harmonicBlock" value="${relay.differential.harmonicBlock}"></div>
      <div class="settings-foot">${icon('info', 10)} 差动保护为变压器主保护，整定需结合各侧 CT 变比、接线组别与励磁涌流特性。此处用于方案阶段定值初设。</div>
    </div>
  </div>`;
}

function overcurrentCard(relay, faultCurrentA, tripTime) {
  const secondary = relay.overcurrent.pickup / ((relay.ct.primary || 1) / (relay.ct.secondary || 5));
  const m = faultCurrentA / Math.max(1, relay.overcurrent.pickup);
  const ksen = m;
  const ksenClass = ksen >= 1.5 ? 'ok' : ksen >= 1.3 ? 'warn' : 'bad';
  return `<div class="card protection-card">
    <div class="function-header"><div class="function-title">${icon('shield', 15)} 过流后备保护 <span class="sub">${CURVES[relay.overcurrent.curve]?.label || ''}</span></div><span class="status-pill ${Number.isFinite(tripTime) ? 'ok' : 'neutral'}">${Number.isFinite(tripTime) ? `t = ${f(tripTime, 2)} s` : '故障电流低于启动值'}</span></div>
    <div class="settings-grid">
      <div class="setting-field"><label>启动值 I_op <span class="unit">A 一次</span></label><input type="number" step="1" data-relay-field="overcurrent.pickup" value="${relay.overcurrent.pickup}"><div class="hint" style="font-size:7.5px;color:var(--dim);margin-top:2px">二次 ${f(secondary, 2)} A</div></div>
      <div class="setting-field"><label>时间倍率 TMS</label><input type="number" step="0.01" data-relay-field="overcurrent.tms" value="${relay.overcurrent.tms}"></div>
      <div class="setting-field"><label>反时限曲线</label><select data-relay-field="overcurrent.curve">${OC_CURVES.map((c) => `<option value="${c.id}" ${c.id === relay.overcurrent.curve ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="setting-field"><label>速断 I&gt;&gt; <span class="unit">A</span></label><input type="number" step="10" data-relay-field="overcurrent.instPickup" value="${relay.overcurrent.instPickup}"></div>
      <div class="setting-field"><label>速断时间 <span class="unit">s</span></label><input type="number" step="0.01" data-relay-field="overcurrent.instTime" value="${relay.overcurrent.instTime}"></div>
      <div class="setting-field"><label>故障电流倍数</label><input value="${f(m, 2)} × I_op" readonly></div>
      <div class="setting-field"><label>灵敏系数 K<sub>sen</sub></label><input value="${f(ksen, 2)} · ${ksenClass === 'ok' ? '满足' : ksenClass === 'warn' ? '临界' : '不足'}" readonly style="color:${ksenClass === 'ok' ? 'var(--green)' : ksenClass === 'warn' ? 'var(--amber)' : 'var(--red)'}"></div>
      <div class="settings-foot">${icon('info', 10)} 自动整定根据最大负荷电流选取一次启动值，并按共享母线的上下游关系自动抬高上游 TMS，保证至少 0.30 s 级差。Ksen 按当前校验电流 / 启动值计算，建议 ≥ 1.50。</div>
    </div>
  </div>`;
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function currentEntry(app, relay) {
  const { category } = elementOf(app, relay);
  let entry = protectionById(app.protectionFunctionId);
  if (!entry || entry.category !== category) entry = protectionsFor(category).find((x) => !x.core) || protectionsFor(category)[0];
  return entry;
}

export function bindProtection(root, app) {
  root.querySelectorAll('[data-relay-filter]').forEach((b) => b.addEventListener('click', () => {
    app.protectionFilter = b.dataset.relayFilter;
    app.rerender();
  }));
  root.querySelectorAll('[data-relay-select]').forEach((b) => b.addEventListener('click', () => {
    app.protectionSelectedId = b.dataset.relaySelect;
    app.protectionFunctionId = null;
    const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
    if (relay?.targetType !== 'bus' && relay) {
      const br = app.project.branches.find((x) => x.id === relay.branchId);
      if (br) app.protectionFaultCurrent = Math.max(Number(app.protectionFaultCurrent) || 0, Number(relay.overcurrent?.pickup) * 4);
    }
    app.rerender();
  }));
  root.querySelectorAll('[data-protection-select]').forEach((b) => b.addEventListener('click', () => {
    app.protectionFunctionId = b.dataset.protectionSelect;
    app.rerender();
  }));
  const act = (name, fn) => root.querySelectorAll(`[data-action="${name}"]`).forEach((b) => b.addEventListener('click', fn));
  act('protection-sensitivity', () => app.runProtectionSensitivity());
  act('protection-reclose', () => app.runRecloseCheck());
  act('protection-auto-all', () => app.autoSetProtection(true));
  act('protection-auto-selected', () => app.autoSetProtection(false));
  act('protection-reset-selected', () => app.resetSelectedRelay());
  act('protection-runflow', () => app.runAnalysis({ switchMode: false, quiet: true }));
  act('protection-library', () => app.openProtectionLibrary());
  act('protection-use-sc', () => {
    if (!app.shortCircuit) return;
    app.protectionFaultCurrent = Math.round(app.shortCircuit.Ik * 1000);
    app.toast('已带入短路电流', `${app.shortCircuit.busTag} 三相短路 ${app.shortCircuit.Ik.toFixed(2)} kA。`);
    app.rerender();
  });
  act('protection-open-branch', () => {
    const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
    if (!relay) return;
    app.setMode('design');
    if (relay.targetType === 'bus') app.select('bus', relay.busId);
    else app.select('branch', relay.branchId);
    app.editor?.fit();
  });
  act('protection-add-all', () => app.autoSetProtection(true));
  act('protection-recommend', () => {
    const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
    if (!relay) return;
    const entry = currentEntry(app, relay);
    if (!entry) return;
    const { category } = elementOf(app, relay);
    relay.protections[entry.id] = {
      enabled: true,
      settings: protectionDefaults(entry, { rated: relay.ct?.primary * 0.8, length: 30 })
    };
    relay.mode = 'manual';
    syncRelayLegacyFunctions(relay);
    app.commit(`恢复 ${entry.name} 推荐值`);
    app.refreshProtectionSummary();
    app.rerender();
    app.scheduleSave();
  });
  root.querySelector('[data-relay-enable]')?.addEventListener('click', () => {
    const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
    if (!relay) return;
    relay.enabled = !relay.enabled;
    app.commit('投退保护');
    app.refreshProtectionSummary();
    app.rerender();
    app.scheduleSave();
  });
  root.querySelector('[data-protection-enable]')?.addEventListener('click', () => {
    const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
    if (!relay) return;
    const entry = currentEntry(app, relay);
    if (!entry) return;
    if (!relay.protections[entry.id]) relay.protections[entry.id] = { enabled: true, settings: protectionDefaults(entry) };
    relay.protections[entry.id].enabled = !(relay.protections[entry.id].enabled !== false);
    relay.mode = 'manual';
    syncRelayLegacyFunctions(relay);
    app.commit('切换保护功能');
    app.refreshProtectionSummary();
    app.rerender();
    app.scheduleSave();
  });
  root.querySelectorAll('[data-protection-field]').forEach((input) => {
    input.addEventListener('change', () => {
      const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
      if (!relay) return;
      const entry = currentEntry(app, relay);
      if (!entry) return;
      if (!relay.protections[entry.id]) relay.protections[entry.id] = { enabled: true, settings: protectionDefaults(entry) };
      let value = input.value;
      if (input.type === 'number') value = Number(value);
      relay.protections[entry.id].settings[input.dataset.protectionField] = value;
      relay.mode = 'manual';
      app.commit('修改保护定值');
      app.refreshProtectionSummary();
      app.rerender();
      app.scheduleSave();
    });
  });
  root.querySelectorAll('[data-relay-field]').forEach((input) => {
    input.addEventListener('change', () => {
      const relay = app.project.relays.find((r) => r.id === app.protectionSelectedId);
      if (!relay) return;
      let v = input.value;
      if (input.type === 'number') v = Number(v);
      setNested(relay, input.dataset.relayField, v);
      relay.mode = 'manual';
      syncRelayLegacyFunctions(relay);
      app.commit('修改保护定值');
      app.refreshProtectionSummary();
      app.rerender();
      app.scheduleSave();
    });
  });
  root.querySelector('[data-protection-current]')?.addEventListener('change', (e) => {
    const n = Math.max(1, Number(e.target.value) || 1);
    app.protectionFaultCurrent = n;
    app.rerender();
  });
}
