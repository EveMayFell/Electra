import { icon } from './icons.js';
import { summarize } from '../model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
const today = () => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export function renderReport(app) {
  const p = app.project;
  const r = app.results;
  const sc = app.shortCircuit;
  const faultBus = sc ? p.buses.find((b) => b.id === sc.busId) : null;
  const scan = app.scanShortCircuitResult;
  const n1 = app.n1Result;
  const sens = app.protectionSensitivity;
  const stab = app.stabilityResult;
  const vbal = app.voltageBalanceResult;
  const freq = app.frequencyResult;
  const cct = app.stabilityCCT;
  const s = summarize(p);
  const protections = p.relays.filter((x) => x.enabled);
  const issueErrors = (app.issues || []).filter((i) => i.level === 'error');
  const h = (n, title) => `<h2><span class="num">${String(n).padStart(2, '0')}</span>${title}</h2>`;
  const diagram = app.lastDiagramSVG ? `<div class="report-diagram" style="border:1px solid #d8e2e9;background:#07111e;border-radius:3px;overflow:hidden;margin:9px 0 5px">${app.lastDiagramSVG.replace(/width="[^"]*" height="[^"]*"/, 'style="width:100%;height:auto;display:block"')}</div><div style="font-size:7.5px;color:#7b8f9e;text-align:center;margin-bottom:8px">图 1　电气一次主接线图（自动生成）</div>` : '<p style="color:#7b8f9e">主接线图尚未导出。请在“主接线设计”视图中查看，或使用导出 SVG 功能插入本报告。</p>';
  const busRows = r ? r.busResults.map((b) => `<tr><td>${esc(b.tag)}</td><td>${esc(b.name)}</td><td>${esc(b.type)}</td><td class="num">${f(b.Vm, 4)}</td><td class="num">${f(b.Va, 2)}</td><td class="num">${f(b.pGen, 2)}</td><td class="num">${b.qGen == null ? '—' : f(b.qGen, 2)}</td><td class="num">${f(b.pLoad, 2)}</td><td class="num">${f(b.qLoad, 2)}</td></tr>`).join('') : '';
  const branchRows = r ? r.branchResults.map((b) => `<tr><td>${esc(b.tag)}</td><td>${esc(b.name)}</td><td>${esc(b.fromName)}—${esc(b.toName)}</td><td class="num">${f(b.pFrom, 2)}</td><td class="num">${f(b.qFrom, 2)}</td><td class="num">${f(b.pLoss, 3)}</td><td class="num">${f(b.qLoss, 3)}</td><td class="num">${f(b.loading, 1)}%</td></tr>`).join('') : '';
  const relayRows = protections.map((rel) => {
    const br = p.branches.find((b) => b.id === rel.branchId);
    const bus = p.buses.find((b) => b.id === rel.busId);
    const dist = br?.type === 'line' ? `Z1 ${f(rel.distance.z1, 2)} / Z2 ${f(rel.distance.z2, 2)} / Z3 ${f(rel.distance.z3, 2)} Ω` : '—';
    const diff = br?.type === 'transformer' ? `${f(rel.differential.pickup, 2)} Ie / 斜率 ${f(rel.differential.slope1, 2)}–${f(rel.differential.slope2, 2)}` : (rel.targetType === 'bus' ? '母差 / 失灵' : '—');
    const fnCount = Object.values(rel.protections || {}).filter((x) => x.enabled !== false).length;
    return `<tr><td>${esc(rel.name)}</td><td>${esc(br?.tag || bus?.tag || '—')}</td><td>${rel.ct.primary}/${rel.ct.secondary}</td><td>${rel.overcurrent ? `${f(rel.overcurrent.pickup, 0)} A` : '—'}</td><td>${rel.overcurrent ? f(rel.overcurrent.tms, 3) : '—'}</td><td>${dist}</td><td>${diff}</td><td class="num">${fnCount}</td></tr>`;
  }).join('');
  const scRows = sc ? sc.busVoltages.filter((b) => b.dip > 10).sort((a, b) => b.dip - a.dip).slice(0, 10).map((b) => `<tr><td>${esc(b.tag)}</td><td>${esc(b.name)}</td><td class="num">${b.vn}</td><td class="num">${f(b.vpu, 4)}</td><td class="num">${f(b.dip, 1)}%</td></tr>`).join('') : '';
  const scanRows = scan ? scan.rows.slice(0, 12).map((b) => b.Ik == null
    ? `<tr><td>${esc(b.tag)}</td><td>${esc(b.name)}</td><td class="num">${b.vn}</td><td colspan="3">${esc(b.error || '计算失败')}</td></tr>`
    : `<tr><td>${esc(b.tag)}</td><td>${esc(b.name)}</td><td class="num">${b.vn}</td><td class="num">${f(b.Ik, 2)}</td><td class="num">${f(b.scRating, 1)}</td><td>${b.ok === false ? '超出耐受' : b.ok ? '通过' : '未设置'}</td></tr>`).join('') : '';
  const scanCallout = scan ? `<div class="report-callout ${scan.summary.exceed ? 'warn' : ''}">全网短路扫描（${esc(scan.summary.faultTypeLabel)}，c=${scan.summary.c}）：共计算 ${scan.summary.tested} 条母线，最大短路电流 ${f(scan.summary.maxIk, 2)} kA（${esc(scan.summary.maxBusTag || '—')}），${scan.summary.exceed} 条母线超出短路耐受值。</div>` : '';
  const scanTable = scan ? `<table class="report-table"><thead><tr><th>编号</th><th>母线</th><th>电压 (kV)</th><th>I″k (kA)</th><th>耐受 (kA)</th><th>校核</th></tr></thead><tbody>${scanRows}</tbody></table>` : '';
  const n1Rows = n1 ? n1.cases.slice(0, 10).map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.tag)}</td><td>${esc(c.label)}</td><td>${c.error ? '失败' : c.converged ? '是' : '否'}</td><td class="num">${c.minV == null ? '—' : f(c.minV, 4)}</td><td class="num">${c.maxLoad == null ? '—' : `${f(c.maxLoad, 1)}%`}</td><td>${esc(c.severity === 'critical' ? '临界' : c.severity === 'severe' ? '严重' : c.severity === 'warning' ? '关注' : '通过')}</td></tr>`).join('') : '';
  const maxLoad = r ? Math.max(0, ...r.branchResults.map((b) => b.loading || 0)) : 0;
  const conclusion = [];
  if (!r) conclusion.push('潮流计算尚未执行，本报告中的运行数据为待补充状态。');
  else {
    conclusion.push(`采用${r.label}完成潮流计算，${r.converged ? `${r.iterations} 次迭代收敛，最大不平衡量 ${r.mismatch.toExponential(2)} pu` : '计算未收敛，需进一步检查参数'}。`);
    conclusion.push(`系统总有功负荷 ${f(r.totals.pLoad, 1)} MW，总有功损耗 ${f(r.totals.lossP, 2)} MW，最低母线电压 ${f(r.vMin, 4)} pu，最高负载率 ${f(maxLoad, 1)}%。`);
    if (r.violations.length) conclusion.push(`${r.violations.length} 个母线电压越限，建议通过无功补偿、变压器分接头或调整开机方式改善电压水平。`);
    else conclusion.push('全部母线电压位于 0.95–1.05 pu 允许范围内。');
    if (r.overloads.length) conclusion.push(`${r.overloads.length} 条支路负载率超过 100%，应校核热稳定容量或调整运行方式。`);
    else conclusion.push('全部支路负载率不超过 100%，满足示例热稳定校核边界。');
  }
  if (sc) conclusion.push(`在 ${sc.busTag} 设置${sc.faultTypeLabel}，短路电流 I″k = ${f(sc.Ik, 2)} kA，短路容量 ${f(sc.Sk, 0)} MVA。`);
  if (scan) conclusion.push(`全网短路扫描覆盖 ${scan.summary.tested} 条母线，最大故障电流出现在 ${scan.summary.maxBusTag || '—'}（${f(scan.summary.maxIk, 2)} kA），${scan.summary.exceed} 条母线超出短路耐受值。`);
  if (n1) conclusion.push(`N-1 静态安全扫描共校核 ${n1.summary.total} 个停运事件，其中 ${n1.summary.critical} 个不收敛、${n1.summary.severe} 个严重越限、${n1.summary.warning} 个一般关注。`);
  if (sens) conclusion.push(`保护灵敏度扫描：${sens.summary.total} 套保护中 ${sens.summary.ok} 套通过、${sens.summary.warn} 套关注、${sens.summary.fail} 套不合格，最小远后备 Ksen=${f(sens.summary.minKsen, 2)}。`);
  if (vbal) conclusion.push(`电压平衡：目标带 ${vbal.targetMin.toFixed(2)}–${vbal.targetMax.toFixed(2)} pu，目标带外母线由 ${vbal.summary.baseOutOfBand} 个降至 ${vbal.summary.bestOutOfBand} 个，给出 ${vbal.changes.length} 项调整建议。`);
  if (freq) conclusion.push(`频率平衡：${freq.eventType === 'surplus' ? '有功盈余' : freq.eventType === 'loadStep' ? '负荷突增' : '发电机跳机'} ${f(freq.eventMW, 0)} MW，最低频率 ${f(freq.minHz, 3)} Hz，最终 ${f(freq.finalHz, 3)} Hz，${freq.stable ? '频率恢复' : freq.recovered ? '频率恢复但最低频率越限' : '频率未恢复'}。`);
  if (stab) conclusion.push(`暂态稳定仿真：${stab.faultBusTag} 三相短路 ${f(stab.faultDuration, 2)} s 切除，判定${stab.stable ? '稳定' : '失稳'}，最大功角差 ${f(stab.maxSpread, 1)}°${cct ? `，临界切除时间${cct.stableAtMax ? '不低于' : '约'} ${f(cct.criticalTime, 3)} s` : ''}。`);
  if (protections.length) conclusion.push(`已配置并投入 ${protections.length} 套线路、变压器和母线保护，自动整定与功能配置结果见第 05 节；正式施工图阶段应结合系统最大/最小运行方式复核灵敏度与选择性。`);

  return `<div class="report-shell">
    <div class="report-toolbar">
      <div class="rt-left"><div class="rt-icon" style="width:29px;height:29px;border-radius:7px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center">${icon('report', 16)}</div><div><div class="rt-title">设计计算报告</div><div class="rt-sub">A4 · 自动编排 · 浏览器打印 / 导出 PDF</div></div></div>
      <div class="rt-actions">
        <button class="btn btn-sm" data-action="report-export-html">${icon('download', 13)} 导出 HTML</button>
        <button class="btn btn-sm btn-primary" data-action="report-print">${icon('print', 13)} 打印 / 导出 PDF</button>
      </div>
    </div>
    <div class="report-paper-wrap">
      <div class="report-paper" id="report-paper">
        <div class="report-watermark">ELECTRA</div>
        <div class="rp-top">
          <div><div class="rp-brand">ELECTRA POWER SYSTEM STUDIO</div><div class="rp-title">电气一次主接线设计与潮流计算报告</div><div class="rp-subtitle">${esc(p.meta.name)}</div></div>
          <div class="rp-doc"><div><b>工程编号</b>　${esc(p.meta.projectNo)}</div><div><b>设计单位</b>　${esc(p.meta.owner || '—')}</div><div><b>日期</b>　${esc(p.meta.date || today())}</div><div><b>版本</b>　REV.01 · 方案设计</div></div>
        </div>

        ${h(1, '工程概况')}
        <div class="report-grid">
          <div class="report-kv">
            <div class="k">工程名称</div><div class="v">${esc(p.meta.name)}</div>
            <div class="k">工程编号</div><div class="v">${esc(p.meta.projectNo)}</div>
            <div class="k">设计阶段</div><div class="v">方案设计 / 潮流与保护初设</div>
            <div class="k">基准容量</div><div class="v">${p.meta.baseMVA} MVA</div>
          </div>
          <div class="report-kv">
            <div class="k">电压等级</div><div class="v">${[...new Set(p.buses.map((b) => b.vn))].sort((a, b) => b - a).join(' / ')} kV</div>
            <div class="k">母线数量</div><div class="v">${s.buses} 条</div>
            <div class="k">线路 / 变压器</div><div class="v">${s.lines} 条 / ${s.transformers} 台</div>
            <div class="k">负荷 / 电源</div><div class="v">${s.loads} 个 / ${s.generators} 台</div>
          </div>
        </div>
        <p>${esc(p.meta.note || '')}</p>

        ${h(2, '主接线方案')}
        ${diagram}
        <div class="report-callout">本工程共配置 ${s.buses} 条母线、${s.lines + s.transformers} 条阻抗支路、${s.generators} 台电源与 ${s.loads} 个负荷。线路支持集中参数与分布参数两种模型，分布参数线路按长线双曲函数修正后形成等效 π 型电路。</div>

        ${h(3, '潮流计算模型')}
        <div class="report-grid">
          <div class="report-kv">
            <div class="k">求解方法</div><div class="v">${r ? esc(r.label) : '待计算'}</div>
            <div class="k">基准容量</div><div class="v">${p.meta.baseMVA} MVA</div>
            <div class="k">收敛精度</div><div class="v">${r ? r.options.tol : '1e-8'} pu</div>
            <div class="k">迭代次数</div><div class="v">${r ? r.iterations : '—'}</div>
          </div>
          <div class="report-kv">
            <div class="k">网络节点</div><div class="v">${r ? r.net.nodes.length : '—'} 个电气节点</div>
            <div class="k">计算时间</div><div class="v">${r ? `${f(r.elapsedMs, 1)} ms` : '—'}</div>
            <div class="k">收敛状态</div><div class="v">${r ? (r.converged ? '已收敛' : '未收敛') : '—'}</div>
            <div class="k">功率损耗</div><div class="v">${r ? `${f(r.totals.lossP, 2)} MW / ${f(r.totals.lossQ, 2)} Mvar` : '—'}</div>
          </div>
        </div>
        ${!r ? '<div class="report-callout warn">当前尚未运行潮流计算。请返回分析工作台完成计算后重新生成本报告。</div>' : ''}

        ${h(4, '潮流计算结果')}
        ${r ? `<h3>4.1 节点电压与注入功率</h3>
        <table class="report-table"><thead><tr><th>编号</th><th>母线名称</th><th>类型</th><th>V (pu)</th><th>θ (°)</th><th>P_gen (MW)</th><th>Q_gen (Mvar)</th><th>P_load (MW)</th><th>Q_load (Mvar)</th></tr></thead><tbody>${busRows}</tbody></table>
        <h3>4.2 支路潮流与损耗</h3>
        <table class="report-table"><thead><tr><th>编号</th><th>支路名称</th><th>方向</th><th>P首 (MW)</th><th>Q首 (Mvar)</th><th>ΔP (MW)</th><th>ΔQ (Mvar)</th><th>负载率</th></tr></thead><tbody>${branchRows}</tbody></table>
        <div class="report-callout">总有功发电 ${f(r.totals.pGen, 2)} MW，总有功负荷 ${f(r.totals.pLoad, 2)} MW，有功损耗 ${f(r.totals.lossP, 2)} MW。最低电压 ${f(r.vMin, 4)} pu，最高电压 ${f(r.vMax, 4)} pu。</div>` : '<p>待补充。</p>'}

        ${h(5, '继电保护配置')}
        ${protections.length ? `<table class="report-table"><thead><tr><th>保护名称</th><th>元件</th><th>CT 变比</th><th>过流启动</th><th>TMS</th><th>距离定值（Ω）</th><th>差动定值</th><th>功能数</th></tr></thead><tbody>${relayRows}</tbody></table>
        <p>保护定值按元件额定电流、最大负荷电流、线路正序阻抗及电气深度自动生成，并在共享母线处校核时间级差。线路、变压器与母线保护共用功能库；表中定值为一次侧折算值，实际装置定值应结合 CT/PT 变比及厂家说明调整。</p>
        ${sens ? `<div class="report-subtitle">灵敏度 / 距离覆盖扫描</div><table class="report-table"><thead><tr><th>保护</th><th>近端 Ik (kA)</th><th>远端 Ik (kA)</th><th>Ksen 近</th><th>Ksen 远</th><th>Z1 范围</th><th>Z2 覆盖</th><th>结论</th></tr></thead><tbody>${sens.rows.map((x) => `<tr><td>${esc(x.relayName)}</td><td class="num">${f(x.nearFaultKA, 2)}</td><td class="num">${f(x.farFaultKA, 2)}</td><td class="num">${f(x.ksenNear, 2)}</td><td class="num">${f(x.ksenFar, 2)}</td><td class="num">${x.z1Ratio != null ? (x.z1Ratio * 100).toFixed(0) + '%' : '—'}</td><td>${x.z2Covers == null ? '—' : (x.z2Covers ? '覆盖' : '不足')}</td><td>${x.status === 'ok' ? '通过' : x.status === 'warn' ? '关注' : '不合格'}</td></tr>`).join('')}</tbody></table>` : ''}` : '<p>本工程未配置投入运行的继电保护。</p>'}

        ${h(6, '短路电流校验')}
        ${sc ? `<div class="report-grid">
          <div class="report-kv"><div class="k">故障母线</div><div class="v">${esc(sc.busName)}（${sc.baseKV} kV）</div><div class="k">故障类型</div><div class="v">${esc(sc.faultTypeLabel)}</div><div class="k">短路电流</div><div class="v">${f(sc.Ik, 2)} kA</div><div class="k">短路容量</div><div class="v">${f(sc.Sk, 0)} MVA</div></div>
          <div class="report-kv"><div class="k">冲击电流</div><div class="v">${f(sc.ip, 2)} kA</div><div class="k">等值阻抗</div><div class="v">${f(sc.zThOhm, 3)} Ω</div><div class="k">X/R</div><div class="v">${Number.isFinite(sc.xr) ? f(sc.xr, 1) : '∞'}</div><div class="k">电压系数 c</div><div class="v">${sc.c}</div><div class="k">母线短路耐受</div><div class="v">${faultBus?.scRating ? `${f(faultBus.scRating, 1)} kA` : '未设置'}</div><div class="k">开断能力校核</div><div class="v">${faultBus?.scRating ? (sc.Ik <= faultBus.scRating ? '通过' : '超出耐受') : '未设置'}</div></div>
        </div>
        <table class="report-table"><thead><tr><th>编号</th><th>母线</th><th>电压 (kV)</th><th>残压 (pu)</th><th>暂降</th></tr></thead><tbody>${scRows}</tbody></table>` : (scan ? '<p>本工程执行了全网短路扫描，尚未选取单点故障生成详细短路结果。</p>' : '<p>本工程尚未执行短路电流校验。</p>')}
        ${scanCallout}
        ${!sc ? scanTable : ''}

        ${h(7, 'N-1 静态安全扫描')}
        ${n1 ? `<div class="report-callout ${n1.summary.critical || n1.summary.severe ? 'warn' : ''}">共 ${n1.summary.total} 个停运事件；不收敛 ${n1.summary.critical} 个，严重越限 ${n1.summary.severe} 个，一般关注 ${n1.summary.warning} 个，通过 ${n1.summary.normal} 个。结果按严重程度排序。</div>
        <table class="report-table"><thead><tr><th>停运元件</th><th>编号</th><th>类型</th><th>收敛</th><th>最低电压 (pu)</th><th>最大负载率</th><th>评价</th></tr></thead><tbody>${n1Rows}</tbody></table>` : '<p>本工程尚未执行 N-1 静态安全扫描。可在潮流分析页点击“N-1 静态安全扫描”生成结果。</p>'}

        ${h(8, '暂态稳定分析')}
        ${stab ? `<div class="report-grid">
          <div class="report-kv"><div class="k">故障母线</div><div class="v">${esc(stab.faultBusName)}</div><div class="k">故障 / 切除</div><div class="v">${f(stab.faultStart, 2)} s / ${f(stab.faultStart + stab.faultDuration, 2)} s</div><div class="k">稳定判定</div><div class="v">${stab.stable ? '稳定' : '失稳'}</div></div>
          <div class="report-kv"><div class="k">最大功角差</div><div class="v">${f(stab.maxSpread, 1)}°</div><div class="k">末段转速偏差</div><div class="v">${f(stab.finalSpeed, 4)} pu</div><div class="k">临界切除时间</div><div class="v">${cct ? `${cct.stableAtMax ? '≥' : ''}${f(cct.criticalTime, 3)} s` : '未估算'}</div></div>
        </div>
        <table class="report-table"><thead><tr><th>机组</th><th>H (s)</th><th>x′d (pu)</th><th>|E′|</th><th>初始角</th><th>P₀ (MW)</th></tr></thead><tbody>${stab.generators.map((g) => `<tr><td>${esc(g.tag)} · ${esc(g.name)}</td><td class="num">${f(g.H, 1)}</td><td class="num">${f(g.xd, 4)}</td><td class="num">${f(g.Eabs, 4)}</td><td class="num">${f(g.angle0, 2)}°</td><td class="num">${f(g.p0, 1)}</td></tr>`).join('')}</tbody></table>` : '<p>本工程尚未执行暂态稳定仿真。可在稳定分析页选择故障母线、切除时间并运行 RK4 时域仿真。</p>'}

        ${h(9, '电压与频率调节')}
        ${vbal || freq ? `<div class="report-grid"><div class="report-kv">${vbal ? `<div class="k">电压目标带</div><div class="v">${f(vbal.targetMin, 3)}–${f(vbal.targetMax, 3)} pu</div><div class="k">带外母线</div><div class="v">${vbal.summary.baseOutOfBand} → ${vbal.summary.bestOutOfBand}</div>` : '<div class="k">电压平衡</div><div class="v">未执行</div>'}</div><div class="report-kv">${freq ? `<div class="k">最低 / 最终频率</div><div class="v">${f(freq.minHz, 3)} / ${f(freq.finalHz, 3)} Hz</div><div class="k">RoCoF / 备用</div><div class="v">${f(freq.rocof, 3)} Hz/s · ${f(freq.reserve, 0)} MW</div>` : '<div class="k">频率平衡</div><div class="v">未执行</div>'}</div></div>` : '<p>本工程尚未执行电压或频率平衡计算。</p>'}

        ${h(10, '结论与建议')}
        ${conclusion.map((c, i) => `<p><b>${i + 1}.</b> ${esc(c)}</p>`).join('')}
        <div class="report-callout ${issueErrors.length ? 'warn' : ''}">${issueErrors.length ? `当前工程存在 ${issueErrors.length} 项拓扑或参数错误，需在施工图阶段前修正。` : '当前工程拓扑与参数通过程序内置规则校核。'}</div>

        <div class="report-signatures"><div class="sig"><div class="line"></div><div class="cap">计算人 / 日期</div></div><div class="sig"><div class="line"></div><div class="cap">校核人 / 日期</div></div><div class="sig"><div class="line"></div><div class="cap">审核人 / 日期</div></div></div>
        <div class="report-footer"><span>ELECTRA · POWER SYSTEM STUDIO</span><span>${esc(p.meta.projectNo)} · ${esc(p.meta.date || today())}</span><span>自动分页 · 以打印预览为准</span></div>
      </div>
    </div>
  </div>`;
}

export function bindReport(root, app) {
  root.querySelector('[data-action="report-print"]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-action="report-export-html"]')?.addEventListener('click', () => app.exportReportHTML());
}
