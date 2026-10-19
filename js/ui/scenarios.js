import { icon } from './icons.js';
import { showModal, closeModal } from './modal.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function openScenarioManager(app) {
  const scenarios = app.project.scenarios || [];
  const list = scenarios.length ? scenarios.map((s, i) => {
    const date = s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    return `<div class="coord-row" style="border-color:var(--line);padding:9px 10px;margin-bottom:6px;align-items:flex-start">
      <span class="status-pill neutral" style="margin-top:2px">${i + 1}</span>
      <span class="coord-names" style="white-space:normal;flex:1;min-width:0"><b style="color:var(--text-soft)">${esc(s.name)}</b><br><span style="font-size:8px;color:var(--dim)">${esc(s.note || '无备注')} · ${esc(date)}</span></span>
      <button class="btn btn-sm" data-scn-apply="${s.id}">${icon('play', 11)} 应用</button>
      <button class="btn btn-sm btn-danger" data-scn-delete="${s.id}">${icon('trash', 11)}</button>
    </div>`;
  }).join('') : `<div class="empty-state" style="padding:25px 20px"><div class="es-icon" style="width:46px;height:46px;margin-bottom:8px">${icon('layers', 22)}</div><p style="margin:0;font-size:9.5px">还没有保存的运行场景。保存当前负荷、机组出力、开关与分接头状态，即可快速切换运行方式。</p></div>`;

  const body = `<div class="form-grid" style="margin-bottom:13px">
    <div class="modal-field full"><label>场景名称</label><input data-scn-name placeholder="例如：夏季高峰 / 冬季低谷 / 风电大发"></div>
    <div class="modal-field full"><label>说明（可选）</label><textarea data-scn-note placeholder="记录负荷水平、开机方式、检修安排等"></textarea></div>
    <div class="full" style="display:flex;gap:7px;align-items:center">
      <button class="btn btn-primary" data-scn-save>${icon('save', 13)} 保存当前运行方式为场景</button>
      <button class="btn" data-scn-compare ${scenarios.length ? '' : 'disabled'}>${icon('swap', 13)} 批量对比</button>
      <span class="hint" style="margin-left:auto">${scenarios.length} 个场景</span>
    </div>
  </div>
  <div class="section-title" style="margin-bottom:8px">已保存场景</div>${list}
  <div class="modal-help">场景快照只记录母线类型/电压、机组出力、负荷、开关与分接头，不复制设备本体；新增设备不会被场景覆盖。应用场景会清空已有潮流/短路/稳定结果，需重新计算。</div>`;
  const { root } = showModal({
    title: '运行场景管理', kicker: 'OPERATING SCENARIOS',
    subtitle: '保存、应用与对比不同负荷水平、开机方式与检修安排',
    body, size: 'md',
    footer: `<button class="btn" data-modal-close>关闭</button>`,
    onMount: (modalRoot) => {
      modalRoot.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      modalRoot.querySelector('[data-scn-save]')?.addEventListener('click', () => {
        const name = modalRoot.querySelector('[data-scn-name]').value;
        const note = modalRoot.querySelector('[data-scn-note]').value;
        const ok = app.createScenario(name, note);
        if (!ok) return;
        closeModal();
        setTimeout(() => openScenarioManager(app), 200);
      });
      modalRoot.querySelector('[data-scn-compare]')?.addEventListener('click', () => {
        closeModal();
        setTimeout(() => app.compareScenarios(), 200);
      });
      modalRoot.querySelectorAll('[data-scn-apply]').forEach((b) => b.addEventListener('click', () => app.applyScenario(b.dataset.scnApply)));
      modalRoot.querySelectorAll('[data-scn-delete]').forEach((b) => b.addEventListener('click', () => {
        app.deleteScenario(b.dataset.scnDelete);
        closeModal();
        setTimeout(() => openScenarioManager(app), 200);
      }));
    }
  });
  return root;
}
