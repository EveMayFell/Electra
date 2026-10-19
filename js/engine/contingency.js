import { runPowerFlow } from './powerflow.js';

/**
 * N-1 outage screening. Each in-service line/transformer and generator is removed
 * in turn and the AC power flow is re-solved. The rank is intentionally simple:
 * non-convergence and severe voltage/overload violations first.
 */
export function runN1Scan(project, options = {}) {
  const base = runPowerFlow(project, { ...options, algorithm: options.algorithm || 'nr' });
  const cases = [];
  const branches = project.branches.filter((b) => ['line', 'transformer', 'transformer3', 'seriesReactor', 'seriesCap', 'fcl'].includes(b.type) && b.status === 'in' && b.fromSwitch !== 'open' && b.toSwitch !== 'open' && b.thirdSwitch !== 'open');
  const generators = project.injections.filter((x) => x.type === 'generator' && x.status !== 'out' && x.switchClosed !== false);
  const all = [
    ...branches.map((b) => ({ type: 'branch', id: b.id, name: b.name, tag: b.tag, element: b })),
    ...generators.map((g) => ({ type: 'generator', id: g.id, name: g.name, tag: g.tag, element: g }))
  ];
  for (const item of all) {
    const copy = JSON.parse(JSON.stringify(project));
    if (item.type === 'branch') {
      const target = copy.branches.find((b) => b.id === item.id);
      target.status = 'out';
    } else {
      const target = copy.injections.find((x) => x.id === item.id);
      target.status = 'out';
    }
    try {
      const r = runPowerFlow(copy, { ...options, algorithm: 'nr', maxIter: Math.max(40, options.maxIter || 30) });
      const maxLoad = Math.max(0, ...r.branchResults.map((b) => b.loading || 0));
      const lowV = r.busResults.filter((b) => b.Vm < 0.95).map((b) => b.tag);
      const highV = r.busResults.filter((b) => b.Vm > 1.05).map((b) => b.tag);
      const overloads = r.branchResults.filter((b) => b.loading > 100).map((b) => b.tag);
      let severity = 'normal';
      if (!r.converged) severity = 'critical';
      else if (r.vMin < 0.90 || overloads.length > 0) severity = 'severe';
      else if (lowV.length || highV.length) severity = 'warning';
      cases.push({
        id: item.id, type: item.type, name: item.name, tag: item.tag,
        label: item.type === 'branch' ? ({ transformer3: '三绕组变压器', transformer: '变压器', seriesReactor: '串联电抗器', seriesCap: '串联电容器', fcl: '故障限流器' }[item.element.type] || '线路') : '发电机',
        converged: r.converged, iterations: r.iterations,
        minV: r.vMin, maxLoad,
        lowV, highV, overloads,
        violations: lowV.length + highV.length,
        severity,
        result: r
      });
    } catch (e) {
      cases.push({
        id: item.id, type: item.type, name: item.name, tag: item.tag,
        label: item.type === 'branch' ? '支路' : '发电机',
        converged: false, error: e.message, severity: 'critical', minV: null, maxLoad: null, lowV: [], highV: [], overloads: [], violations: 0
      });
    }
  }
  const rank = { critical: 0, severe: 1, warning: 2, normal: 3 };
  cases.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.minV ?? 0) - (b.minV ?? 0));
  const summary = {
    total: cases.length,
    critical: cases.filter((c) => c.severity === 'critical').length,
    severe: cases.filter((c) => c.severity === 'severe').length,
    warning: cases.filter((c) => c.severity === 'warning').length,
    normal: cases.filter((c) => c.severity === 'normal').length,
    base
  };
  return { base, cases, summary, options };
}
