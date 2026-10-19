import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));

export function renderShortCircuit(app) {
  const opt = app.scOptions;
  const res = app.shortCircuit;
  const buses = app.project.buses;
  if (!opt.busId && buses.length) opt.busId = buses.find((b) => b.type === 'slack')?.id || buses[0].id;
  const selectedBus = buses.find((b) => b.id === opt.busId);
  const side = `<aside class="sc-side">
    <div class="side-label">故障位置</div>
    <div class="sc-bus-pick">
      ${buses.map((b) => `<button class="sc-bus-option ${opt.busId === b.id ? 'active' : ''}" data-sc-bus="${b.id}">
        <span class="bo-name">${esc(b.name)}</span><span class="bo-kv">${b.vn} kV</span>
      </button>`).join('') || '<div class="hint">尚无母线</div>'}
    </div>
    <div class="side-label" style="margin-top:15px">故障类型</div>
    <div class="segmented" style="grid-auto-flow:row;grid-template-columns:1fr 1fr">
      <button class="${opt.faultType === '3ph' ? 'active' : ''}" data-sc-type="3ph">三相短路</button>
      <button class="${opt.faultType === '2ph' ? 'active' : ''}" data-sc-type="2ph">两相短路</button>
      <button class="${opt.faultType === '1ph' ? 'active' : ''}" data-sc-type="1ph">单相接地</button>
    </div>
    <div class="side-label" style="margin-top:15px">计算条件</div>
    <div class="param-panel">
      <div class="param-row"><span class="pl">电压系数 c</span><span class="pv"><input class="mini-input" data-sc-option="c" type="number" step="0.05" min="0.8" max="1.3" value="${opt.c}"><span class="mini-unit"></span></span></div>
      <div class="param-row"><span class="pl">系统短路容量</span><span class="pv"><input class="mini-input" data-sc-option="sourceMVA" type="number" step="100" min="10" value="${opt.sourceMVA}"><span class="mini-unit">MVA</span></span></div>
      <div class="param-row"><span class="pl">故障阻抗</span><span class="pv"><input class="mini-input" data-sc-option="faultImpedanceOhm" type="number" step="0.01" min="0" value="${opt.faultImpedanceOhm || 0}"><span class="mini-unit">Ω</span></span></div>
    </div>
    <div class="switch-row compact" style="margin-top:8px">
      <span class="switch-label" style="font-size:9px">计入电动机反馈</span>
      <button class="toggle ${opt.includeMotors !== false ? 'on' : ''}" data-action="toggle-sc-motors"></button>
    </div>
    <div class="analysis-cta">
      <button class="btn btn-primary" data-action="sc-run">${icon('bolt', 14)} 计算短路电流</button>
      <button class="btn" data-action="sc-scan">${icon('layers', 14)} 全网短路扫描</button>
      <button class="btn" data-action="sc-use-protection" ${res ? '' : 'disabled'}>${icon('shield', 14)} 代入保护校验</button>
    </div>
    <div class="side-note">采用正序网络与 IEC 60909 简化方法。外部系统以短路容量等值，发电机以次暂态电抗等值，负荷忽略。结果用于方案阶段设备与保护初筛。</div>
  </aside>`;

  let main;
  if (!res) {
    main = `<div class="sc-main"><div class="sc-inner">
      <div class="sc-head"><div><div class="analysis-title"><div class="eyebrow">SHORT-CIRCUIT STUDY</div><h1>短路电流校验</h1><p>${selectedBus ? `当前故障点：${esc(selectedBus.name)}（${selectedBus.vn} kV）` : '请选择故障母线'}</p></div></div><span class="result-badge neutral"><span class="dot"></span>等待计算</span></div>
      <div class="card" style="min-height:520px;display:grid;place-items:center"><div class="empty-state" style="padding:45px 30px"><div class="es-icon">${icon('bolt', 32)}</div><h2>建立故障点等值阻抗</h2><p>在左侧选择故障母线与故障类型，程序将通过节点导纳矩阵求取戴维南等值阻抗 Z<sub>th</sub>，并计算短路电流、冲击电流及母线电压暂降。</p><button class="btn btn-primary" data-action="sc-run">${icon('play', 14)} 开始计算</button></div></div>
      <div class="grid-3 section-gap"><div class="card"><div class="card-body"><div class="section-title">三相短路</div><p class="hint" style="color:var(--muted);line-height:1.65">对称故障，I″k = c·U<sub>n</sub>/(√3·Z<sub>th</sub>)，用于断路器开断能力与动热稳定初筛。</p></div></div><div class="card"><div class="card-body"><div class="section-title">两相短路</div><p class="hint" style="color:var(--muted);line-height:1.65">按 Z₂≈Z₁ 近似，I″k 约为三相短路的 0.866 倍，用于保护灵敏度校核。</p></div></div><div class="card"><div class="card-body"><div class="section-title">电压暂降</div><p class="hint" style="color:var(--muted);line-height:1.65">由故障点转移阻抗求各母线残压，可评估低电压穿越与保护配合。</p></div></div></div>
    </div></div>`;
  } else {
    const k = res;
    const is1ph = k.faultType === '1ph';
    const maxContrib = Math.max(1, ...k.branchCurrents.map((b) => b.contribution || 0));
    const dips = [...k.busVoltages].sort((a, b) => b.dip - a.dip);
    main = `<div class="sc-main"><div class="sc-inner">
      <div class="sc-head"><div><div class="analysis-title"><div class="eyebrow">SHORT-CIRCUIT RESULTS</div><h1>短路电流校验 <span class="result-badge ${k.faultType === '2ph' || is1ph ? 'neutral' : 'fail'}"><span class="dot"></span>${k.faultTypeLabel}</span></h1><p>${esc(k.busName)} · ${k.baseKV} kV · c = ${k.c} · 系统短路容量 ${k.sourceMVA} MVA · ${k.notes.length} 条计算说明${is1ph ? ` · 故障相 A · 零序 ${f(k.sequence?.i0kA, 2)} kA` : ''}</p></div></div><div class="sc-actions"><button class="btn btn-sm" data-action="sc-scan">${icon('layers', 13)} 全网扫描</button><button class="btn btn-sm" data-action="sc-export">${icon('download', 13)} 导出</button><button class="btn btn-sm btn-primary" data-action="sc-run">${icon('play', 13)} 重新计算</button></div></div>
      <div class="sc-summary">
        <div class="fault-hero">
          <div class="fh-kicker">INITIAL SYMMETRICAL SHORT-CIRCUIT CURRENT</div>
          <div class="fh-value">${f(k.Ik, 2)} <small>kA</small></div>
          <div class="fh-sub">${esc(k.busTag)} · ${esc(k.faultTypeLabel)} · 故障点 ${esc(k.busName)}</div>
          <div class="fh-meta">
            <div class="item"><div class="l">短路容量 S″k</div><div class="v">${f(k.Sk, 0)} MVA</div></div>
            <div class="item"><div class="l">冲击电流 i<sub>p</sub></div><div class="v">${f(k.ip, 2)} kA</div></div>
            <div class="item"><div class="l">等值阻抗 Z<sub>th</sub></div><div class="v">${f(k.zThOhm, 3)} Ω</div></div>
            <div class="item"><div class="l">X/R</div><div class="v">${Number.isFinite(k.xr) ? f(k.xr, 1) : '∞'}</div></div>
          </div>
        </div>
        <div class="sc-meta-card">
          <div class="sc-meta-item"><div class="l">故障点基准电压</div><div class="v">${k.baseKV}<small>kV</small></div></div>
          <div class="sc-meta-item"><div class="l">基准电流</div><div class="v">${f(k.Ibase, 2)}<small>kA</small></div></div>
          <div class="sc-meta-item"><div class="l">等值电阻 R<sub>th</sub></div><div class="v">${f(k.rTh, 3)}<small>Ω</small></div></div>
          <div class="sc-meta-item"><div class="l">等值电抗 X<sub>th</sub></div><div class="v">${f(k.xTh, 3)}<small>Ω</small></div></div>
          <div class="sc-meta-item"><div class="l">故障电流相角</div><div class="v">${f(k.ifAngleDeg, 1)}<small>°</small></div></div>
          <div class="sc-meta-item"><div class="l">故障阻抗</div><div class="v">${f(k.faultImpedanceOhm, 2)}<small>Ω</small></div></div>
          <div class="sc-meta-item"><div class="l">母线短路耐受</div><div class="v">${selectedBus?.scRating ? `${f(selectedBus.scRating, 1)}<small>kA</small>` : '—'}</div></div>
          <div class="sc-meta-item"><div class="l">开断能力校核</div><div class="v" style="color:${selectedBus?.scRating && k.Ik > selectedBus.scRating ? 'var(--red)' : 'var(--green)'}">${selectedBus?.scRating ? (k.Ik <= selectedBus.scRating + 1e-9 ? '通过' : '超出耐受') : '未设置'}</div></div>
          ${is1ph ? `<div class="sc-meta-item"><div class="l">零序等值阻抗 Z₀</div><div class="v">${f(k.sequence?.z0Ohm, 3)}<small>Ω</small></div></div>
          <div class="sc-meta-item"><div class="l">正序 / 零序电流</div><div class="v">${f(k.sequence?.i1kA, 2)} / ${f(k.sequence?.i0kA, 2)}<small>kA</small></div></div>` : ''}
        </div>
      </div>
      ${selectedBus?.scRating && k.Ik > selectedBus.scRating + 1e-9 ? `<div class="notice-strip" style="margin-bottom:11px">${icon('warning', 13)} 故障点短路电流 ${f(k.Ik, 2)} kA 已超过母线短路耐受 ${f(selectedBus.scRating, 1)} kA，请校核母线、断路器与开关柜动热稳定能力。</div>` : ''}
      <div class="grid-2">
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('chart', 15)} 母线电压暂降</div><div class="card-sub">${is1ph ? '故障相（A 相）残压（pu）' : '故障期间正序残压（pu）'}</div></div><span class="result-badge neutral">${dips.filter((b) => b.dip > 10).length} 个节点 &gt;10%</span></div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>母线</th><th>电压等级</th><th>V (pu)</th><th>残压 (kV)</th><th>暂降</th></tr></thead><tbody>
          ${dips.map((b) => `<tr class="${b.isFault ? 'row-bad' : b.dip > 50 ? 'row-warn' : ''}"><td><div class="name-cell">${esc(b.name)}${b.isFault ? ' <span class="status-pill bad">故障点</span>' : ''}</div><div class="cell-sub">${esc(b.tag)}</div></td><td>${b.vn} kV</td><td class="num">${f(b.vpu, 4)}</td><td class="num">${f(b.vkV, 2)}</td><td><div class="load-bar"><span class="mono">${f(b.dip, 1)}%</span><span class="voltage-dip-bar"><span style="width:${Math.min(100, b.dip)}%;background:${b.dip > 50 ? 'var(--red)' : 'var(--amber)'}"></span></span></div></td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="card"><div class="card-head"><div><div class="card-title">${icon(is1ph ? 'layers' : 'bolt', 15)} ${is1ph ? '序网等值参数' : '故障电流来源'}</div><div class="card-sub">${is1ph ? '正序 / 负序 / 零序网络结果' : '各电源等值注入（kA，按本侧电压等级）'}</div></div></div><div class="card-body">
          ${is1ph ? `<div class="derived-grid" style="grid-template-columns:repeat(2,1fr);gap:12px">
            <div class="d-item"><div class="d-label">Z₁ = Z₂</div><div class="d-val accent">${f(k.sequence?.z1Pu?.re, 4)} ${k.sequence?.z1Pu?.im >= 0 ? '+' : '−'} j${f(Math.abs(k.sequence?.z1Pu?.im || 0), 4)} pu</div></div>
            <div class="d-item"><div class="d-label">Z₀</div><div class="d-val">${f(k.sequence?.z0Ohm, 3)} Ω</div></div>
            <div class="d-item"><div class="d-label">I₁ = I₂</div><div class="d-val">${f(k.sequence?.i1kA, 3)} kA</div></div>
            <div class="d-item"><div class="d-label">I₀</div><div class="d-val">${f(k.sequence?.i0kA, 3)} kA</div></div>
            <div class="d-item"><div class="d-label">故障相电流 3I₀</div><div class="d-val amber">${f(k.Ik, 2)} kA</div></div>
            <div class="d-item"><div class="d-label">计算方法</div><div class="d-val">对称分量法</div></div>
          </div>
          <div class="method-note" style="margin-top:12px">${icon('info', 12)} 单相接地电流由 Z₁+Z₂+Z₀ 决定；Z₂ 取与 Z₁ 相同。零序网络包含线路零序参数、2W 变压器零序通路及发电机中性点接地阻抗；三绕组零序暂按阻断。</div>
          ${(k.zeroSeqWarnings || []).length ? `<div class="check-list" style="margin-top:8px">${k.zeroSeqWarnings.map((w) => `<div class="check-row warn">${icon('warning', 13)}<span class="check-main">${esc(w)}</span></div>`).join('')}</div>` : ''}`
          : `<div class="contrib-rank">
            ${k.sources.length ? k.sources.sort((a, b) => b.current - a.current).map((s) => `<div class="cr-row"><span class="cr-name" title="${esc(s.name)}">${esc(s.name)}</span><span class="cr-bar"><span style="width:${Math.max(2, s.current / Math.max(...k.sources.map((x) => x.current)) * 100)}%"></span></span><span class="cr-val">${f(s.current, 2)} kA</span></div>`).join('') : '<div class="hint">未识别到等值电源</div>'}
          </div>
          <div class="derived-grid" style="margin-top:13px;grid-template-columns:repeat(2,1fr)">
            <div class="d-item"><div class="d-label">外部系统等值</div><div class="d-val">${f(k.sourceMVA, 0)} MVA</div></div>
            <div class="d-item"><div class="d-label">计算方法</div><div class="d-val">IEC 60909 简化</div></div>
          </div>`}
        </div></div>
      </div>
      <div class="grid-2 section-gap">
        ${is1ph ? `<div class="card"><div class="card-head"><div><div class="card-title">${icon('layers', 15)} 单相接地序网</div><div class="card-sub">对称分量法 · Z₂≈Z₁</div></div></div><div class="card-body">
          <div class="formula-box">I₁ = I₂ = I₀ = c·U<sub>n</sub>/(Z₁+Z₂+Z₀+3Z<sub>f</sub>)<br>I<sub>f,A</sub> = 3I₀<br>Z₁ = ${f(k.zThOhm, 3)} Ω，Z₀ = ${f(k.sequence?.z0Ohm, 3)} Ω</div>
          <div class="check-list" style="margin-top:11px">
            <div class="check-row ${k.Ik < 0.001 ? 'warn' : 'ok'}">${icon(k.Ik < 0.001 ? 'warning' : 'check', 13)}<span class="check-main">${k.Ik < 0.001 ? '单相接地电流接近零：该母线缺少有效零序接地通路。' : '零序网络形成了有效接地通路。'}</span><span class="check-val">3I₀ = ${f(k.Ik, 3)} kA</span></div>
          </div>
          <div class="hint" style="color:var(--dim);margin-top:8px;line-height:1.6">单相结果暂不分解各支路相电流，请使用母线残压、序电流与设备耐受进行初筛。零序参数可在设备属性中修改。</div>
        </div></div>` : `<div class="card"><div class="card-head"><div><div class="card-title">${icon('line', 15)} 支路故障电流</div><div class="card-sub">流向故障点的支路电流，按容量排序</div></div></div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>支路</th><th>方向</th><th>首端 (kA)</th><th>末端 (kA)</th><th>贡献</th></tr></thead><tbody>
          ${k.branchCurrents.slice(0, 14).map((b) => `<tr><td><div class="name-cell">${esc(b.name)}</div><div class="cell-sub">${esc(b.tag)}</div></td><td class="cell-sub">${esc(b.fromName)} → ${esc(b.toName)}</td><td class="num">${f(b.iFrom, 2)}</td><td class="num">${f(b.iTo, 2)}</td><td><div class="load-bar"><span class="bar"><span style="width:${Math.min(100, b.contribution / maxContrib * 100)}%"></span></span><span class="mono">${f(b.contribution, 2)}</span></div></td></tr>`).join('')}
          </tbody></table></div>
        </div>`}
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('info', 15)} 计算说明与适用边界</div><div class="card-sub">用于方案阶段，不替代设备选型正式计算</div></div></div><div class="card-body">
          <div class="check-list">
            ${k.notes.map((n) => `<div class="check-row">${icon('info', 13)}<span class="check-main">${esc(n)}</span></div>`).join('')}
            <div class="check-row ok">${icon('check', 13)}<span class="check-main">${is1ph ? '正序与零序网络求解成功。' : '节点导纳矩阵与戴维南等值阻抗求解成功。'}</span><span class="check-val">Z<sub>th</sub> = ${f(k.zThOhm, 3)} Ω</span></div>
          </div>
          <div class="formula-box" style="margin-top:11px">${is1ph ? `I₁=I₂=I₀=cU<sub>n</sub>/(Z₁+Z₂+Z₀+3Z<sub>f</sub>)<br>I<sub>f</sub>=3I₀<br>Z₀ = Y₀<sub>bus,kk</sub>⁻¹` : `I″<sub>k</sub> = c·U<sub>n</sub> / (√3·|Z<sub>th</sub>|)<br>i<sub>p</sub> = κ·√2·I″<sub>k</sub>，取 κ = 1.8<br>Z<sub>th</sub> = Z<sub>bus,kk</sub>（由 Y<sub>bus</sub> 求逆列）`}</div>
        </div></div>
      </div>
      <div class="sc-note">${icon('warning', 13)} 本页为方案设计阶段的简化短路计算。正式设备校核应计入零序网络、变压器接线组别、发电机暂态/次暂态参数、电动机反馈、电弧电阻及继电保护动作时间，并按 GB/T 15544 / IEC 60909 完整执行。</div>
    </div></div>`;
  }
  return `<div class="sc-shell">${side}${main}</div>`;
}

export function bindShortCircuit(root, app) {
  root.querySelectorAll('[data-sc-bus]').forEach((b) => b.addEventListener('click', () => {
    if (app.scOptions.busId === b.dataset.scBus) return;
    app.scOptions.busId = b.dataset.scBus;
    app.shortCircuit = null;
    app.rerender();
  }));
  root.querySelectorAll('[data-sc-type]').forEach((b) => b.addEventListener('click', () => {
    if (app.scOptions.faultType === b.dataset.scType) return;
    app.scOptions.faultType = b.dataset.scType;
    app.shortCircuit = null;
    app.scanShortCircuitResult = null;
    app.rerender();
  }));
  root.querySelectorAll('[data-sc-option]').forEach((input) => {
    input.addEventListener('change', () => {
      const k = input.dataset.scOption;
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      app.scOptions[k] = k === 'faultImpedanceOhm' ? Math.max(0, v) : v;
      app.shortCircuit = null;
      app.scanShortCircuitResult = null;
      app.rerender();
    });
  });
  root.querySelector('[data-action="toggle-sc-motors"]')?.addEventListener('click', () => {
    app.scOptions.includeMotors = app.scOptions.includeMotors === false;
    app.shortCircuit = null;
    app.scanShortCircuitResult = null;
    app.rerender();
  });
  const act = (name, fn) => root.querySelectorAll(`[data-action="${name}"]`).forEach((b) => b.addEventListener('click', fn));
  act('sc-run', () => app.runShortCircuitCalculation());
  act('sc-scan', () => app.runShortCircuitScan());
  act('sc-export', () => app.exportShortCircuitCSV());
  act('sc-use-protection', () => {
    if (!app.shortCircuit) return;
    app.protectionFaultCurrent = Math.round(app.shortCircuit.Ik * 1000);
    app.toast('短路电流已应用', `保护校验电流设置为 ${app.protectionFaultCurrent} A。`);
    app.setMode('protection');
  });
}
