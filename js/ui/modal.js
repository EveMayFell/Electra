import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let active = null;
let keyHandler = null;

export function showModal({ title, kicker = '', subtitle = '', body = '', footer = '', size = 'md', onMount = null, closable = true }) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal modal-${size} fade-in" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          ${kicker ? `<div class="mh-kicker">${esc(kicker)}</div>` : ''}
          <h2>${esc(title)}</h2>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        ${closable ? `<button class="modal-close" data-modal-close title="关闭">${icon('close', 15)}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.classList.add('open');
  active = root.querySelector('.modal');
  const close = () => closeModal();
  root.querySelector('.modal-backdrop')?.addEventListener('click', close);
  root.querySelector('[data-modal-close]')?.addEventListener('click', close);
  keyHandler = (e) => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', keyHandler);
  if (onMount) onMount(root, active);
  return { root, modal: active };
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.classList.remove('open');
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  active = null;
  setTimeout(() => {
    if (!root.classList.contains('open')) root.innerHTML = '';
  }, 180);
}

export function confirmModal({ title = '确认操作', text = '', confirmLabel = '确认删除', danger = true, onConfirm = null }) {
  const { root } = showModal({
    title,
    kicker: 'CONFIRM',
    size: 'sm',
    body: `<div class="confirm-icon">${icon('warning', 19)}</div><div class="confirm-title">${esc(title)}</div><div class="confirm-text">${text}</div>`,
    footer: `<button class="btn" data-confirm-cancel>取消</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok>${esc(confirmLabel)}</button>`
  });
  root.querySelector('[data-confirm-cancel]').onclick = closeModal;
  root.querySelector('[data-confirm-ok]').onclick = () => {
    closeModal();
    if (onConfirm) onConfirm();
  };
}
