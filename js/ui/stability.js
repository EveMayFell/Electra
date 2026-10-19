import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
const COLORS = ['#5fe2c9', '#ffbd66', '#8f9cff', '#ff8fa0', '#7cc7ff', '#c6a4ff', '#9bdc76'];

function angleChart(result) {
  const gens = result.generators;
  if (!gens.length || !result.timeline.length) return '<div class="chart-empty">无稳定仿真数据</div>';
  const W = 820;
  const H = 300;
  const pad = { l: 50, r: 18, t: 20, b: 34 };
  const tMax = Math.max(0.1, result.timeline[result.timeline.length - 1].t);
  const vals = result.timeline.flatMap((p) => p.angles);
  const maxAbs = Math.min(720, Math.max(20, ...vals.map((v) => Math.abs(v))));
  const yTop = maxAbs * 1.08;
  const x = (t) => pad.l + (W - pad.l - pad.r) * (t / tMax);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v + yTop) / (2 * yTop));
  let g = '';
  const ticks = [-yTop, -yTop / 2, 0, yTop / 2, yTop];
  for (const v of ticks) {
    const yy = y(v);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="${v === 0 ? 'rgba(161,190,210,.3)' : 'rgba(87,119,149,.14)'}" stroke-width="${v === 0 ? 1.2 : .8}"/>`;
    g += `<text x="${pad.l - 8}" y="${yy + 3}" text-anchor="end" fill="#66809a" font-size="8.5" font-family="Consolas,monospace">${v.toFixed(0)}°</text>`;
  }
  const tTicks = 6;
  for (let i = 0; i <= tTicks; i++) {
    const t = tMax * i / tTicks;
    const xx = x(t);
    g += `<line x1="${xx}" x2="${xx}" y1="${pad.t}" y2="${H - pad.b}" stroke="rgba(87,119,149,.12)" stroke-width=".8"/>`;
    g += `<text x="${xx}" y="${H - 13}" text-anchor="middle" fill="#66809a" font-size="8" font-family="Consolas,monospace">${t.toFixed(1)} s</text>`;
  }
  const faultStart = result.faultStart;
  const faultEnd = Math.min(tMax, result.faultStart + result.faultDuration);
  g += `<rect x="${x(faultStart)}" y="${pad.t}" width="${Math.max(2, x(faultEnd) - x(faultStart))}" height="${H - pad.t - pad.b}" fill="rgba(255,125,140,.08)"/>`;
  g += `<line x1="${x(faultStart)}" x2="${x(faultStart)}" y1="${pad.t}" y2="${H - pad.b}" stroke="rgba(255,125,140,.55)" stroke-dasharray="3 3"/>`;
  g += `<line x1="${x(faultEnd)}" x2="${x(faultEnd)}" y1="${pad.t}" y2="${H - pad.b}" stroke="rgba(255,189,102,.55)" stroke-dasharray="3 3"/>`;
  g += `<text x="${x(faultStart) + 4}" y="${pad.t + 10}" fill="#ff9aa6" font-size="8" font-family="Consolas,monospace">故障</text>`;
  g += `<text x="${x(faultEnd) + 4}" y="${pad.t + 10}" fill="#ffcf8c" font-size="8" font-family="Consolas,monospace">切除</text>`;
  for (let gi = 0; gi < gens.length; gi++) {
    const path = result.timeline.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.angles[gi]).toFixed(1)}`).join(' ');
    g += `<path d="${path}" fill="none" stroke="${COLORS[gi % COLORS.length]}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  const legend = gens.map((gen, i) => `<span class="lg"><span class="sw dot" style="background:${COLORS[i % COLORS.length]}"></span>${esc(gen.tag)}</span>`).join('');
  return `<div style="height:320px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:100%">${g}</svg></div><div class="legend-row" style="padding:0 4px 4px">${legend}<span class="lg"><span class="sw" style="background:rgba(255,125,140,.3);height:8px"></span>故障持续</span></div>`;
}

function speedChart(result) {
  if (!result.timeline.length) return '';
  const W = 820;
  const H = 170;
  const pad = { l: 50, r: 18, t: 15, b: 28 };
  const tMax = Math.max(0.1, result.timeline[result.timeline.length - 1].t);
  const vals = result.timeline.flatMap((p) => p.speeds);
  const maxAbs = Math.max(0.002, ...vals.map((v) => Math.abs(v))) * 1.15;
  const x = (t) => pad.l + (W - pad.l - pad.r) * (t / tMax);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v + maxAbs) / (2 * maxAbs));
  let g = '';
  for (const v of [-maxAbs, 0, maxAbs]) {
    const yy = y(v);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="${v === 0 ? 'rgba(161,190,210,.25)' : 'rgba(87,119,149,.13)'}" stroke-width=".8"/>`;
    g += `<text x="${pad.l - 8}" y="${yy + 3}" text-anchor="end" fill="#66809a" font-size="7.5" font-family="Consolas,monospace">${v.toFixed(3)}</text>`;
  }
  result.generators.forEach((gen, gi) => {
    const path = result.timeline.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.speeds[gi]).toFixed(1)}`).join(' ');
    g += `<path d="${path}" fill="none" stroke="${COLORS[gi % COLORS.length]}" stroke-width="1.6" opacity=".9"/>`;
  });
  g += `<text x="${W - pad.r}" y="${H - 8}" text-anchor="end" fill="#66809a" font-size="7.5" font-family="Consolas,monospace">Δω (pu)</text>`;
  return `<div style="height:180px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:100%">${g}</svg></div>`;
}

export function renderStability(app) {
  const opt = app.stabilityOptions;
  const buses = app.project.buses.filter((b) => b.type !== 'slack');
  if (!opt.faultBusId || !buses.some((b) => b.id === opt.faultBusId)) opt.faultBusId = buses[0]?.id || null;
  const res = app.stabilityResult;
  const side = `<aside class="analysis-side">
    <div class="side-label">暂态稳定设置</div>
    <div class="field" style="margin-bottom:8px">
      <label>故障母线 <span class="unit">非平衡节点</span></label>
      <select data-stab-option="faultBusId">${buses.map((b) => `<option value="${b.id}" ${b.id === opt.faultBusId ? 'selected' : ''}>${esc(b.tag)} · ${esc(b.name)}</option>`).join('')}</select>
    </div>
    <div class="param-panel">
      <div class="param-row"><span class="pl">故障起始</span><span class="pv"><input class="mini-input" type="number" min="0" step="0.01" data-stab-option="faultStart" value="${opt.faultStart}"><span class="mini-unit">s</span></span></div>
      <div class="param-row"><span class="pl">切除时间</span><span class="pv"><input class="mini-input" type="number" min="0.01" step="0.01" data-stab-option="faultDuration" value="${opt.faultDuration}"><span class="mini-unit">s</span></span></div>
      <div class="param-row"><span class="pl">仿真时长</span><span class="pv"><input class="mini-input" type="number" min="0.5" step="0.5" data-stab-option="tEnd" value="${opt.tEnd}"><span class="mini-unit">s</span></span></div>
      <div class="param-row"><span class="pl">积分步长</span><span class="pv"><input class="mini-input" type="number" min="0.002" max="0.02" step="0.002" data-stab-option="dt" value="${opt.dt}"><span class="mini-unit">s</span></span></div>
    </div>
    <div class="analysis-cta">
      <button class="btn btn-primary" data-action="stab-run">${icon('play', 14)} 运行暂态仿真</button>
      <button class="btn" data-action="stab-cct">${icon('clock', 14)} 估算临界切除时间</button>
    </div>
    <div class="side-note">经典二阶模型：发电机 E′ 恒定、暂态电抗 x′d、恒阻抗负荷、固定电压平衡节点。适合方案阶段首摆稳定初筛，不替代完整机电暂态程序。</div>
  </aside>`;

  let main;
  if (!res) {
    main = `<div class="analysis-main"><div class="analysis-inner">
      <div class="analysis-topbar"><div class="analysis-title"><div class="eyebrow">TRANSIENT STABILITY</div><h1>暂态稳定分析</h1><p>三相短路、故障切除与发电机功角首摆仿真。</p></div><span class="result-badge neutral"><span class="dot"></span>等待仿真</span></div>
      <div class="card" style="min-height:500px;display:grid;place-items:center"><div class="empty-state" style="padding:45px 30px"><div class="es-icon">${icon('wave', 32)}</div><h2>建立机电暂态模型</h2><p>程序将根据潮流解计算发电机 E′，将负荷折算为恒阻抗，Kron 降阶后进行 RK4 时域积分，输出发电机相对功角与转速偏差。故障点只能选非平衡母线。</p><button class="btn btn-primary" data-action="stab-run">${icon('play', 14)} 开始仿真</button></div></div>
      <div class="grid-3 section-gap">
        <div class="card"><div class="card-body"><div class="section-title">经典模型</div><p class="hint" style="color:var(--muted);line-height:1.65">E′ 恒定、x′d 暂态电抗、惯性时间常数 H、恒定阻尼。适用于第一摆稳定 screening。</p></div></div>
        <div class="card"><div class="card-body"><div class="section-title">故障时序</div><p class="hint" style="color:var(--muted);line-height:1.65">t=0 建立故障前方式，故障在设定时刻发生，持续指定时间后切除，仿真到设定终了时间。</p></div></div>
        <div class="card"><div class="card-body"><div class="section-title">稳定判据</div><p class="hint" style="color:var(--muted);line-height:1.65">末段转速偏差小于 0.03 pu 且最大功角差小于 180°，并给出临界切除时间估算。</p></div></div>
      </div>
    </div></div>`;
  } else {
    const stable = res.stable;
    const cct = app.stabilityCCT;
    main = `<div class="analysis-main"><div class="analysis-inner">
      <div class="analysis-topbar"><div class="analysis-title"><div class="eyebrow">TRANSIENT STABILITY RESULTS</div><h1>暂态稳定分析 <span class="result-badge ${stable ? '' : 'fail'}"><span class="dot"></span>${stable ? '稳定' : '失稳'}</span></h1><p>${esc(res.faultBusTag)} ${esc(res.faultBusName)} · 三相短路 · ${f(res.faultDuration, 2)} s 后切除 · 仿真至 ${f(res.tEnd, 2)} s</p></div><div class="analysis-top-actions"><button class="btn btn-sm" data-action="stab-cct">${icon('clock', 13)} 临界切除时间</button><button class="btn btn-sm btn-primary" data-action="stab-run">${icon('play', 13)} 重新仿真</button></div></div>
      <div class="metrics">
        <div class="metric ${stable ? 'good' : 'bad'}"><div class="m-label">${icon('check', 11)} 稳定判定</div><div class="m-value">${stable ? 'STABLE' : 'UNSTABLE'}</div><div class="m-foot">${esc(res.status)}</div></div>
        <div class="metric"><div class="m-label">${icon('wave', 11)} 最大功角差</div><div class="m-value">${f(res.maxSpread, 1)} <small>°</small></div><div class="m-foot">末段功角差 ${f(res.lastSpread, 1)}°</div></div>
        <div class="metric"><div class="m-label">${icon('clock', 11)} 末段最大转速偏差</div><div class="m-value">${f(res.finalSpeed, 4)} <small>pu</small></div><div class="m-foot">稳定门槛 0.03 pu</div></div>
        <div class="metric ${cct ? 'good' : ''}"><div class="m-label">${icon('shield', 11)} 临界切除时间</div><div class="m-value">${cct ? `${cct.stableAtMax ? '≥' : ''}${f(cct.criticalTime, 3)}` : '—'} <small>s</small></div><div class="m-foot">${cct ? `${cct.scans} 次仿真 · 近似二分搜索` : '尚未估算'}</div></div>
      </div>
      ${!stable ? `<div class="notice-strip" style="margin-bottom:11px">${icon('warning', 13)} 当前故障方式下首摆失稳：建议缩短切除时间、增加制动/阻尼、调整开机方式或增强网架。</div>` : ''}
      <div class="card"><div class="card-head"><div><div class="card-title">${icon('wave', 15)} 发电机相对功角</div><div class="card-sub">相对惯性中心（COI）· 红色区间为故障持续时间</div></div><span class="result-badge neutral">${res.generators.length} 台动态机组</span></div><div class="card-body" style="padding:9px 12px 0">${angleChart(res)}</div></div>
      <div class="grid-2 section-gap">
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('wave', 15)} 转速偏差</div><div class="card-sub">Δω 随时间的衰减/发散</div></div></div><div class="card-body" style="padding:8px 12px 0">${speedChart(res)}</div></div>
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('generator', 15)} 动态机组参数</div><div class="card-sub">经典模型初值与惯性</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>机组</th><th>H (s)</th><th>x′d (pu)</th><th>|E′|</th><th>初始角</th><th>P₀</th><th>Q₀</th></tr></thead><tbody>${res.generators.map((g) => `<tr><td><div class="name-cell">${esc(g.tag)}</div><div class="cell-sub">${esc(g.name)}</div></td><td class="num">${f(g.H, 1)}</td><td class="num">${f(g.xd, 4)}</td><td class="num">${f(g.Eabs, 4)}</td><td class="num">${f(g.angle0, 2)}°</td><td class="num">${f(g.p0, 1)}</td><td class="num">${f(g.q0, 1)}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="method-note" style="margin-top:11px">${icon('flask', 12)} ${res.notes.join(' ')} 平衡节点：${res.referenceBuses.map((b) => esc(b.name)).join('、')}。</div>
    </div></div>`;
  }
  return `<div class="analysis-shell">${side}${main}</div>`;
}

export function bindStability(root, app) {
  root.querySelectorAll('[data-stab-option]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.stabOption;
      let value = el.value;
      if (el.type === 'number') value = Number(value);
      if (value === '' || (typeof value === 'number' && !Number.isFinite(value))) return;
      app.stabilityOptions[key] = value;
      app.stabilityResult = null;
      app.stabilityCCT = null;
      app.rerender();
    });
  });
  root.querySelectorAll('[data-action="stab-run"]').forEach((b) => b.addEventListener('click', () => app.runStabilityAnalysis()));
  root.querySelectorAll('[data-action="stab-cct"]').forEach((b) => b.addEventListener('click', () => app.estimateStabilityCCT()));
}
