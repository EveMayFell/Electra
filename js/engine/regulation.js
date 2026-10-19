import { clone } from '../model.js';
import { runPowerFlow } from './powerflow.js';

function metrics(result, targetMin, targetMax) {
  const bus = result.busResults;
  const out = bus.filter((b) => b.Vm < targetMin - 1e-9 || b.Vm > targetMax + 1e-9);
  const hard = bus.filter((b) => b.Vm < 0.95 - 1e-9 || b.Vm > 1.05 + 1e-9);
  const deviation = bus.reduce((s, b) => s + Math.max(0, targetMin - b.Vm) ** 2 + Math.max(0, b.Vm - targetMax) ** 2, 0);
  return {
    vMin: result.vMin,
    vMax: result.vMax,
    outOfBand: out.length,
    hardViolations: hard.length,
    deviation,
    maxLoad: Math.max(0, ...result.branchResults.map((b) => b.loading || 0)),
    lossP: result.totals.lossP
  };
}

function evaluate(project, targetMin, targetMax, maxIter) {
  try {
    const result = runPowerFlow(project, { algorithm: 'nr', maxIter, tol: 1e-8, qLimits: true });
    if (!result.converged) return { ok: false, objective: 1e12, result, metrics: null };
    const m = metrics(result, targetMin, targetMax);
    const hard = result.busResults.reduce((s, b) => s + Math.max(0, 0.95 - b.Vm) + Math.max(0, b.Vm - 1.05), 0);
    const over = result.branchResults.reduce((s, b) => s + Math.max(0, b.loading - 100), 0) / 100;
    return {
      ok: true,
      result,
      metrics: m,
      objective: m.deviation * 1000 + hard * 1e7 + over * 1e5,
      feasible: m.hardViolations === 0 && result.overloads.length === 0
    };
  } catch (e) {
    return { ok: false, objective: 1e12, error: e.message, metrics: null };
  }
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
  return 0;
}

function collectVariables(project) {
  const vars = [];
  for (const bus of project.buses) {
    if (bus.type !== 'PV' && bus.type !== 'slack') continue;
    vars.push({
      kind: 'voltage', id: bus.id, label: `${bus.tag} 电压设定`, min: 0.97, max: 1.06, step: 0.005,
      set: (p, v) => { const b = p.buses.find((x) => x.id === bus.id); if (b) b.vm = v; }
    });
  }
  for (const br of project.branches) {
    if (br.type === 'transformer') {
      vars.push({
        kind: 'tap', id: br.id, label: `${br.tag} 分接头`, min: -10, max: 10, step: 1.25,
        set: (p, v) => { const b = p.branches.find((x) => x.id === br.id); if (b) b.tap = v; }
      });
    }
    if (br.type === 'transformer3') {
      for (const key of ['tapH', 'tapM', 'tapL']) {
        vars.push({
          kind: 'tap', id: `${br.id}-${key}`, key, label: `${br.tag} ${key} 分接头`, min: -10, max: 10, step: 1.25,
          set: (p, v) => { const b = p.branches.find((x) => x.id === br.id); if (b) b[key] = v; }
        });
      }
    }
  }
  for (const sh of project.injections.filter((x) => x.type === 'shunt')) {
    const q = Number(sh.q) || 0;
    vars.push({
      kind: 'shunt', id: sh.id, label: `${sh.tag} 补偿容量`, min: q >= 0 ? 0 : q * 2, max: q >= 0 ? Math.max(q * 2, 10) : 0, step: 5,
      set: (p, v) => { const x = p.injections.find((y) => y.id === sh.id); if (x) x.q = v; }
    });
  }
  return vars;
}

function collectChanges(initial, best) {
  const changes = [];
  for (const b0 of initial.buses) {
    const b1 = best.buses.find((b) => b.id === b0.id);
    if (b1 && Math.abs((b1.vm || 0) - (b0.vm || 0)) > 1e-9) {
      changes.push({ kind: 'voltage', id: b1.id, field: 'vm', label: `${b1.tag} 电压设定`, from: b0.vm, to: b1.vm, unit: 'pu' });
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
  for (const x0 of initial.injections) {
    const x1 = best.injections.find((x) => x.id === x0.id);
    if (x1 && x0.type === 'shunt' && Math.abs((x1.q || 0) - (x0.q || 0)) > 1e-9) {
      changes.push({ kind: 'shunt', id: x1.id, field: 'q', label: `${x1.tag} 补偿容量`, from: x0.q, to: x1.q, unit: 'Mvar' });
    }
  }
  return changes;
}

/**
 * Heuristic voltage balancing. It moves PV/Slack voltage setpoints, transformer
 * taps and existing shunt capacities to minimise deviations outside the target
 * band while keeping the hard 0.95–1.05 pu and thermal constraints.
 */
export function runVoltageBalance(project, options = {}) {
  const opts = {
    targetMin: 0.98,
    targetMax: 1.02,
    passes: 2,
    ...options
  };
  const targetMin = Math.max(0.9, Math.min(1.04, Number(opts.targetMin) || 0.98));
  const targetMax = Math.min(1.1, Math.max(0.96, Number(opts.targetMax) || 1.02));
  const initial = clone(project);
  const current = clone(project);
  const base = evaluate(current, targetMin, targetMax, 60);
  if (!base.ok) throw new Error(base.error || '基准潮流不收敛，无法执行电压平衡。');
  let currentEval = base;
  let evaluations = 1;
  const variables = collectVariables(current);
  for (let pass = 0; pass < opts.passes; pass++) {
    let improved = false;
    for (const variable of variables) {
      const baseValue = readVariable(current, variable);
      let bestValue = null;
      let bestEval = null;
      for (const dir of [1, -1]) {
        const candidateValue = Math.round((baseValue + dir * variable.step) * 1e6) / 1e6;
        if (candidateValue < variable.min - 1e-9 || candidateValue > variable.max + 1e-9) continue;
        const candidate = clone(current);
        variable.set(candidate, candidateValue);
        const ev = evaluate(candidate, targetMin, targetMax, 60);
        evaluations++;
        if (ev.ok && ev.objective < (bestEval?.objective ?? currentEval.objective) - 1e-7) {
          bestValue = candidateValue;
          bestEval = ev;
        }
      }
      if (bestValue != null) {
        variable.set(current, bestValue);
        currentEval = bestEval;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return {
    targetMin, targetMax,
    initial,
    optimizedProject: current,
    base,
    best: currentEval,
    changes: collectChanges(initial, current),
    evaluations,
    feasible: currentEval.feasible,
    summary: {
      baseVMin: base.metrics.vMin,
      baseVMax: base.metrics.vMax,
      bestVMin: currentEval.metrics.vMin,
      bestVMax: currentEval.metrics.vMax,
      baseOutOfBand: base.metrics.outOfBand,
      bestOutOfBand: currentEval.metrics.outOfBand,
      baseHard: base.metrics.hardViolations,
      bestHard: currentEval.metrics.hardViolations,
      baseMaxLoad: base.metrics.maxLoad,
      bestMaxLoad: currentEval.metrics.maxLoad
    }
  };
}

/**
 * Primary frequency response + AGC secondary restoration. The model is a
 * aggregate centre-of-inertia swing equation with first-order governor and AGC
 * responses; it is intended for scheme-level frequency screening.
 */
export function runFrequencyResponse(project, options = {}) {
  const opts = {
    eventType: 'generatorTrip',
    eventMW: 200,
    generatorId: null,
    droop: 5,
    loadDampingPct: 2,
    governorTime: 4,
    agc: true,
    agcDelay: 10,
    agcKp: 20,
    agcKi: 40,
    agcTime: 3,
    tEnd: 60,
    dt: 0.02,
    ...options
  };
  const pf = runPowerFlow(project, { algorithm: 'nr', maxIter: 50 });
  if (!pf.converged) throw new Error('潮流不收敛，无法建立频率调节初始方式。');
  const f0 = Number(project.meta?.frequency) || 50;
  const active = project.injections.filter((x) => x.type === 'generator' && x.status !== 'out' && x.switchClosed !== false);
  const rows = active.map((g) => {
    const res = pf.generatorResults.find((x) => x.id === g.id);
    const p = Math.max(0, Number(res?.p ?? g.p) || 0);
    const rated = Math.max(1, Number(g.ratedMVA) || 100);
    const pMax = Math.max(p, Number(g.pMax) || rated);
    return {
      id: g.id, tag: g.tag, name: g.name, p, ratedMVA: rated,
      pMax, reserve: Math.max(0, pMax - p),
      inertia: Math.max(0.3, Number(g.inertia) || 5),
      droop: Math.max(1, Number(opts.droop) || Number(g.droop) || 5),
      governor: g.governor !== false
    };
  });
  if (!rows.length) throw new Error('没有在线发电机组，无法进行频率调节。');
  const governorRows = rows.filter((g) => g.governor);
  const sysMVA = rows.reduce((s, g) => s + g.ratedMVA, 0);
  const Hsys = rows.reduce((s, g) => s + g.inertia * g.ratedMVA, 0) / sysMVA;
  const totalLoad = Math.max(1, pf.totals.pLoad);
  const D = (Number(opts.loadDampingPct) / 100) * totalLoad / (0.01 * f0);
  const Kgov = governorRows.reduce((s, g) => s + g.ratedMVA / ((g.droop / 100) * f0), 0);
  const reserve = rows.reduce((s, g) => s + g.reserve, 0);
  const eventGenerator = opts.generatorId ? rows.find((g) => g.id === opts.generatorId) : null;
  const eventMW = Math.max(0, Number(opts.eventMW) || (eventGenerator?.p ?? 200));
  const sign = opts.eventType === 'surplus' ? 1 : -1;
  const imbalance = sign * eventMW;
  const M = Math.max(0.01, 2 * Hsys * sysMVA / f0);
  const dt = Math.max(0.01, Math.min(0.05, Number(opts.dt) || 0.02));
  const tEnd = Math.max(5, Number(opts.tEnd) || 30);
  let df = 0;
  let pgov = 0;
  let pagc = 0;
  let agcIntegral = 0;
  let t = 0;
  const timeline = [{ t: 0, hz: f0, df: 0, pgov: 0, pagc: 0 }];
  while (t < tEnd - 1e-9) {
    const govTarget = governorRows.length ? Math.max(-reserve, Math.min(reserve, Kgov * (-df))) : 0;
    const dPg = (govTarget - pgov) / Math.max(0.2, Number(opts.governorTime) || 4);
    let dPagc = 0;
    if (opts.agc) {
      if (t >= (Number(opts.agcDelay) || 10)) {
        agcIntegral += -df * dt;
        const target = Math.max(-reserve, Math.min(reserve, (-df) * (Number(opts.agcKp) || 30) + agcIntegral * (Number(opts.agcKi) || 4)));
        dPagc = (target - pagc) / Math.max(0.2, Number(opts.agcTime) || 3);
      }
    }
    const ddf = (imbalance - D * df + pgov + pagc) / M;
    df += ddf * dt;
    pgov += dPg * dt;
    pagc += dPagc * dt;
    t += dt;
    if (Math.abs(t / 0.1 - Math.round(t / 0.1)) < 1e-6) {
      timeline.push({ t: Number(t.toFixed(3)), hz: f0 + df, df, pgov, pagc });
    }
  }
  timeline.push({ t: Number(t.toFixed(3)), hz: f0 + df, df, pgov, pagc });
  const minHz = Math.min(...timeline.map((p) => p.hz));
  const maxHz = Math.max(...timeline.map((p) => p.hz));
  const finalHz = timeline[timeline.length - 1].hz;
  const rocof = imbalance / M;
  const primarySteady = imbalance / Math.max(0.01, D + Kgov);
  const governorRowsOut = rows.map((g) => ({
    ...g,
    primaryShare: governorRows.length ? (g.governor ? g.ratedMVA / ((g.droop / 100) * f0) / Math.max(1e-6, Kgov) : 0) : 0,
    agcShare: reserve > 0 ? g.reserve / reserve : 0
  }));
  return {
    eventType: opts.eventType,
    eventMW,
    eventGenerator: eventGenerator ? { id: eventGenerator.id, tag: eventGenerator.tag } : null,
    f0,
    Hsys,
    sysMVA,
    D,
    Kgov,
    reserve,
    M,
    imbalance,
    rocof,
    primarySteady,
    minHz,
    maxHz,
    finalHz,
    finalDeviation: finalHz - f0,
    agc: !!opts.agc,
    agcMW: pagc,
    primaryMW: pgov,
    timeline,
    governorRows: governorRowsOut,
    recovered: Math.abs(finalHz - f0) < 0.05,
    nadirOk: minHz > 47.5,
    stable: Math.abs(finalHz - f0) < 0.05 && minHz > 47.5,
    notes: [
      '频率模型为单区域惯量中心模型：转子惯量、负荷阻尼、一次调频与 AGC 二次调节。',
      '事件为有功缺额（发电机跳机/负荷突增）或有功盈余；AGC 在设定延时后按频率偏差积分恢复。',
      '未模拟机组爬坡限制、死区、再热、超速保护与低频减载，正式频率稳定计算应使用完整模型。'
    ]
  };
}
