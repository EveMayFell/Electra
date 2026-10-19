import { icon } from './icons.js';
import { ALGORITHMS } from '../engine/powerflow.js';
import { voltageProfileChart, convergenceChart, emptyChart } from './charts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
const classFor = (v, warn, bad) => (v > bad ? 'bad' : v > warn ? 'warn' : 'ok');

export function renderAnalysis(app) {
  const opt = app.analysisOptions;
  const result = app.results;
  const algo = ALGORITHMS.find((a) => a.id === opt.algorithm) || ALGORITHMS[0];
  const base = app.project.meta.baseMVA || 100;
  const side = `<aside class="analysis-side">
    <div class="side-section">
      <div class="side-label">求解算法</div>
      <div class="algo-list">
        ${ALGORITHMS.map((a) => `<button class="algo-item ${a.id === opt.algorithm ? 'active' : ''}" data-algo="${a.id}">
          <span class="algo-radio"></span>
          <span class="algo-copy"><span class="algo-name">${esc(a.label)} ${a.badge ? `<span class="algo-badge">${a.badge}</span>` : ''}</span><span class="algo-desc">${esc(a.sub)}</span></span>
        </button>`).join('')}
      </div>
    </div>
    <div class="side-section">
      <div class="side-label">计算控制</div>
      <div class="param-panel">
        <div class="param-row"><span class="pl">收敛精度</span><span class="pv"><input class="mini-input" data-option="tol" type="number" step="0.0000001" min="1e-12" value="${opt.tol}"><span class="mini-unit">pu</span></span></div>
        <div class="param-row"><span class="pl">最大迭代</span><span class="pv"><input class="mini-input" data-option="maxIter" type="number" min="1" max="500" value="${opt.maxIter}"><span class="mini-unit">次</span></span></div>
        <div class="param-row"><span class="pl">阻尼系数</span><span class="pv"><input class="mini-input" data-option="damping" type="number" step="0.05" min="0.1" max="1" value="${opt.damping}"><span class="mini-unit"></span></span></div>
        <div class="param-row"><span class="pl">基准容量</span><span class="pv"><span class="mono" style="font-size:10px;color:var(--text-soft)">${base}</span><span class="mini-unit">MVA</span></span></div>
        <div class="switch-row compact" style="margin-top:3px">
          <span class="switch-label" style="font-size:9px">校核 PV 无功限值</span>
          <button class="toggle ${opt.qLimits ? 'on' : ''}" data-action="toggle-qlimits"></button>
        </div>
      </div>
    </div>
    <div class="analysis-cta">
      <button class="btn btn-primary" data-action="analysis-run">${icon('play', 14)} 运行潮流计算 <span class="kbd">Ctrl ↵</span></button>
      <button class="btn" data-action="analysis-ybus">${icon('matrix', 14)} 一键生成 Ybus</button>
      <button class="btn" data-action="analysis-jacobian">${icon('layers', 14)} 雅可比矩阵集</button>
      <button class="btn" data-action="analysis-compare">${icon('swap', 14)} 多算法对比</button>
      <button class="btn" data-action="analysis-n1">${icon('shieldAlert', 14)} N-1 静态安全扫描</button>
      <button class="btn" data-action="analysis-opt-loss">${icon('sliders', 14)} 网损 / 分接头优化</button>
      <button class="btn" data-action="analysis-opt-cost">${icon('sparkles', 14)} 成本优化 / 简化 OPF</button>
      <button class="btn" data-action="analysis-scenarios">${icon('layers', 14)} 运行场景管理</button>
      <button class="btn" data-action="analysis-examples">${icon('flask', 14)} 示例电网库</button>
    </div>
    <div class="side-note">当前算法：<b class="accent">${esc(algo.label)}</b><br>计算在浏览器本地完成，参数不会上传服务器。分布参数线路自动按长线等效 π 电路处理。</div>
  </aside>`;

  let main;
  if (!result) {
    main = `<div class="analysis-main"><div class="analysis-inner">
      <div class="analysis-topbar"><div class="analysis-title"><div class="eyebrow">POWER FLOW ANALYSIS</div><h1>潮流分析</h1><p>节点导纳矩阵、雅可比矩阵与多种求解器的一体化工作台。</p></div>
        <div class="analysis-top-actions"><span class="result-badge neutral"><span class="dot"></span>等待计算</span></div></div>
      <div class="card" style="min-height:510px;display:grid;place-items:center">
        <div class="empty-state" style="padding:50px 30px">
          <div class="es-icon">${icon('waveform', 32)}</div>
          <h2>尚未运行潮流计算</h2>
          <p>选择算法与收敛参数后运行计算。你也可以先一键生成 Ybus，检查节点导纳矩阵与网络连接是否正确。</p>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" data-action="analysis-run">${icon('play', 14)} 开始计算</button>
            <button class="btn" data-action="analysis-ybus">${icon('matrix', 14)} 查看 Ybus</button>
          </div>
        </div>
      </div>
      <div class="grid-3 section-gap">
        <div class="card"><div class="card-body"><div class="section-title">节点导纳矩阵</div><div class="hint" style="color:var(--muted);line-height:1.7">由线路、变压器、并联补偿及线路充电共同组集，自动合并闭合开关节点。</div></div></div>
        <div class="card"><div class="card-body"><div class="section-title">牛顿-拉夫逊</div><div class="hint" style="color:var(--muted);line-height:1.7">极坐标完整雅可比，二次收敛；可查看 H/N/M/L 分块矩阵。</div></div></div>
        <div class="card"><div class="card-body"><div class="section-title">PQ 分解</div><div class="hint" style="color:var(--muted);line-height:1.7">XB / BX 两种方案，快速解耦，适合大规模输电网反复计算。</div></div></div>
      </div>
    </div></div>`;
  } else {
    const r = result;
    const maxLoading = Math.max(0, ...r.branchResults.map((b) => b.loading || 0));
    const qViol = r.qLimitViolations?.length || 0;
    const dc = r.dc;
    const busRows = r.busResults.map((b) => {
      const bad = b.Vm < 0.95 || b.Vm > 1.05;
      const rowCls = bad ? 'row-warn' : '';
      return `<tr class="${rowCls}">
        <td><div class="name-cell">${esc(b.name)}</div><div class="cell-sub">${esc(b.tag)} · Node ${b.nodeIndex + 1}</div></td>
        <td><span class="status-pill ${b.type === 'slack' ? 'warn' : b.type === 'PV' ? 'ok' : 'neutral'}">${b.type}</span></td>
        <td class="num">${f(b.Vm, 5)}</td>
        <td class="num">${f(b.Va, 3)}</td>
        <td class="num">${f(b.VkV, 2)}</td>
        <td class="num">${f(b.pGen, 2)}</td>
        <td class="num">${b.qGen == null ? '—' : f(b.qGen, 2)}</td>
        <td class="num">${f(b.pLoad, 1)}</td>
        <td class="num">${f(b.qLoad, 1)}</td>
        <td><span class="value-pill ${bad ? 'warn' : 'ok'}">${f(b.Vm, 4)} pu</span></td>
      </tr>`;
    }).join('');
    const branchRows = r.branchResults.map((b) => {
      const cls = b.loading > 100 ? 'row-bad' : b.loading > 80 ? 'row-warn' : '';
      return `<tr class="${cls}">
        <td><div class="name-cell">${esc(b.name)}</div><div class="cell-sub">${esc(b.tag)} · ${esc(b.type === 'transformer' ? '变压器' : b.type === 'line' ? '线路' : b.type)}</div></td>
        <td><div class="cell-sub">${esc(b.fromName)} → ${esc(b.toName)}</div></td>
        <td class="num">${f(b.pFrom, 2)}</td>
        <td class="num">${f(b.qFrom, 2)}</td>
        <td class="num">${f(b.pTo, 2)}</td>
        <td class="num">${f(b.qTo, 2)}</td>
        <td class="num">${f(b.pLoss, 3)}</td>
        <td class="num">${f(b.qLoss, 3)}</td>
        <td class="num">${f(b.current, 3)}</td>
        <td><div class="load-bar"><span class="mono">${f(b.loading, 1)}%</span><span class="bar"><span class="${b.loading > 100 ? 'bad' : b.loading > 80 ? 'warn' : ''}" style="width:${Math.min(100, b.loading)}%"></span></span></div></td>
      </tr>`;
    }).join('');
    const checks = [];
    if (r.converged) checks.push({ level: 'ok', msg: `潮流在 ${r.iterations} 次迭代内收敛，最大不平衡量 ${r.mismatch.toExponential(2)} pu。` });
    else checks.push({ level: 'bad', msg: `潮流未收敛（最大不平衡量 ${r.mismatch.toExponential(2)} pu），请检查参数或增大迭代次数。` });
    if (!r.violations.length) checks.push({ level: 'ok', msg: `全部母线电压在 0.95–1.05 pu 范围内，最低 ${f(r.vMin, 4)} pu。` });
    else checks.push({ level: 'warn', msg: `${r.violations.length} 个母线电压越限：${r.violations.map((b) => `${b.tag} ${b.Vm.toFixed(4)}`).join('、')}。` });
    if (!r.overloads.length) checks.push({ level: 'ok', msg: `全部支路负载率不超过 100%，最大 ${f(maxLoading, 1)}%。` });
    else checks.push({ level: 'bad', msg: `${r.overloads.length} 条支路过载：${r.overloads.map((b) => `${b.tag} ${b.loading.toFixed(1)}%`).join('、')}。` });
    if (qViol) checks.push({ level: 'warn', msg: `${qViol} 个 PV 节点发电机无功越限，建议调整电压设定或无功限值。` });
    if (r.qLimitActions?.length) checks.push({ level: 'warn', msg: `${r.qLimitActions.length} 个 PV 节点无功越限并已按限值转为 PQ：${r.qLimitActions.map((x) => x.busName).join('、')}。` });
    if (dc) checks.push({ level: 'warn', msg: '直流潮流仅计算有功—相角关系，电压幅值固定为 1.0 pu，结果中无功与损耗不参与校核。' });

    main = `<div class="analysis-main"><div class="analysis-inner">
      <div class="analysis-topbar">
        <div class="analysis-title">
          <div class="eyebrow">POWER FLOW RESULTS</div>
          <h1>潮流分析 <span class="result-badge ${r.converged ? '' : 'fail'}"><span class="dot"></span>${r.converged ? '已收敛' : '未收敛'}</span></h1>
          <p>${esc(r.label)} · 基准 ${r.net.baseMVA} MVA · ${r.net.nodes.length} 节点 / ${r.branchResults.length} 支路 · ${f(r.elapsedMs, 1)} ms</p>
        </div>
        <div class="analysis-top-actions">
          <button class="btn btn-sm" data-action="analysis-ybus">${icon('matrix', 13)} Ybus</button>
          <button class="btn btn-sm" data-action="analysis-jacobian">${icon('layers', 13)} 雅可比</button>
          <button class="btn btn-sm" data-action="analysis-export">${icon('download', 13)} 导出</button>
          <button class="btn btn-sm btn-primary" data-action="analysis-run">${icon('play', 13)} 重新计算</button>
        </div>
      </div>
      <div class="metrics">
        <div class="metric ${r.converged ? 'good' : 'bad'}"><div class="m-label">${icon('check', 11)} 收敛状态</div><div class="m-value">${r.converged ? 'CONVERGED' : 'FAILED'}</div><div class="m-foot">${r.iterations} 次迭代 · 精度 ${r.mismatch.toExponential(2)} pu${r.totalIterations && r.totalIterations !== r.iterations ? ` · 含无功切换共 ${r.totalIterations} 次` : ''}</div></div>
        <div class="metric accent-metric"><div class="m-label">${icon('waveform', 11)} 总有功损耗</div><div class="m-value">${f(r.totals.lossP, 3)} <small>MW</small></div><div class="m-foot">损耗率 ${f(r.totals.lossP / Math.max(1, r.totals.pLoad) * 100, 2)}% · 无功损耗 ${f(r.totals.lossQ, 2)} Mvar</div></div>
        <div class="metric ${r.vMin < 0.95 ? 'warn' : ''}"><div class="m-label">${icon('chart', 11)} 最低电压</div><div class="m-value">${f(r.vMin, 4)} <small>pu</small></div><div class="m-foot">最高 ${f(r.vMax, 4)} pu · ${r.violations.length} 个越限</div></div>
        <div class="metric ${maxLoading > 100 ? 'bad' : maxLoading > 80 ? 'warn' : ''}"><div class="m-label">${icon('bolt', 11)} 最大负载率</div><div class="m-value">${f(maxLoading, 1)} <small>%</small></div><div class="m-foot">${r.overloads.length} 条支路过载 · ${r.branchResults.length} 条支路</div></div>
      </div>
      ${!r.converged ? `<div class="notice-strip" style="margin-bottom:11px">${icon('warning', 13)} 未收敛结果仅供参考。可尝试增大迭代次数、降低阻尼系数，或检查 PV/平衡节点设置。</div>` : ''}
      <div class="grid-2">
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('chart', 15)} 母线电压分布</div><div class="card-sub">0.90–1.10 pu，绿色带为允许范围</div></div><span class="result-badge neutral">${r.violations.length} 越限</span></div><div class="card-body" style="padding:10px 12px 4px"><div class="chart-wrap">${voltageProfileChart(r.busResults)}</div><div class="legend-row" style="padding:2px 4px 4px"><span class="lg"><span class="sw dot" style="background:#7bf0d6"></span>正常</span><span class="lg"><span class="sw dot" style="background:#ffbd66"></span>越限</span><span class="lg"><span class="sw" style="background:rgba(76,224,195,.35);height:8px"></span>0.95–1.05 pu</span></div></div></div>
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('wave', 15)} 收敛过程</div><div class="card-sub">最大功率不平衡量随迭代变化（对数坐标）</div></div><span class="result-badge neutral">tol ${r.options.tol}</span></div><div class="card-body" style="padding:10px 12px 4px"><div class="chart-wrap">${convergenceChart(r.history)}</div><div class="legend-row" style="padding:2px 4px 4px"><span class="lg"><span class="sw dot" style="background:#ffbd66"></span>max|ΔP,ΔQ|</span><span class="lg">最终 ${r.mismatch.toExponential(2)} pu</span></div></div></div>
      </div>
      <div class="grid-2 section-gap">
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('database', 15)} 功率平衡</div><div class="card-sub">计算结果汇总</div></div></div><div class="card-body">
          <div class="derived-grid" style="grid-template-columns:repeat(3,1fr);gap:12px">
            <div class="d-item"><div class="d-label">发电机有功</div><div class="d-val" style="font-size:13px">${f(r.totals.pGen, 2)} MW</div></div>
            <div class="d-item"><div class="d-label">负荷有功</div><div class="d-val" style="font-size:13px">${f(r.totals.pLoad, 2)} MW</div></div>
            <div class="d-item"><div class="d-label">有功损耗</div><div class="d-val accent" style="font-size:13px">${f(r.totals.lossP, 3)} MW</div></div>
            <div class="d-item"><div class="d-label">发电机无功</div><div class="d-val" style="font-size:13px">${dc ? '—' : `${f(r.totals.qGen, 2)} Mvar`}</div></div>
            <div class="d-item"><div class="d-label">负荷无功</div><div class="d-val" style="font-size:13px">${f(r.totals.qLoad, 2)} Mvar</div></div>
            <div class="d-item"><div class="d-label">无功补偿</div><div class="d-val" style="font-size:13px">${f(r.totals.shuntQ, 2)} Mvar</div></div>
          </div>
          <div class="method-note" style="margin-top:12px">${icon('info', 12)} ${dc ? '直流潮流忽略网损与无功，功率平衡仅用于有功校核。' : `有功平衡残差 ${r.totals.pBalance.toExponential(2)} MW；无功平衡残差 ${r.totals.qBalance.toExponential(2)} Mvar。`}</div>
        </div></div>
        <div class="card"><div class="card-head"><div><div class="card-title">${icon('shield', 15)} 运行校核</div><div class="card-sub">电压、支路与无功限值</div></div><span class="result-badge ${checks.some((c) => c.level === 'bad') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'neutral' : ''}">${checks.filter((c) => c.level !== 'ok').length} 项关注</span></div><div class="card-body" style="padding:11px 13px">
          <div class="check-list">${checks.map((c) => `<div class="check-row ${c.level}">${icon(c.level === 'ok' ? 'check' : c.level === 'bad' ? 'x' : 'warning', 13)}<span class="check-main">${esc(c.msg)}</span></div>`).join('')}</div>
        </div></div>
      </div>
      <div class="card section-gap">
        <div class="card-head"><div><div class="card-title">${icon('bus', 15)} 节点电压与注入</div><div class="card-sub">共 ${r.busResults.length} 个母线节点 · 标幺值基于各节点基准电压</div></div><div class="card-actions"><button class="btn btn-sm" data-action="analysis-ybus">${icon('matrix', 12)} 查看 Ybus</button></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>母线</th><th>类型</th><th>V (pu)</th><th>θ (°)</th><th>kV</th><th>P_gen</th><th>Q_gen</th><th>P_load</th><th>Q_load</th><th>状态</th></tr></thead><tbody>${busRows}</tbody></table></div>
      </div>
      <div class="card section-gap">
        <div class="card-head"><div><div class="card-title">${icon('line', 15)} 支路潮流与损耗</div><div class="card-sub">首端 / 末端功率、损耗、电流与热稳定负载率</div></div><div class="card-actions"><button class="btn btn-sm" data-action="analysis-jacobian">${icon('layers', 12)} 雅可比矩阵</button></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>支路</th><th>方向</th><th>P 首 (MW)</th><th>Q 首 (Mvar)</th><th>P 末 (MW)</th><th>Q 末 (Mvar)</th><th>ΔP (MW)</th><th>ΔQ (Mvar)</th><th>I (kA)</th><th>负载率</th></tr></thead><tbody>${branchRows}</tbody></table></div>
      </div>
      <div class="method-note" style="margin-top:11px">${icon('flask', 12)} 结果说明：支路功率以流入支路为正；损耗为两端复功率之和。线路负载率按热稳定容量，变压器按额定容量计算。</div>
    </div></div>`;
  }
  return `<div class="analysis-shell">${side}${main}</div>`;
}

export function bindAnalysis(root, app) {
  root.querySelectorAll('[data-algo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.analysisOptions.algorithm = btn.dataset.algo;
      if (btn.dataset.algo === 'gs' && app.analysisOptions.maxIter < 80) app.analysisOptions.maxIter = 150;
      app.rerender();
    });
  });
  root.querySelectorAll('[data-option]').forEach((input) => {
    input.addEventListener('change', () => {
      const k = input.dataset.option;
      const v = k === 'maxIter' ? Math.max(1, Math.round(Number(input.value) || 30)) : Number(input.value);
      if (Number.isFinite(v)) app.analysisOptions[k] = v;
    });
  });
  const act = (name, fn) => root.querySelectorAll(`[data-action="${name}"]`).forEach((b) => b.addEventListener('click', fn));
  act('analysis-run', () => app.runAnalysis());
  act('analysis-ybus', () => app.openYbus());
  act('analysis-jacobian', () => app.openJacobian());
  act('analysis-export', () => app.exportResultsCSV());
  act('analysis-compare', () => app.compareAlgorithms());
  act('analysis-n1', () => app.runN1Analysis());
  act('analysis-opt-loss', () => app.runOptimizationAnalysis('loss'));
  act('analysis-opt-cost', () => app.runOptimizationAnalysis('cost'));
  act('analysis-scenarios', () => app.openScenarioManager());
  act('analysis-examples', () => app.openExamples());
  act('toggle-qlimits', () => { app.analysisOptions.qLimits = !app.analysisOptions.qLimits; app.rerender(); });
}
