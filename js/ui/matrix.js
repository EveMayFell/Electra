import { icon } from './icons.js';
import { showModal, closeModal } from './modal.js';
import { getJacobianForResult, getDecoupledForResult } from '../engine/powerflow.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nodeLabel = (net, i) => {
  const n = net.nodes[i];
  const tag = n.buses?.[0]?.tag || n.shortName;
  return `${tag} · ${n.baseKV} kV`;
};
const angleLabel = (net, i) => `θ · ${net.nodes[i].buses?.[0]?.tag || net.nodes[i].shortName}`;
const voltageLabel = (net, i) => `V · ${net.nodes[i].buses?.[0]?.tag || net.nodes[i].shortName}`;
const busShort = (net, i) => net.nodes[i].buses?.[0]?.tag || `N${i + 1}`;

export function buildYbusTabs(net) {
  const labels = net.nodes.map((n, i) => nodeLabel(net, i));
  const short = net.nodes.map((n, i) => busShort(net, i));
  const Y = net.Y;
  const G = Y.map((row) => row.map((v) => v.re));
  const B = Y.map((row) => row.map((v) => v.im));
  const MAG = Y.map((row) => row.map((v) => Math.hypot(v.re, v.im)));
  const ANG = Y.map((row) => row.map((v) => (Math.hypot(v.re, v.im) > 1e-12 ? Math.atan2(v.im, v.re) * 180 / Math.PI : 0)));
  return {
    title: '节点导纳矩阵 Ybus',
    kicker: 'NETWORK MATRIX',
    subtitle: `基准容量 ${net.baseMVA} MVA · ${net.nodes.length} 个电气节点 · 已合并闭合开关节点`,
    meta: `${Y.length} × ${Y.length}`,
    tabs: [
      { id: 'Y', label: 'Ybus 复数', kind: 'complex', data: Y, rowLabels: labels, colLabels: short, note: 'Y = G + jB，单位为标幺值（pu）。对角线包含线路充电、并联补偿与变压器励磁支路。' },
      { id: 'G', label: '电导 G', kind: 'real', data: G, rowLabels: labels, colLabels: short, note: '节点电导矩阵（pu），反映有功损耗与串联电阻。' },
      { id: 'B', label: '电纳 B', kind: 'real', data: B, rowLabels: labels, colLabels: short, note: '节点电纳矩阵（pu），含线路充电与并联补偿。' },
      { id: 'MAG', label: '幅值 |Y|', kind: 'real', data: MAG, rowLabels: labels, colLabels: short, note: '导纳幅值矩阵（pu）。' },
      { id: 'ANG', label: '相角 ∠Y', kind: 'real', data: ANG, rowLabels: labels, colLabels: short, note: '导纳相角矩阵（度）。' }
    ],
    footer: 'Ybus 按直角坐标节点方程 I = Y·V 组集；分布参数线路先经双曲函数修正，再折算为系统基准。'
  };
}

export function buildJacobianTabs(result, variant = 'xb') {
  const jac = getJacobianForResult(result);
  const dec = getDecoupledForResult(result, variant);
  const net = result.net;
  const angleNodes = jac.angleIdx;
  const pqNodes = jac.pqIdx;
  const pRows = angleNodes.map((i) => `ΔP · ${busShort(net, i)}`);
  const qRows = pqNodes.map((i) => `ΔQ · ${busShort(net, i)}`);
  const aCols = angleNodes.map((i) => angleLabel(net, i));
  const vCols = pqNodes.map((i) => voltageLabel(net, i));
  const fullRows = [...pRows, ...qRows];
  const fullCols = [...aCols, ...vCols];
  const baseMeta = `${fullRows.length} × ${fullCols.length} · 收敛点`;
  const block = (data, rows, cols, extra = {}) => ({ id: extra.id, label: extra.label, kind: 'real', data, rowLabels: rows, colLabels: cols, note: extra.note });
  const tabs = [
    block(jac.J, fullRows, fullCols, {
      id: 'J', label: '完整 J',
      note: '极坐标牛顿法完整雅可比矩阵。上方为有功不平衡方程，右侧为电压幅值变量；H/N/M/L 四个分块以颜色区分。'
    }),
    block(jac.H, pRows, aCols, { id: 'H', label: 'H = ∂P/∂θ', note: '有功—相角子矩阵，表征有功潮流对电压相角的灵敏度。' }),
    block(jac.N, pRows, vCols, { id: 'N', label: 'N = ∂P/∂V', note: '有功—电压幅值子矩阵。' }),
    block(jac.M, qRows, aCols, { id: 'M', label: 'M = ∂Q/∂θ', note: '无功—相角子矩阵。' }),
    block(jac.L, qRows, vCols, { id: 'L', label: 'L = ∂Q/∂V', note: '无功—电压幅值子矩阵。' }),
    block(dec.Bp, angleNodes.map((i) => `ΔP/V · ${busShort(net, i)}`), angleNodes.map((i) => angleLabel(net, i)), {
      id: 'BP', label: "B′", note: dec.note + ' B′ 用于有功—相角迭代。'
    }),
    block(dec.Bpp, pqNodes.map((i) => `ΔQ/V · ${busShort(net, i)}`), pqNodes.map((i) => voltageLabel(net, i)), {
      id: 'BPP', label: 'B″', note: 'B″ 用于无功—电压幅值迭代，PQ 节点维度。'
    })
  ];
  tabs[0].partition = { angleCount: jac.angleIdx.length, pqCount: jac.pqIdx.length };
  return {
    title: '雅可比矩阵集',
    kicker: 'JACOBIAN EXPLORER',
    subtitle: `${result.label || result.algorithm} · 收敛点 · 完整矩阵及 H/N/M/L、B′、B″ 分解`,
    meta: baseMeta,
    tabs,
    footer: 'J 在收敛解处求取。H/N/M/L 的偏导按 P_calc、Q_calc 对 θ、V 的解析式组集；B′、B″ 为 PQ 分解法使用。'
  };
}

export function buildDcMatrixTabs(result) {
  const net = result.net;
  const B = result.dcB;
  const labels = net.nodes.map((n, i) => nodeLabel(net, i));
  const short = net.nodes.map((n, i) => busShort(net, i));
  return {
    title: '直流潮流 B 矩阵',
    kicker: 'DC POWER FLOW MATRIX',
    subtitle: `直流潮流线性化 · ${result.label || '直流潮流法'} · 仅含有功—相角关系`,
    meta: `${B.length} × ${B.length}`,
    tabs: [
      { id: 'B', label: 'B 直流矩阵', kind: 'real', data: B, rowLabels: labels, colLabels: short, note: 'B 由支路电抗倒数 1/x 组集，忽略电阻、充电电纳与无功。' }
    ],
    footer: '直流潮流方程 P = B·θ。因忽略电阻，网损为零，结果适用于有功分布快速估算。'
  };
}

export function openMatrixViewer(payload) {
  const tabs = payload.tabs || [];
  if (!tabs.length) return;
  let tabIndex = 0;
  let mode = 'complex';
  const decimals = 5;

  const body = `
    <div class="modal-tabs" data-matrix-tabs>
      ${tabs.map((t, i) => `<button class="modal-tab ${i === 0 ? 'active' : ''}" data-matrix-tab="${i}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="matrix-toolbar">
      <div class="matrix-mode" data-matrix-mode>
        <button class="active" data-mode="complex">a + jb</button>
        <button data-mode="real">实部</button>
        <button data-mode="imag">虚部</button>
        <button data-mode="mag">幅值</button>
      </div>
      <span class="matrix-badge" data-matrix-size></span>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-copy-matrix>${icon('copy', 12)} 复制</button>
      <button class="btn btn-sm" data-export-matrix>${icon('download', 12)} 导出 CSV</button>
    </div>
    <div class="matrix-content" data-matrix-content></div>
    <div class="matrix-toolbar" style="border-top:1px solid var(--line-soft);border-bottom:0;padding-top:8px;padding-bottom:8px">
      <div class="matrix-legend"><span><span class="sw" style="background:rgba(76,224,195,.18)"></span>对角元</span><span><span class="sw" style="background:rgba(255,189,102,.15)"></span>非零耦合</span><span>数值单位：pu</span></div>
      <span class="spacer"></span>
      <span class="matrix-info" data-matrix-note></span>
    </div>`;

  const { root } = showModal({
    title: payload.title,
    kicker: payload.kicker || 'MATRIX VIEWER',
    subtitle: payload.subtitle || '',
    body,
    size: 'matrix',
    footer: `<div class="left">${esc(payload.meta || '')} · 单击矩阵可滚动查看</div><button class="btn" data-modal-close>关闭</button>`,
    onMount: (modalRoot) => {
      const tabsRoot = modalRoot.querySelector('[data-matrix-tabs]');
      const content = modalRoot.querySelector('[data-matrix-content]');
      const note = modalRoot.querySelector('[data-matrix-note]');
      const sizeEl = modalRoot.querySelector('[data-matrix-size]');
      const modeRoot = modalRoot.querySelector('[data-matrix-mode]');
      modalRoot.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', () => closeModal()));

      const current = () => tabs[tabIndex];
      const updateModeButtons = () => {
        const t = current();
        modeRoot.style.display = t.kind === 'complex' ? 'flex' : 'none';
        modeRoot.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      };
      const displayValue = (v) => {
        if (v == null) return '—';
        if (current().kind === 'complex') {
          if (mode === 'real') return v.re.toFixed(decimals);
          if (mode === 'imag') return v.im.toFixed(decimals);
          if (mode === 'mag') return Math.hypot(v.re, v.im).toFixed(decimals);
          const re = Math.abs(v.re) < 1e-12 ? 0 : v.re;
          const im = Math.abs(v.im) < 1e-12 ? 0 : v.im;
          if (Math.abs(im) < 1e-12) return re.toFixed(decimals);
          if (Math.abs(re) < 1e-12) return `${im.toFixed(decimals)}j`;
          return `${re.toFixed(decimals)} ${im >= 0 ? '+' : '−'} ${Math.abs(im).toFixed(decimals)}j`;
        }
        return Number(v).toFixed(decimals);
      };
      const buildTable = () => {
        const t = current();
        const rows = t.data?.length || 0;
        const cols = t.data?.[0]?.length || 0;
        sizeEl.textContent = `${rows} × ${cols}`;
        const modalEl = document.querySelector('.modal-matrix');
        if (modalEl) modalEl.style.height = `${Math.min(840, Math.max(430, rows * 30 + 310))}px`;
        note.textContent = t.note || '';
        updateModeButtons();
        if (!rows) { content.innerHTML = '<div class="matrix-empty">矩阵为空</div>'; return; }
        const partition = t.partition;
        let html = '<table class="matrix-table"><thead><tr><th class="corner">行 / 列</th>';
        for (let j = 0; j < cols; j++) html += `<th title="${esc(t.colLabels?.[j] || '')}">${esc(t.colLabels?.[j] || `c${j + 1}`)}</th>`;
        html += '</tr></thead><tbody>';
        for (let i = 0; i < rows; i++) {
          html += `<tr><td class="rowhead" title="${esc(t.rowLabels?.[i] || '')}">${esc(t.rowLabels?.[i] || `r${i + 1}`)}</td>`;
          for (let j = 0; j < cols; j++) {
            const v = t.data[i][j];
            const zero = current().kind === 'complex' ? Math.hypot(v.re, v.im) < 1e-12 : Math.abs(v) < 1e-12;
            const text = zero ? '0' : displayValue(v);
            let cls = zero ? 'zero' : '';
            if (i === j) cls += ' diag';
            if (partition) {
              const inH = i < partition.angleCount && j < partition.angleCount;
              const inN = i < partition.angleCount && j >= partition.angleCount;
              const inM = i >= partition.angleCount && j < partition.angleCount;
              const inL = i >= partition.angleCount && j >= partition.angleCount;
              if (inN || inM) cls += ' partition';
              if (inL) cls += ' diag';
            }
            html += `<td class="${cls}" title="${esc(t.rowLabels?.[i] || '')} · ${esc(t.colLabels?.[j] || '')}">${text}</td>`;
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        content.innerHTML = html;
      };

      tabsRoot.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-matrix-tab]');
        if (!btn) return;
        tabIndex = Number(btn.dataset.matrixTab);
        tabsRoot.querySelectorAll('.modal-tab').forEach((b, i) => b.classList.toggle('active', i === tabIndex));
        buildTable();
      });
      modeRoot.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        mode = btn.dataset.mode;
        buildTable();
      });
      const matrixToText = () => {
        const t = current();
        const rows = [];
        rows.push(['行/列', ...(t.colLabels || [])].join('\t'));
        for (let i = 0; i < t.data.length; i++) {
          rows.push([t.rowLabels?.[i] || `r${i + 1}`, ...t.data[i].map((v) => {
            if (t.kind === 'complex') {
              if (mode === 'real') return v.re;
              if (mode === 'imag') return v.im;
              if (mode === 'mag') return Math.hypot(v.re, v.im);
              return `${v.re}${v.im >= 0 ? '+' : ''}${v.im}j`;
            }
            return v;
          })].join('\t'));
        }
        return rows.join('\n');
      };
      modalRoot.querySelector('[data-copy-matrix]')?.addEventListener('click', async () => {
        const text = matrixToText();
        try {
          await navigator.clipboard.writeText(text);
          payload.toast?.('矩阵已复制', '已复制为制表符分隔文本，可直接粘贴到 Excel。');
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          payload.toast?.('矩阵已复制', '已复制为制表符分隔文本。');
        }
      });
      modalRoot.querySelector('[data-export-matrix]')?.addEventListener('click', () => {
        const t = current();
        const csv = matrixToText().split('\n').map((line) => line.split('\t').map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${payload.title.replace(/\s+/g, '_')}_${t.label}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        payload.toast?.('已导出 CSV', '矩阵已导出，可用 Excel 打开。');
      });
      buildTable();
    }
  });
  return root;
}
