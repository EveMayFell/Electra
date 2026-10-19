import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));

function voltageChart(res) {
  const rows = res.base.result.busResults;
  if (!rows.length) return '';
  const width = 820;
  const height = 270;
  const pad = { l: 48, r: 16, t: 18, b: 36 };
  const y0 = 0.94;
  const y1 = 1.06;
  const x = (i) => pad.l + (width - pad.l - pad.r) * (i / Math.max(1, rows.length - 1));
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - (v - y0) / (y1 - y0));
  let g = '';
  g += `<rect x="${pad.l}" y="${y(res.targetMax)}" width="${width - pad.l - pad.r}" height="${Math.max(0, y(res.targetMin) - y(res.targetMax))}" fill="rgba(95,226,201,.06)"/>`;
  for (const v of [0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06]) {
    g += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 1 ? 'rgba(161,190,210,.3)' : 'rgba(87,119,149,.13)'}" stroke-width=".8"/>`;
    g += `<text x="${pad.l - 8}" y="${y(v) + 3}" text-anchor="end" fill="#66809a" font-size="8" font-family="Consolas,monospace">${v.toFixed(2)}</text>`;
  }
  const bestRows = res.best.result.busResults;
  const path = (arr, color, width) => arr.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(b.Vm).toFixed(1)}`).join(' ');
  g += `<path d="${path(rows, '#6f8297', 1.4)}" fill="none" stroke="#6f8297" stroke-width="1.3" stroke-dasharray="4 4"/>`;
  g += `<path d="${path(bestRows, '#4ce0c3', 2)}" fill="none" stroke="#4ce0c3" stroke-width="2.2"/>`;
  rows.forEach((b, i) => {
    g += `<circle cx="${x(i)}" cy="${y(b.Vm)}" r="2.4" fill="#0b1725" stroke="#6f8297" stroke-width="1.2"/>`;
    g += `<circle cx="${x(i)}" cy="${y(bestRows[i].Vm)}" r="2.8" fill="#0b1725" stroke="#4ce0c3" stroke-width="1.5"/>`;
    if (rows.length <= 10 || i % 2 === 0) g += `<text x="${x(i)}" y="${height - 13}" text-anchor="middle" fill="#66809a" font-size="7.5" font-family="Consolas,monospace">${esc(b.tag)}</text>`;
  });
  return `<div style="height:285px"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%">${g}</svg></div><div class="legend-row" style="padding:0 5px 5px"><span class="lg"><span class="sw dot" style="background:#6f8297"></span>优化前</span><span class="lg"><span class="sw dot" style="background:#4ce0c3"></span>优化后</span><span class="lg"><span class="sw" style="background:rgba(95,226,201,.18);height:8px"></span>目标电压带</span></div>`;
}

function frequencyChart(res) {
  if (!res.timeline?.length) return '';
  const width = 820;
  const height = 280;
  const pad = { l: 50, r: 16, t: 18, b: 36 };
  const tMax = Math.max(1, res.timeline[res.timeline.length - 1].t);
  const minHz = Math.min(...res.timeline.map((p) => p.hz), res.f0 - 0.3);
  const maxHz = Math.max(...res.timeline.map((p) => p.hz), res.f0 + 0.2);
  const lo = Math.floor((minHz - 0.1) * 10) / 10;
  const hi = Math.ceil((maxHz + 0.1) * 10) / 10;
  const x = (t) => pad.l + (width - pad.l - pad.r) * (t / tMax);
  const y = (hz) => pad.t + (height - pad.t - pad.b) * (1 - (hz - lo) / (hi - lo));
  let g = '';
  for (let hz = lo; hz <= hi + 1e-9; hz += 0.2) {
    g += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(hz)}" y2="${y(hz)}" stroke="${Math.abs(hz - res.f0) < 1e-9 ? 'rgba(161,190,210,.3)' : 'rgba(87,119,149,.13)'}" stroke-width=".8"/>`;
    g += `<text x="${pad.l - 8}" y="${y(hz) + 3}" text-anchor="end" fill="#66809a" font-size="8" font-family="Consolas,monospace">${hz.toFixed(1)}</text>`;
  }
  for (let i = 0; i <= 6; i++) {
    const t = tMax * i / 6;
    g += `<line x1="${x(t)}" x2="${x(t)}" y1="${pad.t}" y2="${height - pad.b}" stroke="rgba(87,119,149,.1)" stroke-width=".8"/>`;
    g += `<text x="${x(t)}" y="${height - 13}" text-anchor="middle" fill="#66809a" font-size="7.5" font-family="Consolas,monospace">${t.toFixed(0)} s</text>`;
  }
  if (res.agc) {
    g += `<line x1="${x(10)}" x2="${x(10)}" y1="${pad.t}" y2="${height - pad.b}" stroke="rgba(255,189,102,.5)" stroke-dasharray="3 3"/>`;
    g += `<text x="${x(10) + 4}" y="${pad.t + 10}" fill="#ffcf8c" font-size="8" font-family="Consolas,monospace">AGC 投入</text>`;
  }
  const path = res.timeline.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.hz).toFixed(1)}`).join(' ');
  g += `<path d="${path}" fill="none" stroke="#ff9a7a" stroke-width="2" stroke-linejoin="round"/>`;
  g += `<circle cx="${x(res.timeline.find((p) => p.hz === res.minHz)?.t || 0)}" cy="${y(res.minHz)}" r="3" fill="#0b1725" stroke="#ff9a7a" stroke-width="1.6"/>`;
  return `<div style="height:295px"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%">${g}</svg></div>`;
}

export function renderRegulation(app) {
  const opt = app.regulationOptions;
  const vb = app.voltageBalanceResult;
  const fr = app.frequencyResult;
  const side = `<aside class="analysis-side">
    <div class="side-label">电压平衡</div>
    <div class="param-panel">
      <div class="param-row"><span class="pl">目标下限</span><span class="pv"><input class="mini-input" type="number" step="0.005" min="0.9" max="1.04" data-reg-option="targetMin" value="${opt.targetMin}"><span class="mini-unit">pu</span></span></div>
      <div class="param-row"><span class="pl">目标上限</span><span class="pv"><input class="mini-input" type="number" step="0.005" min="0.96" max="1.1" data-reg-option="targetMax" value="${opt.targetMax}"><span class="mini-unit">pu</span></span></div>
    </div>
    <div class="analysis-cta"><button class="btn btn-primary" data-action="reg-voltage">${icon('target', 14)} 运行电压平衡</button><button class="btn" data-action="reg-apply" ${vb?.changes?.length ? '' : 'disabled'}>${icon('check', 14)} 应用电压方案</button></div>
    <div class="side-label" style="margin-top:18px">频率平衡</div>
    <div class="param-panel">
      <div class="param-row"><span class="pl">扰动类型</span><span class="pv"><select class="mini-input" data-reg-option="eventType" style="width:130px"><option value="generatorTrip" ${opt.eventType === 'generatorTrip' ? 'selected' : ''}>发电机跳机</option><option value="loadStep" ${opt.eventType === 'loadStep' ? 'selected' : ''}>负荷突增</option><option value="surplus" ${opt.eventType === 'surplus' ? 'selected' : ''}>有功盈余</option></select></span></div>
      <div class="param-row"><span class="pl">扰动功率</span><span class="pv"><input class="mini-input" type="number" min="0" step="10" data-reg-option="eventMW" value="${opt.eventMW}"><span class="mini-unit">MW</span></span></div>
      <div class="param-row"><span class="pl">调差率</span><span class="pv"><input class="mini-input" type="number" min="1" step="0.5" data-reg-option="droop" value="${opt.droop}"><span class="mini-unit">%</span></span></div>
      <div class="param-row"><span class="pl">仿真时长</span><span class="pv"><input class="mini-input" type="number" min="5" step="5" data-reg-option="tEnd" value="${opt.tEnd}"><span class="mini-unit">s</span></span></div>
    </div>
    <div class="switch-row compact" style="margin-top:8px"><span class="switch-label" style="font-size:9px">AGC 二次调频</span><button class="toggle ${opt.agc ? 'on' : ''}" data-action="reg-toggle-agc"></button></div>
    <div class="analysis-cta"><button class="btn btn-primary" data-action="reg-frequency">${icon('wave', 14)} 运行频率仿真</button></div>
    <div class="side-note">电压平衡调整 PV/Slack 电压、变压器分接头与并联补偿；频率模型为单区域惯量中心 + 一次调频 + AGC 二次调节。</div>
  </aside>`;

  let main;
  if (!vb && !fr) {
    main = `<div class="analysis-main"><div class="analysis-inner"><div class="analysis-topbar"><div class="analysis-title"><div class="eyebrow">VOLTAGE / FREQUENCY REGULATION</div><h1>电压与频率调节系统</h1><p>无功电压平衡、变压器分接头协调、一次调频、AGC 二次恢复。</p></div><span class="result-badge neutral"><span class="dot"></span>等待计算</span></div><div class="card" style="min-height:520px;display:grid;place-items:center"><div class="empty-state" style="padding:45px 30px"><div class="es-icon">${icon('sliders', 32)}</div><h2>建立调节系统模型</h2><p>输入电压目标带或有功扰动后运行。电压平衡每步校验完整交流潮流；频率仿真积分转子惯量、负荷阻尼、调速器与 AGC。</p></div></div><div class="grid-2 section-gap"><div class="card"><div class="card-body"><div class="section-title">电压平衡</div><p class="hint" style="color:var(--muted);line-height:1.65">以目标电压带内的偏差平方和最小为目标，协调发电机电压设定、变压器分接头和现有补偿容量。</p></div></div><div class="card"><div class="card-body"><div class="section-title">频率平衡</div><p class="hint" style="color:var(--muted);line-height:1.65">发电机跳机/负荷突增后，一次调频按调差率响应，AGC 在延时后积分恢复频率；输出最低频率、RoCoF 和备用需求。</p></div></div></div></div></div>`;
  } else {
    const voltage = vb ? `<div class="card section-gap"><div class="card-head"><div><div class="card-title">${icon('target', 15)} 电压平衡结果</div><div class="card-sub">目标 ${vb.targetMin.toFixed(3)}–${vb.targetMax.toFixed(3)} pu · ${vb.evaluations} 次潮流评估</div></div><span class="result-badge ${vb.summary.bestOutOfBand ? 'fail' : ''}">${vb.summary.bestOutOfBand} 个越目标带</span></div><div class="card-body"><div class="metrics" style="margin-bottom:10px"><div class="metric"><div class="m-label">最低电压</div><div class="m-value">${f(vb.summary.bestVMin, 4)} <small>pu</small></div><div class="m-foot">优化前 ${f(vb.summary.baseVMin, 4)}</div></div><div class="metric"><div class="m-label">最高电压</div><div class="m-value">${f(vb.summary.bestVMax, 4)} <small>pu</small></div><div class="m-foot">优化前 ${f(vb.summary.baseVMax, 4)}</div></div><div class="metric"><div class="m-label">目标带外母线</div><div class="m-value">${vb.summary.bestOutOfBand}</div><div class="m-foot">优化前 ${vb.summary.baseOutOfBand} 个</div></div><div class="metric"><div class="m-label">最大负载率</div><div class="m-value">${f(vb.summary.bestMaxLoad, 1)} <small>%</small></div><div class="m-foot">优化前 ${f(vb.summary.baseMaxLoad, 1)}%</div></div></div>${voltageChart(vb)}${vb.changes.length ? `<div class="table-wrap" style="margin-top:10px"><table class="data-table"><thead><tr><th>调整对象</th><th>当前</th><th>建议</th><th>变化</th></tr></thead><tbody>${vb.changes.map((c) => `<tr><td class="name-cell">${esc(c.label)}</td><td class="num">${f(c.from, 3)} ${esc(c.unit)}</td><td class="num accent">${f(c.to, 3)} ${esc(c.unit)}</td><td class="num">${c.to - c.from > 0 ? '+' : ''}${f(c.to - c.from, 3)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="method-note" style="margin-top:10px">当前电压已满足目标带，无需调整。</div>'}</div></div>` : '';
    const freq = fr ? `<div class="card section-gap"><div class="card-head"><div><div class="card-title">${icon('wave', 15)} 频率平衡结果</div><div class="card-sub">${fr.eventType === 'surplus' ? '有功盈余' : fr.eventType === 'loadStep' ? '负荷突增' : '发电机跳机'} ${f(fr.eventMW, 0)} MW · ${fr.agc ? 'AGC 投入' : '仅一次调频'}</div></div><span class="result-badge ${fr.stable ? '' : fr.recovered ? 'neutral' : 'fail'}">${fr.stable ? '频率恢复' : fr.recovered ? '恢复但最低频率越限' : '频率未恢复'}</span></div><div class="card-body"><div class="metrics" style="margin-bottom:10px"><div class="metric ${fr.nadirOk ? 'good' : 'bad'}"><div class="m-label">最低频率</div><div class="m-value">${f(fr.minHz, 3)} <small>Hz</small></div><div class="m-foot">初始 RoCoF ${f(fr.rocof, 3)} Hz/s</div></div><div class="metric"><div class="m-label">最终频率</div><div class="m-value">${f(fr.finalHz, 3)} <small>Hz</small></div><div class="m-foot">偏差 ${f(fr.finalDeviation, 3)} Hz</div></div><div class="metric"><div class="m-label">系统惯量 H</div><div class="m-value">${f(fr.Hsys, 2)} <small>s</small></div><div class="m-foot">${f(fr.sysMVA, 0)} MVA 在线</div></div><div class="metric"><div class="m-label">旋转备用 / 需量</div><div class="m-value">${f(fr.reserve, 0)} <small>MW</small></div><div class="m-foot">扰动 ${f(fr.eventMW, 0)} MW · AGC ${f(fr.agcMW, 0)} MW</div></div></div>${frequencyChart(fr)}<div class="table-wrap" style="margin-top:10px"><table class="data-table"><thead><tr><th>机组</th><th>H (s)</th><th>调差率</th><th>备用 (MW)</th><th>一次调频分配</th><th>AGC 分配</th></tr></thead><tbody>${fr.governorRows.map((g) => `<tr><td><div class="name-cell">${esc(g.tag)}</div><div class="cell-sub">${esc(g.name)}</div></td><td class="num">${f(g.inertia, 1)}</td><td class="num">${f(g.droop, 1)}%</td><td class="num">${f(g.reserve, 0)}</td><td class="num">${f(g.primaryShare * fr.eventMW, 0)} MW</td><td class="num">${f(g.agcShare * Math.min(fr.reserve, fr.eventMW), 0)} MW</td></tr>`).join('')}</tbody></table></div><div class="method-note" style="margin-top:9px">${icon('flask', 12)} ${fr.notes.join(' ')}</div></div></div>` : '';
    main = `<div class="analysis-main"><div class="analysis-inner"><div class="analysis-topbar"><div class="analysis-title"><div class="eyebrow">VOLTAGE / FREQUENCY REGULATION</div><h1>电压与频率调节系统</h1><p>目标电压 ${opt.targetMin}–${opt.targetMax} pu · 频率 ${fr ? `${f(fr.minHz, 2)}–${f(fr.finalHz, 2)} Hz` : '待仿真'}</p></div><div class="analysis-top-actions"><button class="btn btn-sm" data-action="reg-voltage">${icon('target', 13)} 电压平衡</button><button class="btn btn-sm btn-primary" data-action="reg-frequency">${icon('wave', 13)} 频率仿真</button></div></div>${voltage}${freq}</div></div>`;
  }
  return `<div class="analysis-shell">${side}${main}</div>`;
}

export function bindRegulation(root, app) {
  root.querySelectorAll('[data-reg-option]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.regOption;
      let value = el.value;
      if (el.type === 'number') value = Number(value);
      if (value === '' || (typeof value === 'number' && !Number.isFinite(value))) return;
      app.regulationOptions[key] = value;
      if (key === 'targetMin' || key === 'targetMax') app.voltageBalanceResult = null;
      else app.frequencyResult = null;
      app.rerender();
    });
  });
  root.querySelector('[data-action="reg-toggle-agc"]')?.addEventListener('click', () => {
    app.regulationOptions.agc = !app.regulationOptions.agc;
    app.frequencyResult = null;
    app.rerender();
  });
  root.querySelectorAll('[data-action="reg-voltage"]').forEach((b) => b.addEventListener('click', () => app.runVoltageRegulation()));
  root.querySelectorAll('[data-action="reg-frequency"]').forEach((b) => b.addEventListener('click', () => app.runFrequencyRegulation()));
  root.querySelectorAll('[data-action="reg-apply"]').forEach((b) => b.addEventListener('click', () => app.applyVoltageBalance()));
}
