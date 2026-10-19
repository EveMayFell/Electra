import { clone } from '../model.js';
import { runPowerFlow } from './powerflow.js';

const VMIN = 0.95;
const VMAX = 1.05;

function evaluate(project, objective, options) {
  try {
    const r = runPowerFlow(project, {
      algorithm: 'nr',
      tol: 1e-7,
      maxIter: Math.max(40, options.maxIter || 60),
      qLimits: true
    });
    if (!r.converged) return { ok: false, objective: 1e12, result: r, metrics: metricsOf(r) };
    const metrics = metricsOf(r);
    const vViolation = r.busResults.reduce((s, b) => s + Math.max(0, VMIN - b.Vm) + Math.max(0, b.Vm - VMAX), 0);
    const over = r.branchResults.reduce((s, b) => s + Math.max(0, b.loading - 100), 0) / 100;
    const genCost = r.generatorResults.reduce((s, g) => {
      const inj = project.injections.find((x) => x.id === g.id);
      return s + (Number(inj?.costA) || 0) + (Number(inj?.costB) || 0) * Math.max(0, g.p || 0);
    }, 0);
    const base = objective === 'cost' ? genCost : r.totals.lossP;
    const objectiveValue = base + vViolation * 1e7 + over * 1e6 + (r.qLimitActions?.length || 0) * 5;
    return { ok: true, objective: objectiveValue, base, result: r, metrics, feasible: r.violations.length === 0 && r.overloads.length === 0, genCost };
  } catch (e) {
    return { ok: false, objective: 1e12, error: e.message, metrics: null };
  }
}

function metricsOf(r) {
  return {
    lossP: r.totals.lossP,
    lossQ: r.totals.lossQ,
    vMin: r.vMin,
    vMax: r.vMax,
    maxLoad: Math.max(0, ...r.branchResults.map((b) => b.loading || 0)),
    cost: r.generatorResults.reduce((s, g) => {
      const inj = r.net.project?.injections?.find((x) => x.id === g.id);
      return s + (Number(inj?.costA) || 0) + (Number(inj?.costB) || 0) * Math.max(0, g.p || 0);
    }, 0)
  };
}

function collectVariables(project, options) {
  const vars = [];
  for (const bus of project.buses) {
    if (bus.type === 'PV' || bus.type === 'slack') {
      vars.push({
        kind: 'voltage', id: bus.id, label: `${bus.tag} 电压设定`, get: () => bus.vm,
        set: (p, v) => { p.buses.find((b) => b.id === bus.id).vm = v; },
        min: 0.97, max: 1.065, step: 0.005
      });
    }
  }
  if (options.includeTaps !== false) {
    for (const br of project.branches) {
      if (br.type === 'transformer') {
        vars.push({
          kind: 'tap', id: br.id, label: `${br.tag} 分接头`, get: () => br.tap,
          set: (p, v) => { p.branches.find((b) => b.id === br.id).tap = v; },
          min: -10, max: 10, step: 1.25
        });
      }
      if (br.type === 'transformer3') {
        for (const key of ['tapH', 'tapM', 'tapL']) {
          vars.push({
            kind: 'tap', id: `${br.id}-${key}`, key, label: `${br.tag} ${key} 分接头`, get: () => br[key],
            set: (p, v) => { const t = p.branches.find((b) => b.id === br.id); if (t) t[key] = v; },
            min: -10, max: 10, step: 1.25
          });
        }
      }
    }
  }
  if (options.includeShunts !== false) {
    for (const inj of project.injections.filter((x) => x.type === 'shunt')) {
      const q = Number(inj.q) || 0;
      vars.push({
        kind: 'shunt', id: inj.id, label: `${inj.tag} 补偿容量`, get: () => Number(inj.q) || 0,
        set: (p, v) => { const s = p.injections.find((x) => x.id === inj.id); if (s) s.q = v; },
        min: q >= 0 ? 0 : Math.min(q * 2, -10), max: q >= 0 ? Math.max(q * 2, 10) : 0, step: 5
      });
    }
  }
  if (options.objective === 'cost' && options.includeDispatch !== false) {
    const slackBusIds = new Set(project.buses.filter((b) => b.type === 'slack').map((b) => b.id));
    for (const inj of project.injections.filter((x) => x.type === 'generator' && x.status !== 'out')) {
      if (slackBusIds.has(inj.bus)) continue;
      const rated = Math.max(1, Number(inj.ratedMVA) || 100);
      vars.push({
        kind: 'dispatch', id: inj.id, label: `${inj.tag} 有功调度`, get: () => Number(inj.p) || 0,
        set: (p, v) => { const g = p.injections.find((x) => x.id === inj.id); if (g) g.p = v; },
        min: Number(inj.pMin) || 0, max: Number(inj.pMax) || rated, step: Math.max(5, rated * 0.05)
      });
    }
  }
  return vars;
}

function readVariable(project, variable) {
  if (variable.kind === 'voltage') return project.buses.find((b) => b.id === variable.id)?.vm ?? 0;
  if (variable.kind === 'tap') {
    if (variable.key) {
      const baseId = variable.id.slice(0, variable.id.length - variable.key.length - 1);
      return project.branches.find((b) => b.id === baseId)?.[variable.key] ?? 0;
    }
    return project.branches.find((b) => b.id === variable.id)?.tap ?? 0;
  }
  if (variable.kind === 'shunt') return project.injections.find((x) => x.id === variable.id)?.q ?? 0;
  if (variable.kind === 'dispatch') return project.injections.find((x) => x.id === variable.id)?.p ?? 0;
  return 0;
}

function collectChanges(initial, best) {
  const changes = [];
  for (const bus0 of initial.buses) {
    const bus1 = best.buses.find((b) => b.id === bus0.id);
    if (bus1 && Math.abs((bus1.vm || 0) - (bus0.vm || 0)) > 1e-9) {
      changes.push({ kind: 'voltage', id: bus1.id, field: 'vm', label: `${bus1.tag} 电压设定`, from: bus0.vm, to: bus1.vm, unit: 'pu' });
    }
  }
  for (const br0 of initial.branches) {
    const br1 = best.branches.find((b) => b.id === br0.id);
    if (!br1) continue;
    if (br0.type === 'transformer' && Math.abs((br1.tap || 0) - (br0.tap || 0)) > 1e-9) {
      changes.push({ kind: 'tap', id: br1.id, branchId: br1.id, field: 'tap', label: `${br1.tag} 分接头`, from: br0.tap, to: br1.tap, unit: '%' });
    }
    if (br0.type === 'transformer3') {
      for (const key of ['tapH', 'tapM', 'tapL']) {
        if (Math.abs((br1[key] || 0) - (br0[key] || 0)) > 1e-9) {
          changes.push({ kind: 'tap', id: `${br1.id}-${key}`, branchId: br1.id, field: key, label: `${br1.tag} ${key} 分接头`, from: br0[key], to: br1[key], unit: '%' });
        }
      }
    }
  }
  for (const inj0 of initial.injections) {
    const inj1 = best.injections.find((x) => x.id === inj0.id);
    if (!inj1) continue;
    if (inj0.type === 'shunt' && Math.abs((inj1.q || 0) - (inj0.q || 0)) > 1e-9) {
      changes.push({ kind: 'shunt', id: inj1.id, field: 'q', label: `${inj1.tag} 补偿容量`, from: inj0.q, to: inj1.q, unit: 'Mvar' });
    }
    if (inj0.type === 'generator' && Math.abs((inj1.p || 0) - (inj0.p || 0)) > 1e-9) {
      changes.push({ kind: 'dispatch', id: inj1.id, field: 'p', label: `${inj1.tag} 有功出力`, from: inj0.p, to: inj1.p, unit: 'MW' });
    }
  }
  return changes;
}

/**
 * Engineering-stage heuristic optimiser. It performs coordinate descent on
 * transformer taps, existing shunt capacities and PV/Slack voltage setpoints;
 * for the cost objective it also redispatches non-slack generators. Every
 * candidate is evaluated with a full AC power flow, so voltage and thermal
 * constraints are respected through a penalty function.
 */
export function runOptimization(project, options = {}) {
  const opts = {
    objective: 'loss',
    includeTaps: true,
    includeShunts: true,
    includeDispatch: true,
    passes: 2,
    ...options
  };
  const initial = clone(project);
  const startProject = clone(project);
  const baseEval = evaluate(startProject, opts.objective, opts);
  if (!baseEval.ok) throw new Error(baseEval.error || '基准潮流不收敛，无法进行优化。');
  let current = clone(project);
  let currentEval = baseEval;
  const accepted = [];
  let evaluations = 1;
  const requireFeasible = baseEval.feasible;
  const vars = collectVariables(project, opts);
  for (let pass = 0; pass < opts.passes; pass++) {
    let improved = false;
    for (const variable of vars) {
      const baseValue = readVariable(current, variable);
      let bestValue = null;
      let bestEval = null;
      for (const dir of [1, -1]) {
        const candidateValue = Math.round((baseValue + dir * variable.step) * 1e6) / 1e6;
        if (candidateValue < variable.min - 1e-9 || candidateValue > variable.max + 1e-9) continue;
        const candidate = clone(current);
        variable.set(candidate, candidateValue);
        const ev = evaluate(candidate, opts.objective, opts);
        evaluations++;
        if (ev.ok && (!requireFeasible || ev.feasible) && ev.objective < (bestEval?.objective ?? currentEval.objective) - 1e-7) {
          bestValue = candidateValue;
          bestEval = ev;
        }
      }
      if (bestValue != null) {
        variable.set(current, bestValue);
        currentEval = bestEval;
        improved = true;
        accepted.push({ variable: variable.label, from: baseValue, to: bestValue, kind: variable.kind });
      }
    }
    if (!improved) break;
  }
  return {
    objective: opts.objective,
    initial,
    optimizedProject: current,
    base: baseEval,
    best: currentEval,
    changes: collectChanges(initial, current),
    evaluations,
    feasible: currentEval.feasible,
    summary: {
      baseLoss: baseEval.metrics.lossP,
      bestLoss: currentEval.metrics.lossP,
      baseCost: baseEval.metrics.cost,
      bestCost: currentEval.metrics.cost,
      baseVMin: baseEval.metrics.vMin,
      bestVMin: currentEval.metrics.vMin,
      baseVMax: baseEval.metrics.vMax,
      bestVMax: currentEval.metrics.vMax,
      baseMaxLoad: baseEval.metrics.maxLoad,
      bestMaxLoad: currentEval.metrics.maxLoad
    }
  };
}
