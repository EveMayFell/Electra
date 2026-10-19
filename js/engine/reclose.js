import { runShortCircuit } from './shortcircuit.js';
import { relayTripTimeSeconds } from './protection.js';

/**
 * Auto-reclosing sequence evaluator for one line/transformer relay. It does not
 * model travelling waves: it creates the protection/breaker/reclose timeline
 * from the relay settings and the short-circuit current at the remote terminal.
 */
export function runRecloseSequence(project, options = {}) {
  const relay = options.relayId
    ? project.relays.find((r) => r.id === options.relayId)
    : project.relays.find((r) => r.branchId === options.branchId);
  const branch = project.branches.find((b) => b.id === (options.branchId || relay?.branchId));
  if (!relay || !branch) throw new Error('未找到线路保护或支路。');
  const rc = relay.reclose || { enabled: true, attempts: 1, deadTime: 1.0, reclaimTime: 30 };
  const rcEnabled = rc.enabled !== false && rc.enabled !== 'false' && rc.enabled !== 0 && rc.enabled !== '0';
  const enabled = options.enabled != null ? options.enabled : rcEnabled;
  const attempts = Math.max(0, Math.min(5, Number(options.attempts ?? rc.attempts ?? 1)));
  const deadTime = Math.max(0.05, Number(options.deadTime ?? rc.deadTime ?? 1.0));
  const breakerTime = Math.max(0.01, Number(options.breakerTime ?? 0.06));
  const faultType = options.faultType === 'permanent' ? 'permanent' : 'transient';
  let faultCurrentA = Number(options.faultCurrentA) || 0;
  if (!(faultCurrentA > 0)) {
    const toBus = project.buses.find((b) => b.id === branch.to) || project.buses.find((b) => b.id === branch.from);
    try {
      const sc = runShortCircuit(project, { busId: toBus?.id, sourceMVA: options.sourceMVA, c: options.c ?? 1.1 });
      const row = sc.branchCurrents?.find((x) => x.id === branch.id);
      faultCurrentA = row ? Math.max(row.iFrom || 0, row.iTo || 0) * 1000 : (sc.Ik || 0) * 1000;
    } catch {
      faultCurrentA = 0;
    }
  }
  let protectionTime = Number(options.protectionTime);
  if (!(protectionTime > 0)) {
    protectionTime = relayTripTimeSeconds(relay, faultCurrentA);
    if (!Number.isFinite(protectionTime)) protectionTime = 0.1;
  }
  const events = [];
  const add = (t, type, text) => events.push({ t: Number(t.toFixed(3)), type, text });
  add(0, 'fault', faultType === 'transient' ? '线路发生瞬时性故障' : '线路发生永久性故障');
  add(protectionTime, 'trip', `保护动作，${protectionTime.toFixed(3)} s 跳闸`);
  let t = protectionTime + breakerTime;
  add(t, 'open', `断路器分闸，故障电流开断（${faultCurrentA.toFixed(0)} A）`);
  let restored = false;
  let attemptsUsed = 0;
  let lockoutAt = null;
  if (!enabled) {
    add(t, 'lockout', '重合闸退出，直接闭锁');
    lockoutAt = t;
  } else {
    for (let i = 1; i <= attempts; i++) {
      t += deadTime;
      attemptsUsed = i;
      add(t, 'reclose', `第 ${i} 次重合闸，合闸于${faultType === 'transient' ? '已熄弧' : '仍存在故障'}的线路`);
      if (faultType === 'transient') {
        add(t, 'restore', '重合成功，恢复供电');
        restored = true;
        break;
      }
      t += protectionTime;
      add(t, 'trip', '故障仍存在，保护再次动作');
      t += breakerTime;
      add(t, 'open', '断路器再次分闸');
      if (i === attempts) {
        add(t, 'lockout', `重合 ${attempts} 次失败，重合闸闭锁`);
        lockoutAt = t;
      }
    }
  }
  const outage = restored ? protectionTime + breakerTime : null;
  return {
    relayId: relay.id,
    relayName: relay.name,
    branchId: branch.id,
    branchName: branch.name,
    branchTag: branch.tag,
    enabled,
    attempts,
    deadTime,
    breakerTime,
    faultType,
    faultCurrentA,
    protectionTime,
    events,
    restored,
    lockoutAt,
    attemptsUsed,
    totalOutageSeconds: outage,
    finalStatus: restored ? '重合成功，恢复供电' : (enabled ? '重合失败，闭锁' : '重合闸退出'),
    timeEnd: events[events.length - 1]?.t || 0,
    notes: [
      '重合闸时序按保护动作时间、断路器分闸时间与整定死区时间生成。',
      '瞬时性故障默认第一次重合成功；永久性故障每次重合后再次跳闸，达到次数后闭锁。',
      '本模块不模拟潜供电流、熄灭时间、检同期与检无压逻辑，正式设计应按线路条件校核。'
    ]
  };
}

export function recloseSummary(project, options = {}) {
  const transient = runRecloseSequence(project, { ...options, faultType: 'transient' });
  const permanent = runRecloseSequence(project, { ...options, faultType: 'permanent' });
  return { transient, permanent };
}
