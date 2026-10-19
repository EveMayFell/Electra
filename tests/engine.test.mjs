import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSampleProject, SAMPLE_PROJECTS } from '../js/data/sample.js';
import { buildNetwork, runPowerFlow } from '../js/engine/powerflow.js';
import { getJacobianForResult, getDecoupledForResult } from '../js/engine/powerflow.js';
import { runShortCircuit, scanShortCircuitBuses } from '../js/engine/shortcircuit.js';
import { autoSetAll, protectionSummary, relayTripTimeSeconds, runProtectionSensitivityScan } from '../js/engine/protection.js';
import { runN1Scan } from '../js/engine/contingency.js';
import { runOptimization } from '../js/engine/optimize.js';
import { runTransientStability, findCriticalClearingTime } from '../js/engine/stability.js';
import { runVoltageBalance, runFrequencyResponse } from '../js/engine/regulation.js';
import { recloseSummary } from '../js/engine/reclose.js';
import { PROTECTION_COUNT, protectionsFor } from '../js/data/protectionCatalog.js';
import { evaluateRelayProtections, evaluationSummary } from '../js/engine/protectionFunctions.js';
import { newBus, newBranch, newInjection, emptyProject, validateProject } from '../js/model.js';

test('sample network: Ybus is built and is symmetric', () => {
  const p = createSampleProject();
  const net = buildNetwork(p);
  assert.equal(net.errors.length, 0);
  assert.equal(net.Y.length, 7);
  for (let i = 0; i < net.Y.length; i++) {
    for (let j = 0; j < net.Y.length; j++) {
      assert.ok(Math.abs(net.Y[i][j].re - net.Y[j][i].re) < 1e-12);
      assert.ok(Math.abs(net.Y[i][j].im - net.Y[j][i].im) < 1e-12);
    }
  }
});

test('Newton-Raphson converges and balances power', () => {
  const p = createSampleProject();
  const r = runPowerFlow(p, { algorithm: 'nr', tol: 1e-10 });
  assert.equal(r.converged, true);
  assert.ok(r.iterations <= 8);
  assert.ok(Math.abs(r.totals.pBalance) < 1e-6);
  assert.ok(Math.abs(r.totals.qBalance) < 1e-5);
  assert.ok(r.vMin > 0.95 && r.vMax < 1.05);
});

test('PQ decoupled and Gauss-Seidel match Newton voltage solution', () => {
  const p = createSampleProject();
  const nr = runPowerFlow(p, { algorithm: 'nr', tol: 1e-9 });
  for (const [algorithm, maxIter] of [['fdpf-xb', 40], ['fdpf-bx', 40], ['gs', 150]]) {
    const r = runPowerFlow(p, { algorithm, maxIter, tol: 1e-7 });
    assert.equal(r.converged, true, `${algorithm} should converge`);
    for (let i = 0; i < r.busResults.length; i++) {
      assert.ok(Math.abs(r.busResults[i].Vm - nr.busResults[i].Vm) < 5e-5, `${algorithm} V match`);
    }
  }
});

test('DC power flow preserves active injection balance', () => {
  const p = createSampleProject();
  const r = runPowerFlow(p, { algorithm: 'dc' });
  assert.equal(r.converged, true);
  assert.ok(Math.abs(r.totals.pGen - r.totals.pLoad) < 1e-6);
  assert.equal(r.totals.lossP, 0);
  assert.ok(r.branchResults.every((b) => b.qFrom === 0 && b.pLoss === 0));
});

test('Jacobian blocks have consistent dimensions', () => {
  const p = createSampleProject();
  const r = runPowerFlow(p, { algorithm: 'nr' });
  const jac = getJacobianForResult(r);
  const dec = getDecoupledForResult(r);
  assert.equal(jac.J.length, 11);
  assert.equal(jac.H.length, 6);
  assert.equal(jac.N[0].length, 5);
  assert.equal(jac.M.length, 5);
  assert.equal(jac.L.length, 5);
  assert.equal(dec.Bp.length, 6);
  assert.equal(dec.Bpp.length, 5);
  assert.ok(jac.J.flat().every(Number.isFinite));
});

test('closed breaker collapses two bus nodes for power flow', () => {
  const p = emptyProject();
  const b1 = newBus({ name: 'A', tag: 'A', vn: 110, type: 'slack', x: 100, y: 100 });
  const b2 = newBus({ name: 'B', tag: 'B', vn: 110, type: 'PQ', x: 600, y: 100 });
  const qf = newBranch('breaker', b1.id, b2.id, { name: '母联', tag: 'QF1', closed: true });
  const load = newInjection('load', b2.id, { name: '负荷', tag: 'LD1', p: 10, q: 3 });
  p.buses.push(b1, b2);
  p.branches.push(qf);
  p.injections.push(load);
  p.relays = [];
  const net = buildNetwork(p);
  assert.equal(net.nodes.length, 1);
  assert.equal(net.nodes[0].loadP, 10);
});

test('reactive limit enforcement converts PV to PQ', () => {
  const p = createSampleProject();
  p.injections.find((g) => g.id === 'gen-g2').qMax = 20;
  const r = runPowerFlow(p, { algorithm: 'nr', qLimits: true, maxIter: 60 });
  assert.equal(r.converged, true);
  assert.equal(r.qLimitActions.length, 1);
  assert.equal(r.busResults.find((b) => b.tag === 'BUS-220B').qGen <= 20.001, true);
});

test('short-circuit calculation returns a finite result', () => {
  const p = createSampleProject();
  const sc = runShortCircuit(p, { busId: 'bus-110a', c: 1.1, sourceMVA: 12000 });
  assert.ok(sc.Ik > 0 && Number.isFinite(sc.Ik));
  assert.ok(sc.Sk > 0);
  assert.ok(sc.busVoltages.find((b) => b.busId === 'bus-110a').vpu < 1e-9);
  assert.ok(sc.branchCurrents.length > 0);
});

test('full-network short-circuit scan checks bus withstand', () => {
  const p = createSampleProject();
  p.buses.find((b) => b.id === 'bus-110a').scRating = 8;
  const scan = scanShortCircuitBuses(p, { sourceMVA: 12000 });
  assert.equal(scan.summary.total, p.buses.length);
  assert.equal(scan.summary.tested, p.buses.length);
  assert.ok(scan.summary.maxIk > 0);
  assert.ok(scan.summary.exceed >= 1);
  assert.ok(scan.rows.every((r) => r.Ik == null || r.scRating > 0));
});

test('automatic protection setting passes its own coordination rules', () => {
  const p = createSampleProject();
  const r = runPowerFlow(p, { algorithm: 'nr' });
  autoSetAll(p, r);
  const summary = protectionSummary(p, r);
  assert.equal(summary.errors, 0);
  assert.ok(summary.checks.every((c) => c.ok));
  const relay = p.relays.find((x) => x.branchId === 'br-l1');
  assert.ok(relay.distance.z1 > 0 && relay.distance.z1 < relay.distance.z2);
  assert.ok(Number.isFinite(relayTripTimeSeconds(relay, relay.overcurrent.pickup * 5)));
});

test('N-1 scan produces ranked cases and includes three-winding transformers', () => {
  const p = createSampleProject();
  p.branches.push(newBranch('transformer3', 'bus-220a', 'bus-110a', {
    third: 'bus-35a', name: 'T5', tag: 'T5', sn: 120, vnH: 230, vnM: 115, vnL: 37,
    ukHM: 12.5, ukHL: 18.5, ukML: 7.5, pk: 400, p0: 80, i0: 0.25, tapH: 0, tapM: 0, tapL: 0, ratingMVA: 120
  }));
  const scan = runN1Scan(p, { algorithm: 'nr' });
  assert.equal(scan.cases.length, p.branches.filter((b) => ['line', 'transformer', 'transformer3'].includes(b.type)).length + p.injections.filter((x) => x.type === 'generator').length);
  assert.ok(scan.summary.total >= 10);
  assert.ok(scan.cases.every((c) => c.severity));
  assert.ok(scan.cases.some((c) => c.label === '三绕组变压器'));
});

test('three-winding transformer uses a star equivalent and reports winding flows', () => {
  const p = emptyProject();
  const b1 = newBus({ name: 'HV', tag: 'B1', vn: 220, type: 'slack', x: 100, y: 100 });
  const b2 = newBus({ name: 'MV', tag: 'B2', vn: 110, type: 'PQ', x: 600, y: 100 });
  const b3 = newBus({ name: 'LV', tag: 'B3', vn: 35, type: 'PQ', x: 350, y: 400 });
  const t = newBranch('transformer3', b1.id, b2.id, {
    third: b3.id, name: 'T', tag: 'T1', sn: 120, vnH: 230, vnM: 115, vnL: 37,
    ukHM: 12.5, ukHL: 18.5, ukML: 7.5, pk: 400, p0: 80, i0: 0.25, tapH: 0, tapM: 0, tapL: 0, ratingMVA: 120
  });
  p.buses.push(b1, b2, b3);
  p.branches.push(t);
  p.injections.push(
    newInjection('generator', b1.id, { name: 'G', tag: 'G1', p: 0, ratedMVA: 300, qMin: -100, qMax: 150 }),
    newInjection('load', b2.id, { name: 'L2', tag: 'L2', p: 50, q: 16 }),
    newInjection('load', b3.id, { name: 'L3', tag: 'L3', p: 20, q: 6 })
  );
  p.relays = [];
  const net = buildNetwork(p);
  assert.equal(net.errors.length, 0);
  assert.equal(net.nodes.length, 4);
  const r = runPowerFlow(p, { algorithm: 'nr', maxIter: 60 });
  assert.equal(r.converged, true);
  const rows = r.branchResults.filter((x) => x.parentId === t.id);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((x) => x.winding), ['H', 'M', 'L']);
  const pLoads = 70;
  assert.ok(rows.find((x) => x.winding === 'H').pFrom > pLoads);
  assert.ok(rows.find((x) => x.winding === 'M').pFrom < 0);
  assert.ok(rows.find((x) => x.winding === 'L').pFrom < 0);
  assert.ok(Math.abs(rows.reduce((s, x) => s + x.pLoss, 0) - r.totals.lossP) < 1e-6);
});

test('single-line-to-ground fault uses the zero-sequence network', () => {
  const p = createSampleProject();
  const r = runShortCircuit(p, { busId: 'bus-110a', faultType: '1ph', c: 1.1, sourceMVA: 12000 });
  assert.equal(r.faultType, '1ph');
  assert.ok(r.Ik > 2 && Number.isFinite(r.Ik));
  assert.ok(r.sequence.z0Ohm > 0);
  assert.ok(Math.abs(r.sequence.i0kA * 3 - r.Ik) < 1e-9);
  const fault = r.busVoltages.find((b) => b.busId === 'bus-110a');
  assert.ok(fault.vpu < 1e-9);
  assert.ok(fault.phase.b > 0.5 && fault.phase.c > 0.5);
  const isolated = runShortCircuit(p, { busId: 'bus-35a', faultType: '1ph' });
  assert.ok(isolated.Ik < 0.01);
});

test('motor load increases the short-circuit current', () => {
  const p = createSampleProject();
  const without = runShortCircuit(p, { busId: 'bus-110a', includeMotors: false });
  const withMotor = runShortCircuit(p, { busId: 'bus-110a', includeMotors: true });
  assert.ok(withMotor.Ik > without.Ik * 1.05);
  assert.ok(withMotor.sources.some((x) => x.kind === 'motor'));
});

test('tap and var optimization reduces losses without violating voltage limits', () => {
  const p = createSampleProject();
  const before = p.branches.find((b) => b.id === 'br-t2').tap;
  const o = runOptimization(p, { objective: 'loss', passes: 2 });
  assert.equal(p.branches.find((b) => b.id === 'br-t2').tap, before);
  assert.ok(o.best.metrics.lossP <= o.base.metrics.lossP + 1e-6);
  assert.equal(o.feasible, true);
  assert.ok(o.changes.length > 0);
  assert.ok(o.best.metrics.vMin >= 0.95 - 1e-6 && o.best.metrics.vMax <= 1.05 + 1e-6);
});

test('classical transient stability detects a stable first swing', () => {
  const p = createSampleProject();
  const stable = runTransientStability(p, { faultBusId: 'bus-110a', faultDuration: 0.1, tEnd: 2 });
  assert.equal(stable.stable, true);
  assert.ok(stable.timeline.length > 10);
  assert.ok(stable.maxSpread < 180);
  const unstable = runTransientStability(p, { faultBusId: 'bus-110a', faultDuration: 0.35, tEnd: 2 });
  assert.equal(unstable.stable, false);
  const cct = findCriticalClearingTime(p, { faultBusId: 'bus-110a', tEnd: 2 });
  assert.ok(cct.criticalTime > 0 && cct.criticalTime < 0.8);
});

test('protection sensitivity scan reports Ksen and distance reach', () => {
  const p = createSampleProject();
  autoSetAll(p, runPowerFlow(p, { algorithm: 'nr' }));
  const scan = runProtectionSensitivityScan(p, { sourceMVA: 12000, includeMotors: false });
  assert.equal(scan.summary.total, p.relays.filter((r) => r.targetType !== 'bus').length);
  assert.ok(scan.rows.some((r) => r.ksenNear != null));
  assert.ok(scan.rows.some((r) => r.z1Ratio != null));
  assert.ok(scan.rows.every((r) => r.status === 'ok' || r.status === 'warn' || r.status === 'fail'));
  assert.ok(scan.summary.minKsen > 0);
});

test('example library includes regional, industrial and large networks', () => {
  assert.equal(SAMPLE_PROJECTS.length, 3);
  for (const sample of SAMPLE_PROJECTS) {
    const p = sample.create();
    const issues = validateProject(p);
    assert.equal(issues.filter((x) => x.level === 'error').length, 0, sample.id);
    const r = runPowerFlow(p, { algorithm: 'nr', maxIter: 80 });
    assert.equal(r.converged, true, sample.id);
    assert.ok(r.vMin >= 0.95 && r.vMax <= 1.05, sample.id);
    assert.equal(r.overloads.length, 0, sample.id);
  }
  const large = SAMPLE_PROJECTS.find((x) => x.id === 'large').create();
  assert.equal(large.buses.length, 25);
  assert.equal(large.branches.length, 40);
  assert.equal(large.injections.length, 28);
  assert.equal(createSampleProject('large').buses.length, 25);
});

test('series reactor and fault current limiter reduce short-circuit current', () => {
  const make = (type, opts) => {
    const p = emptyProject();
    const b1 = newBus({ name: 'S', tag: 'S', vn: 110, type: 'slack', x: 100, y: 100 });
    const b2 = newBus({ name: 'L', tag: 'L', vn: 110, type: 'PQ', x: 600, y: 100 });
    p.buses.push(b1, b2);
    p.branches.push(newBranch(type, b1.id, b2.id, opts));
    p.injections.push(newInjection('load', b2.id, { name: 'LD', tag: 'LD', p: 20, q: 6 }));
    p.relays = [];
    return p;
  };
  const reactorSmall = make('seriesReactor', { xOhm: 0.5, rOhm: 0.02, voltageClass: 110 });
  const reactorLarge = make('seriesReactor', { xOhm: 5, rOhm: 0.02, voltageClass: 110 });
  const scSmall = runShortCircuit(reactorSmall, { busId: reactorSmall.buses[1].id, sourceMVA: 12000 });
  const scLarge = runShortCircuit(reactorLarge, { busId: reactorLarge.buses[1].id, sourceMVA: 12000 });
  assert.ok(scLarge.Ik < scSmall.Ik * 0.5);
  const fcl = make('fcl', { xNormalOhm: 0.02, xFaultOhm: 5, rOhm: 0.01, voltageClass: 110 });
  assert.equal(runPowerFlow(fcl, { algorithm: 'nr' }).converged, true);
  const scFcl = runShortCircuit(fcl, { busId: fcl.buses[1].id, sourceMVA: 12000 });
  const bypass = make('fcl', { xNormalOhm: 0.02, xFaultOhm: 0.02, rOhm: 0.01, voltageClass: 110 });
  const scBypass = runShortCircuit(bypass, { busId: bypass.buses[1].id, sourceMVA: 12000 });
  assert.ok(scFcl.Ik < scBypass.Ik * 0.5);
});

test('extended switchgear types collapse closed nodes', () => {
  for (const type of ['loadSwitch', 'disconnector', 'recloser', 'sectionalizer', 'fuse']) {
    const p = emptyProject();
    const b1 = newBus({ name: 'A', tag: 'A', vn: 110, type: 'slack', x: 100, y: 100 });
    const b2 = newBus({ name: 'B', tag: 'B', vn: 110, type: 'PQ', x: 600, y: 100 });
    p.buses.push(b1, b2);
    p.branches.push(newBranch(type, b1.id, b2.id, { closed: true }));
    p.injections.push(newInjection('load', b2.id, { name: 'LD', tag: 'LD', p: 5, q: 2 }));
    p.relays = [];
    const net = buildNetwork(p);
    assert.equal(net.nodes.length, 1, type);
  }
});

test('SVC and STATCOM shunt equivalents inject reactive power', () => {
  const p = emptyProject();
  const b1 = newBus({ name: 'S', tag: 'S', vn: 110, type: 'slack', x: 100, y: 100 });
  const b2 = newBus({ name: 'L', tag: 'L', vn: 110, type: 'PQ', x: 600, y: 100 });
  p.buses.push(b1, b2);
  p.branches.push(newBranch('line', b1.id, b2.id, { length: 10, R: 0.5, X: 4, B: 0, paramMode: 'lumped', voltageClass: 110, ratingMVA: 100 }));
  p.injections.push(
    newInjection('load', b2.id, { name: 'LD', tag: 'LD', p: 20, q: 10 }),
    newInjection('shunt', b2.id, { name: 'SVC', tag: 'SVC', q: 25, kind: 'svc' }),
    newInjection('shunt', b2.id, { name: 'STAT', tag: 'STAT', q: 10, kind: 'statcom' })
  );
  p.relays = [];
  const r = runPowerFlow(p, { algorithm: 'nr' });
  assert.equal(r.converged, true);
  assert.ok(r.busResults.find((b) => b.tag === 'L').shuntQ >= 34.9);
});

test('auto-reclosing restores a transient fault and locks out a permanent fault', () => {
  const p = createSampleProject();
  const relay = p.relays.find((r) => r.branchId === 'br-l1');
  const seq = recloseSummary(p, { relayId: relay.id, attempts: 2, deadTime: 1 });
  assert.equal(seq.transient.restored, true);
  assert.equal(seq.permanent.restored, false);
  assert.ok(seq.transient.totalOutageSeconds > 0);
  assert.ok(seq.permanent.lockoutAt > seq.permanent.events[2].t);
});

test('voltage balance and frequency response return actionable results', () => {
  const p = createSampleProject();
  const v = runVoltageBalance(p, { targetMin: 0.98, targetMax: 1.02, passes: 3 });
  assert.equal(v.summary.bestOutOfBand, 0);
  assert.equal(v.feasible, true);
  assert.ok(v.changes.length > 0);
  const f = runFrequencyResponse(p, { eventMW: 200, tEnd: 60 });
  assert.ok(f.minHz < 50 && f.finalHz > 49.9);
  assert.equal(f.stable, true);
  assert.ok(f.reserve > 0);
});

test('protection catalog covers at least 30 line, transformer and bus functions', () => {
  assert.ok(PROTECTION_COUNT >= 30);
  assert.ok(protectionsFor('line').length >= 10);
  assert.ok(protectionsFor('transformer').length >= 10);
  assert.ok(protectionsFor('bus').length >= 8);
  const ids = ['line', 'transformer', 'bus'].flatMap((c) => protectionsFor(c).map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('bus relays and protection function evaluation are available', () => {
  const p = createSampleProject();
  const busRelays = p.relays.filter((r) => r.targetType === 'bus');
  assert.equal(busRelays.length, p.buses.length);
  const r = runPowerFlow(p);
  const relay = busRelays[0];
  const rows = evaluateRelayProtections(p, relay, r, { faultCurrentA: 20000 });
  assert.ok(rows.length >= 8);
  const sum = evaluationSummary(rows);
  assert.ok(sum.enabled > 0);
  assert.ok(rows.every((x) => ['ok', 'warn', 'error', 'off'].includes(x.status)));
  const branchRelay = p.relays.find((x) => x.targetType !== 'bus');
  assert.ok(evaluateRelayProtections(p, branchRelay, r).length >= 10);
});
