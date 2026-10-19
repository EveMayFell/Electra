import { icon } from './icons.js';
import { showModal, closeModal } from './modal.js';
import { SAMPLE_PROJECTS } from '../data/sample.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const accent = ['#4ce0c3', '#ffbd66', '#8f9cff'];
const glyph = ['⌁', '▦', '◈'];

export function openExamples(app) {
  const cards = SAMPLE_PROJECTS.map((sample, i) => {
    let p;
    try { p = sample.create(); } catch { p = { buses: [], branches: [], injections: [] }; }
    return `<div class="example-card" style="--ex-accent:${accent[i % accent.length]}">
      <div class="example-top">
        <div class="example-glyph">${glyph[i % glyph.length]}</div>
        <span class="result-badge neutral">${esc(sample.short)}</span>
      </div>
      <h3>${esc(sample.name)}</h3>
      <p>${esc(sample.description)}</p>
      <div class="example-tags">${sample.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="example-stats">
        <div><b>${p.buses.length}</b><small>母线</small></div>
        <div><b>${p.branches.length}</b><small>支路</small></div>
        <div><b>${p.injections.length}</b><small>设备</small></div>
      </div>
      <button class="btn btn-primary example-load" data-example-id="${sample.id}">${icon('play', 13)} 加载该示例</button>
    </div>`;
  }).join('');

  const body = `<div class="examples-intro">${icon('info', 13)} 示例用于快速体验不同规模的网络。加载会替换当前工程，系统会提示确认；加载后可直接运行潮流、短路、稳定与报告。</div>
    <div class="examples-grid">${cards}</div>
    <div class="modal-help">大型示例包含 25 条母线与 40 条支路，建议使用滚轮缩放和“适应窗口”查看全貌；所有示例都可继续编辑、保存和导出。</div>`;
  const { root } = showModal({
    title: '示例电网库', kicker: 'EXAMPLE NETWORKS',
    subtitle: '区域输配电网 / 工业园区配电网 / 复杂大型环网',
    body, size: 'lg',
    footer: `<button class="btn" data-modal-close>关闭</button>`,
    onMount: (modalRoot) => {
      modalRoot.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      modalRoot.querySelectorAll('[data-example-id]').forEach((b) => b.addEventListener('click', () => {
        closeModal();
        app.loadExample(b.dataset.exampleId);
      }));
    }
  });
  return root;
}
