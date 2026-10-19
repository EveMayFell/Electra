import {
  clone, loadProject, emptyProject, summarize, validateProject, ensureRelays, newRelay
} from './model.js';
import { createSampleProject, SAMPLE_PROJECTS } from './data/sample.js';
import { PROTECTION_CATALOG, PROTECTION_COUNT, protectionsFor } from './data/protectionCatalog.js';
import {
  runPowerFlow, buildNetwork, ALGORITHMS
} from './engine/powerflow.js';
import { autoSetAll, autoSetRelay, branchLevels, protectionSummary, resetRelayToFactory, runProtectionSensitivityScan } from './engine/protection.js';
import { runShortCircuit, scanShortCircuitBuses } from './engine/shortcircuit.js';
import { recloseSummary } from './engine/reclose.js';
import { runN1Scan } from './engine/contingency.js';
import { runOptimization } from './engine/optimize.js';
import { runTransientStability, findCriticalClearingTime } from './engine/stability.js';
import { runVoltageBalance, runFrequencyResponse } from './engine/regulation.js';
import { SchematicEditor } from './ui/diagram.js';
import { renderInspector, bindInspector } from './ui/inspector.js';
import { icon } from './ui/icons.js';
import { showModal, closeModal, confirmModal } from './ui/modal.js';
import { renderAnalysis, bindAnalysis } from './ui/analysis.js';
import { renderProtection, bindProtection } from './ui/protection.js';
import { renderShortCircuit, bindShortCircuit } from './ui/shortcircuit.js';
import { renderReport, bindReport } from './ui/report.js';
import { renderStability, bindStability } from './ui/stability.js';
import { renderRegulation, bindRegulation } from './ui/regulation.js';
import { openScenarioManager } from './ui/scenarios.js';
import { openDataExchange } from './ui/dataExchange.js';
import { openExamples } from './ui/examples.js';
import { buildYbusTabs, buildJacobianTabs, buildDcMatrixTabs, openMatrixViewer } from './ui/matrix.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STORAGE_KEY = 'electra.powerstudio.project.v1';
const MODES = [
  { id: 'design', label: '主接线设计', icon: 'bus' },
  { id: 'analysis', label: '潮流分析', icon: 'waveform' },
  { id: 'protection', label: '继电保护', icon: 'shield' },
  { id: 'shortcircuit', label: '短路校验', icon: 'bolt' },
  { id: 'stability', label: '稳定分析', icon: 'wave' },
  { id: 'regulation', label: '调节系统', icon: 'sliders' },
  { id: 'report', label: '工程报告', icon: 'report' }
];

class App {
  constructor() {
    this.mode = 'design';
    this.selection = { kind: 'project', id: null };
    this.results = null;
    this.shortCircuit = null;
    this.issues = [];
    this.history = [];
    this.future = [];
    this.ui = { showFlow: true, grid: true, compactLabels: false };
    this.analysisOptions = { algorithm: 'nr', tol: 1e-8, maxIter: 30, damping: 1, qLimits: false };
    this.scOptions = { busId: null, faultType: '3ph', c: 1.1, sourceMVA: 12000, faultImpedanceOhm: 0, includeMotors: true };
    this.stabilityOptions = { faultBusId: null, faultStart: 0.1, faultDuration: 0.15, tEnd: 4, dt: 0.01 };
    this.stabilityResult = null;
    this.stabilityCCT = null;
    this.regulationOptions = { targetMin: 0.98, targetMax: 1.02, eventType: 'generatorTrip', eventMW: 200, droop: 5, tEnd: 60, agc: true };
    this.voltageBalanceResult = null;
    this.frequencyResult = null;
    this.protectionSelectedId = null;
    this.protectionFilter = 'all';
    this.protectionFaultCurrent = null;
    this.protectionSummary = null;
    this.protectionSensitivity = null;
    this.lastDiagramSVG = null;
    this.resultsSignature = null;
    this.shortCircuitSignature = null;
    this.scanShortCircuitResult = null;
    this.scanShortCircuitSignature = null;
    this.saveTimer = null;
    this.renderTimer = null;
    this.firstDesign = true;
    this.dirty = false;
    this.editor = null;

    this.bootProject();
    this.mountShell();
    this.bindGlobalEvents();
    this.refreshValidation();
    this.resetHistory();
    this.setMode('design', true);
    this.refreshShell();
    this.toast('工程已就绪', `${this.project.buses.length} 条母线、${this.project.branches.length} 条支路。可直接查看示例或开始编辑。`);
    setTimeout(() => this.persistNow(true), 900);
  }

  bootProject() {
    let loaded = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = loadProject(JSON.parse(raw));
    } catch (e) {
      console.warn('本地工程读取失败', e);
    }
    if (loaded) {
      this.project = loaded;
      this.restored = true;
    } else {
      this.project = createSampleProject();
      autoSetAll(this.project, null);
      this.restored = false;
    }
    this.ui.compactLabels = this.project.meta.compactLabels != null ? !!this.project.meta.compactLabels : this.project.buses.length > 18;
    this.ui.showFlow = !this.ui.compactLabels;
    this.scOptions.sourceMVA = Number(this.project.meta.sourceMVA) || 12000;
    this.scOptions.busId = this.project.buses.find((b) => b.type === 'slack')?.id || this.project.buses[0]?.id || null;
    this.stabilityOptions.faultBusId = this.project.buses.find((b) => b.type !== 'slack')?.id || this.project.buses[0]?.id || null;
    ensureRelays(this.project);
    this.protectionSelectedId = this.project.relays[0]?.id || null;
    this.protectionFaultCurrent = this.project.relays[0] ? Math.max(1000, this.project.relays[0].overcurrent.pickup * 4) : 4000;
  }

  mountShell() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${icon('logo', 23)}</div>
          <div class="brand-copy"><div class="brand-name">ELECTRA<span>.</span></div><div class="brand-sub">POWER SYSTEM STUDIO</div></div>
        </div>
        <div class="project-crumbs">
          <div class="crumb-main"><div class="crumb-title" id="project-title">${esc(this.project.meta.name)}</div><div class="crumb-sub" id="project-sub">${esc(this.project.meta.projectNo)} · ${esc(this.project.meta.owner || '')}</div></div>
          <span class="crumb-badge"><span class="dot"></span>本地工程</span>
          <span class="save-state" id="save-state">${icon('check', 11)} 已保存</span>
        </div>
        <div class="top-actions">
          <button class="icon-btn" data-shell-action="undo" title="撤销 (Ctrl+Z)" id="undo-btn">${icon('undo', 16)}</button>
          <button class="icon-btn" data-shell-action="redo" title="重做 (Ctrl+Y)" id="redo-btn">${icon('redo', 16)}</button>
          <span class="top-divider"></span>
          <button class="btn btn-ghost" data-shell-action="open" title="打开工程">${icon('folder', 15)} 打开</button>
          <button class="btn btn-ghost" data-shell-action="save" title="保存到浏览器 (Ctrl+S)">${icon('save', 15)} 保存</button>
          <button class="btn btn-ghost" data-shell-action="export-project" title="下载工程 JSON">${icon('download', 15)} 导出</button>
          <button class="icon-btn" data-shell-action="examples" title="示例电网库">${icon('flask', 16)}</button>
          <button class="icon-btn" data-shell-action="scenarios" title="运行场景">${icon('layers', 16)}</button>
          <button class="icon-btn" data-shell-action="data-exchange" title="数据导入导出">${icon('database', 16)}</button>
          <button class="icon-btn" data-shell-action="settings" title="工程设置">${icon('settings', 16)}</button>
          <button class="btn btn-primary" data-shell-action="run" title="运行潮流 (Ctrl+Enter)">${icon('play', 14)} 运行潮流</button>
        </div>
      </header>
      <nav class="modebar">
        <div class="mode-tabs">
          ${MODES.map((m) => `<button class="mode-tab ${m.id === this.mode ? 'active' : ''}" data-mode="${m.id}">${icon(m.icon, 16)} ${m.label}</button>`).join('')}
        </div>
        <div class="modebar-right">
          <span class="network-pill">${icon('bus', 13)} <b id="nav-bus-count">${this.project.buses.length}</b> 节点 <span style="opacity:.4">/</span> <b id="nav-branch-count">${this.project.branches.length}</b> 支路</span>
          <span class="sep"></span>
          <span id="nav-result-state">潮流：未计算</span>
          <span class="sep"></span>
          <button class="icon-btn" style="width:27px;height:27px" data-shell-action="shortcuts" title="快捷键">${icon('keyboard', 14)}</button>
        </div>
      </nav>
      <main id="view-root"></main>
    `;
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.id = 'project-file-input';
    file.hidden = true;
    document.body.appendChild(file);
    file.addEventListener('change', () => this.loadFromFile(file));
  }

  bindGlobalEvents() {
    document.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('.mode-tab[data-mode]');
      if (modeBtn) { this.setMode(modeBtn.dataset.mode); return; }
      const shellBtn = e.target.closest('[data-shell-action]');
      if (shellBtn) {
        const a = shellBtn.dataset.shellAction;
        if (a === 'undo') this.undo();
        else if (a === 'redo') this.redo();
        else if (a === 'save') this.saveNow();
        else if (a === 'open') this.openFilePicker();
        else if (a === 'export-project') this.exportProject();
        else if (a === 'settings') this.openProjectSettings();
        else if (a === 'run') this.runAnalysis();
        else if (a === 'shortcuts') this.openShortcuts();
        else if (a === 'scenarios') this.openScenarioManager();
        else if (a === 'data-exchange') this.openDataExchange();
        else if (a === 'examples') this.openExamples();
        return;
      }
      const quick = e.target.closest('[data-action="quick-add-bus"]');
      if (quick && this.editor) {
        const stage = this.editor.stage.getBoundingClientRect();
        const p = this.editor.screenToWorld(stage.left + stage.width / 2, stage.top + stage.height / 2);
        this.editor.addBusAt(p);
      }
      if (e.target.closest('[data-modal-close]') && e.target.closest('#modal-root')) closeModal();
    });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('beforeunload', () => this.persistNow());
    window.addEventListener('resize', () => { if (this.mode === 'design') this.editor?.applyView(); });
  }

  onKeyDown(e) {
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.saveNow();
      return;
    }
    if (mod && e.key === 'Enter') { e.preventDefault(); this.runAnalysis(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openFilePicker(); return; }
    if (!inField && mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if (!inField && mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.redo(); return; }
    if (inField) return;
    const modalOpen = document.getElementById('modal-root')?.classList.contains('open');
    if (modalOpen) return;
    if ((e.key === 'b' || e.key === 'B') && this.mode === 'design') { e.preventDefault(); this.editor?.arm('bus'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.mode === 'design' && this.selection.kind !== 'project') { e.preventDefault(); this.deleteSelection(); }
    }
    if ((e.key === 'f' || e.key === 'F') && this.mode === 'design') { e.preventDefault(); this.editor?.fit(); }
    if ((e.key === 'v' || e.key === 'V') && this.mode === 'design') { this.editor?.setTool('select'); }
    if ((e.key === 'h' || e.key === 'H') && this.mode === 'design') { this.editor?.setTool('pan'); }
  }

  /* ---------------- Mode and view lifecycle ---------------- */
  setMode(mode, force = false) {
    if (!force && this.mode === mode) return;
    if (this.mode === 'design' && this.editor && mode !== 'design') this.captureDiagram();
    if (this.editor) { this.editor.destroy(); this.editor = null; }
    this.mode = mode;
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const root = document.getElementById('view-root');
    if (mode === 'design') this.renderDesignView(root);
    else if (mode === 'analysis') this.renderAnalysisView(root);
    else if (mode === 'protection') this.renderProtectionView(root);
    else if (mode === 'shortcircuit') this.renderShortCircuitView(root);
    else if (mode === 'stability') this.renderStabilityView(root);
    else if (mode === 'regulation') this.renderRegulationView(root);
    else if (mode === 'report') this.renderReportView(root);
    this.refreshShell();
    this.refreshSaveState();
  }

  renderDesignView(root) {
    const p = this.project;
    const s = summarize(p);
    root.innerHTML = `<div class="design-shell">
      <aside class="palette">
        <div class="panel-label"><span>设备库</span><span class="count">ELEMENTS</span></div>
        <div class="palette-search">${icon('search', 13)}<input id="palette-search" type="text" placeholder="搜索设备…" autocomplete="off"></div>
        <div class="palette-group" data-palette-group>
          <div class="panel-label"><span>节点</span><span class="count">NODE</span></div>
          <div class="palette-items">
            <button class="palette-item" data-palette="bus" data-label="母线 busbar 节点"><span class="p-icon">${icon('bus', 21)}</span><span class="p-label">母线</span><span class="p-sub">busbar</span><span class="p-key">B</span></button>
          </div>
        </div>
        <div class="palette-group" data-palette-group>
          <div class="panel-label"><span>支路</span><span class="count">BRANCH</span></div>
          <div class="palette-items">
            <button class="palette-item" data-palette="line" data-label="线路 架空线 line overhead"><span class="p-icon">${icon('line', 21)}</span><span class="p-label">架空线路</span><span class="p-sub">overhead</span></button>
            <button class="palette-item" data-palette="cable" data-label="电缆 电缆线路 cable"><span class="p-icon">${icon('cable', 21)}</span><span class="p-label">电缆</span><span class="p-sub">XLPE cable</span></button>
            <button class="palette-item" data-palette="transformer" data-label="变压器 主变 transformer"><span class="p-icon">${icon('transformer', 21)}</span><span class="p-label">变压器</span><span class="p-sub">two-winding</span></button>
            <button class="palette-item" data-palette="transformer3" data-label="三绕组变压器 主变 transformer three winding"><span class="p-icon">${icon('transformer3', 21)}</span><span class="p-label">三绕组变压器</span><span class="p-sub">three-winding</span></button>
          </div>
        </div>
        <div class="palette-group">
          <div class="panel-label"><span>补偿 / 限流</span><span class="count">COMPENSATION</span></div>
          <div class="palette-items">
            <button class="palette-item" data-palette="seriesReactor" data-label="串联电抗器 限流电抗器 series reactor"><span class="p-icon">${icon('seriesReactor', 21)}</span><span class="p-label">串联电抗器</span><span class="p-sub">current limiting</span></button>
            <button class="palette-item" data-palette="seriesCap" data-label="串联电容器 补偿 串补 series capacitor"><span class="p-icon">${icon('seriesCap', 21)}</span><span class="p-label">串联电容器</span><span class="p-sub">series comp</span></button>
            <button class="palette-item" data-palette="fcl" data-label="故障电流限制器 限流器 FCL fault current limiter"><span class="p-icon">${icon('fcl', 21)}</span><span class="p-label">故障限流器</span><span class="p-sub">FCL</span></button>
            <button class="palette-item" data-palette="shunt" data-label="电容器 电抗器 SVC STATCOM 滤波 补偿 shunt"><span class="p-icon">${icon('capacitor', 21)}</span><span class="p-label">并联补偿</span><span class="p-sub">C / L / SVC</span></button>
          </div>
        </div>
        <div class="palette-group">
          <div class="panel-label"><span>开关设备</span><span class="count">SWITCHGEAR</span></div>
          <div class="palette-items">
            <button class="palette-item" data-palette="breaker" data-label="断路器 开关 breaker"><span class="p-icon">${icon('breaker', 21)}</span><span class="p-label">断路器</span><span class="p-sub">breaker</span></button>
            <button class="palette-item" data-palette="loadSwitch" data-label="负荷开关 load switch"><span class="p-icon">${icon('loadSwitch', 21)}</span><span class="p-label">负荷开关</span><span class="p-sub">load switch</span></button>
            <button class="palette-item" data-palette="disconnector" data-label="隔离开关 刀闸 disconnector"><span class="p-icon">${icon('disconnector', 21)}</span><span class="p-label">隔离开关</span><span class="p-sub">disconnector</span></button>
            <button class="palette-item" data-palette="recloser" data-label="重合器 recloser"><span class="p-icon">${icon('recloser', 21)}</span><span class="p-label">重合器</span><span class="p-sub">recloser</span></button>
            <button class="palette-item" data-palette="sectionalizer" data-label="分段器 sectionalizer"><span class="p-icon">${icon('sectionalizer', 21)}</span><span class="p-label">分段器</span><span class="p-sub">sectionalizer</span></button>
            <button class="palette-item" data-palette="fuse" data-label="熔断器 fuse"><span class="p-icon">${icon('fuse', 21)}</span><span class="p-label">熔断器</span><span class="p-sub">fuse</span></button>
          </div>
        </div>
        <div class="palette-group">
          <div class="panel-label"><span>电源与负荷</span><span class="count">SOURCES</span></div>
          <div class="palette-items">
            <button class="palette-item" data-palette="generator" data-label="发电机 电源 generator"><span class="p-icon">${icon('generator', 21)}</span><span class="p-label">发电机</span><span class="p-sub">generator</span></button>
            <button class="palette-item" data-palette="load" data-label="负荷 用户 load"><span class="p-icon">${icon('load', 21)}</span><span class="p-label">负荷</span><span class="p-sub">load</span></button>
          </div>
        </div>
        <div class="palette-tip">
          <div class="tip-head">${icon('sparkles', 13)} 快速开始</div>
          单击设备后，在画布中选择母线或空白处放置。拖动画布中的母线即可重新布线。<br>
          <span style="color:var(--dim)">快捷键</span> <kbd>F</kbd> 适应窗口 · <kbd>Ctrl</kbd>+<kbd>↵</kbd> 计算潮流
        </div>
        <div class="palette-footer">
          <button class="mini-action" data-palette-action="settings">${icon('settings', 13)} 工程设置</button>
          <button class="mini-action" data-palette-action="scenarios">${icon('layers', 13)} 运行场景管理</button>
          <button class="mini-action" data-palette-action="data-exchange">${icon('database', 13)} 数据导入 / 导出</button>
          <button class="mini-action" data-palette-action="sample">${icon('flask', 13)} 加载示例电网</button>
          <button class="mini-action" data-palette-action="blank">${icon('plus', 13)} 新建空白工程</button>
          <button class="mini-action" data-palette-action="export-png">${icon('download', 13)} 导出 PNG 单线图</button>
          <button class="mini-action" data-palette-action="shortcuts">${icon('keyboard', 13)} 快捷键与帮助</button>
        </div>
      </aside>
      <section class="canvas-column" id="editor-host"></section>
      <aside class="inspector" id="inspector-root"></aside>
    </div>`;

    this.editor = new SchematicEditor(root.querySelector('#editor-host'), this);
    const printRoot = root.querySelector('#inspector-root');
    renderInspector(this, printRoot);
    bindInspector(printRoot, this);
    this.bindPalette(root);
    this.editor.render();
    this.refreshValidation();
    this.editor.updateStatus();
    if (this.firstDesign) {
      this.firstDesign = false;
      setTimeout(() => this.editor?.fit(), 60);
    }
    this.updateToolbarFlow();
  }

  bindPalette(root) {
    root.querySelectorAll('[data-palette]').forEach((b) => b.addEventListener('click', () => {
      this.editor?.arm(b.dataset.palette);
    }));
    const search = root.querySelector('#palette-search');
    if (search) search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      root.querySelectorAll('.palette-item').forEach((item) => {
        const hit = !q || (item.dataset.label || '').toLowerCase().includes(q);
        item.style.display = hit ? '' : 'none';
      });
      root.querySelectorAll('[data-palette-group]').forEach((g) => {
        const items = [...g.querySelectorAll('.palette-item')];
        g.style.display = items.some((i) => i.style.display !== 'none') ? '' : 'none';
      });
    });
    root.querySelectorAll('[data-palette-action]').forEach((b) => b.addEventListener('click', () => {
      const action = b.dataset.paletteAction;
      if (action === 'settings') this.openProjectSettings();
      if (action === 'scenarios') this.openScenarioManager();
      if (action === 'data-exchange') this.openDataExchange();
      if (action === 'sample') this.openExamples();
      if (action === 'blank') this.newBlankPrompt();
      if (action === 'export-png') this.editor?.exportPNG();
      if (action === 'shortcuts') this.openShortcuts();
    }));
  }

  renderAnalysisView(root) {
    root.innerHTML = `<div id="analysis-root" class="view">${renderAnalysis(this)}</div>`;
    bindAnalysis(root.querySelector('#analysis-root'), this);
  }

  renderProtectionView(root) {
    this.protectionSummary = protectionSummary(this.project, this.results);
    root.innerHTML = `<div id="protection-root" class="view">${renderProtection(this)}</div>`;
    bindProtection(root.querySelector('#protection-root'), this);
  }

  renderShortCircuitView(root) {
    root.innerHTML = `<div id="sc-root" class="view">${renderShortCircuit(this)}</div>`;
    bindShortCircuit(root.querySelector('#sc-root'), this);
  }

  renderStabilityView(root) {
    root.innerHTML = `<div id="stability-root" class="view">${renderStability(this)}</div>`;
    bindStability(root.querySelector('#stability-root'), this);
  }

  renderRegulationView(root) {
    root.innerHTML = `<div id="regulation-root" class="view">${renderRegulation(this)}</div>`;
    bindRegulation(root.querySelector('#regulation-root'), this);
  }

  renderReportView(root) {
    root.innerHTML = `<div id="report-root" class="view">${renderReport(this)}</div>`;
    bindReport(root.querySelector('#report-root'), this);
  }

  rerender() {
    if (this.mode === 'design') {
      this.refreshValidation();
      this.editor?.render();
      this.renderInspector();
      this.refreshShell();
      return;
    }
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === this.mode));
    const root = document.getElementById('view-root');
    if (this.mode === 'analysis') this.renderAnalysisView(root);
    else if (this.mode === 'protection') this.renderProtectionView(root);
    else if (this.mode === 'shortcircuit') this.renderShortCircuitView(root);
    else if (this.mode === 'stability') this.renderStabilityView(root);
    else if (this.mode === 'regulation') this.renderRegulationView(root);
    else if (this.mode === 'report') this.renderReportView(root);
    this.refreshShell();
  }

  setArmed(kind) {
    document.querySelectorAll('.palette-item').forEach((b) => b.classList.toggle('armed', b.dataset.palette === kind));
  }

  /* ---------------- Selection ---------------- */
  select(kind, id) {
    this.selection = { kind, id };
    if (this.mode === 'design') {
      this.renderInspector();
      this.editor?.render();
    }
  }

  renderInspector() {
    const root = document.getElementById('inspector-root');
    if (!root) return;
    const wasBound = root.dataset.bound;
    renderInspector(this, root);
    if (!wasBound) bindInspector(root, this);
  }

  selectProtectionBranch(branchId) {
    const relay = this.project.relays.find((r) => r.branchId === branchId);
    if (relay) {
      this.protectionSelectedId = relay.id;
      this.protectionFaultCurrent = Math.max(Number(this.protectionFaultCurrent) || 0, Number(relay.overcurrent.pickup) * 4);
    }
    this.rerender();
  }

  /* ---------------- Persistence / history ---------------- */
  resetHistory() {
    this.history = [clone(this.project)];
    this.future = [];
    this.updateHistoryButtons();
  }

  commit(label = '修改工程') {
    const current = clone(this.project);
    const last = this.history[this.history.length - 1];
    if (!last || JSON.stringify(last) !== JSON.stringify(current)) {
      this.history.push(current);
      if (this.history.length > 60) this.history.shift();
      this.future = [];
      this.dirty = true;
      this.updateHistoryButtons();
      this.scheduleSave();
    }
    this.refreshSaveState();
  }

  undo() {
    if (this.history.length <= 1) return;
    this.future.push(this.history.pop());
    this.project = clone(this.history[this.history.length - 1]);
    this.afterTimeTravel('撤销完成');
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(clone(this.project));
    this.project = clone(this.future.pop());
    this.afterTimeTravel('重做完成');
  }

  afterTimeTravel(msg) {
    const signature = this.electricalSignature();
    if (this.results && this.resultsSignature !== signature) this.results = null;
    if (this.shortCircuit && this.shortCircuitSignature !== signature) this.shortCircuit = null;
    if (this.scanShortCircuitResult && this.scanShortCircuitSignature !== signature) this.scanShortCircuitResult = null;
    this.n1Result = null;
    this.protectionSensitivity = null;
    this.stabilityResult = null;
    this.stabilityCCT = null;
    this.syncResultLabels();
    const sel = this.selection;
    const exists = sel.kind === 'bus'
      ? this.project.buses.some((b) => b.id === sel.id)
      : sel.kind === 'branch'
        ? this.project.branches.some((b) => b.id === sel.id)
        : sel.kind === 'injection'
          ? this.project.injections.some((x) => x.id === sel.id)
          : true;
    if (!exists) this.selection = { kind: 'project', id: null };
    this.validationAfterRestore();
    if (this.mode !== 'design') {
      this.rerender();
    } else {
      this.refreshAll();
    }
    this.updateHistoryButtons();
    this.refreshSaveState();
    this.scheduleSave();
    this.toast(msg, '工程状态已恢复。');
  }

  validationAfterRestore() {
    if (!this.project.relays) this.project.relays = [];
    ensureRelays(this.project);
    if (!this.project.relays.some((r) => r.id === this.protectionSelectedId)) {
      this.protectionSelectedId = this.project.relays[0]?.id || null;
    }
    this.scOptions.sourceMVA = Number(this.project.meta.sourceMVA) || 12000;
    if (!this.project.buses.some((b) => b.id === this.scOptions.busId)) {
      this.scOptions.busId = this.project.buses.find((b) => b.type === 'slack')?.id || this.project.buses[0]?.id || null;
    }
    this.refreshValidation();
    this.updateProjectChrome();
  }

  updateHistoryButtons() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.disabled = this.history.length <= 1;
    if (r) r.disabled = !this.future.length;
  }

  scheduleSave() {
    this.dirty = true;
    this.refreshSaveState();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persistNow(true), 650);
  }

  persistNow(silent = false) {
    try {
      this.project.meta.zeroSeqMigrated = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
      this.dirty = false;
      this.lastSavedAt = Date.now();
      this.refreshSaveState();
      if (!silent) this.toast('工程已保存', '已保存到浏览器本地存储，可在下次打开时继续。');
    } catch (e) {
      if (!silent) this.toast('保存失败', '浏览器本地存储不可用，请导出工程 JSON 备份。', 'error');
    }
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.persistNow(false);
  }

  refreshSaveState() {
    const el = document.getElementById('save-state');
    if (!el) return;
    if (this.dirty) {
      el.classList.add('is-dirty');
      el.innerHTML = `${icon('clock', 11)} 未保存`;
    } else {
      el.classList.remove('is-dirty');
      el.innerHTML = `${icon('check', 11)} 已保存`;
    }
  }

  exportProject() {
    const data = JSON.stringify(this.project, null, 2);
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name || '电力工程'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('工程已导出', 'JSON 文件包含全部设备参数、保护定值与视图位置。');
  }

  openFilePicker() {
    document.getElementById('project-file-input')?.click();
  }

  async loadFromFile(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = loadProject(JSON.parse(text));
      this.project = data;
      this.ui.compactLabels = !!data.meta.compactLabels;
      this.ui.showFlow = !this.ui.compactLabels;
      this.results = null;
      this.resultsSignature = null;
      this.shortCircuit = null;
      this.shortCircuitSignature = null;
      this.scanShortCircuitResult = null;
      this.scanShortCircuitSignature = null;
      this.n1Result = null;
      this.stabilityResult = null;
      this.stabilityCCT = null;
      this.selection = { kind: 'project', id: null };
      this.protectionSelectedId = this.project.relays[0]?.id || null;
      this.scOptions.busId = this.project.buses.find((b) => b.type === 'slack')?.id || this.project.buses[0]?.id || null;
      this.scOptions.sourceMVA = Number(this.project.meta.sourceMVA) || 12000;
      this.stabilityOptions.faultBusId = this.project.buses.find((b) => b.type !== 'slack')?.id || null;
      this.resetHistory();
      this.refreshValidation();
      this.updateProjectChrome();
      this.firstDesign = true;
      this.setMode('design', true);
      this.toast('工程已打开', `${data.meta.name} · ${data.buses.length} 条母线。`);
    } catch (e) {
      this.toast('打开失败', e.message || '工程文件格式无效。', 'error');
    }
  }

  openExamples() {
    openExamples(this);
  }

  loadSamplePrompt() {
    this.openExamples();
  }

  loadExample(id) {
    const sample = SAMPLE_PROJECTS.find((x) => x.id === id) || SAMPLE_PROJECTS[0];
    confirmModal({
      title: `加载“${sample.name}”？`,
      text: `该示例包含 ${sample.short}。当前工程将被替换，建议先导出或保存现有工程。`,
      confirmLabel: '加载示例',
      danger: false,
      onConfirm: () => {
        this.project = sample.create();
        autoSetAll(this.project, null);
        this.ui.compactLabels = !!this.project.meta.compactLabels;
        this.ui.showFlow = !this.ui.compactLabels;
        this.results = null;
        this.resultsSignature = null;
        this.shortCircuit = null;
        this.shortCircuitSignature = null;
        this.scanShortCircuitResult = null;
        this.scanShortCircuitSignature = null;
        this.n1Result = null;
        this.stabilityResult = null;
        this.stabilityCCT = null;
        this.protectionSensitivity = null;
        this.protectionSummary = null;
        this.optimizationResult = null;
        this.voltageBalanceResult = null;
        this.frequencyResult = null;
        this.lastDiagramSVG = null;
        this.selection = { kind: 'project', id: null };
        this.protectionSelectedId = this.project.relays[0]?.id || null;
        this.protectionFaultCurrent = this.project.relays[0] ? Math.max(1000, this.project.relays[0].overcurrent.pickup * 4) : 4000;
        this.scOptions.busId = this.project.buses.find((b) => b.type === 'slack')?.id || null;
        this.scOptions.faultType = '3ph';
        this.scOptions.faultImpedanceOhm = 0;
        this.scOptions.sourceMVA = Number(this.project.meta.sourceMVA) || 12000;
        this.stabilityOptions.faultBusId = this.project.buses.find((b) => b.type !== 'slack')?.id || null;
        this.resetHistory();
        this.refreshValidation();
        this.updateProjectChrome();
        this.firstDesign = true;
        this.setMode('design', true);
        this.persistNow(true);
        this.toast('示例已加载', `${sample.name} · ${this.project.buses.length} 母线 / ${this.project.branches.length} 支路，可直接运行潮流。`);
      }
    });
  }

  legacyLoadSamplePrompt() {
    confirmModal({
      title: '加载示例电网？',
      text: '当前工程将被替换。建议先导出或保存现有工程。',
      confirmLabel: '加载示例',
      danger: false,
      onConfirm: () => {
        this.project = createSampleProject();
        autoSetAll(this.project, null);
        this.results = null;
        this.resultsSignature = null;
        this.shortCircuit = null;
        this.shortCircuitSignature = null;
        this.scanShortCircuitResult = null;
        this.scanShortCircuitSignature = null;
        this.n1Result = null;
        this.stabilityResult = null;
        this.stabilityCCT = null;
        this.selection = { kind: 'project', id: null };
        this.protectionSelectedId = this.project.relays[0]?.id || null;
        this.scOptions.busId = this.project.buses.find((b) => b.type === 'slack')?.id || null;
        this.scOptions.sourceMVA = 12000;
        this.stabilityOptions.faultBusId = this.project.buses.find((b) => b.type !== 'slack')?.id || null;
        this.resetHistory();
        this.refreshValidation();
        this.updateProjectChrome();
        this.firstDesign = true;
        this.setMode('design', true);
        this.toast('示例已加载', '滨江 7 节点输配电网已载入，可直接运行潮流。');
      }
    });
  }

  newBlankPrompt() {
    confirmModal({
      title: '新建空白工程？',
      text: '当前工程将被清空。如需保留，请先导出工程文件。',
      confirmLabel: '新建工程',
      danger: false,
      onConfirm: () => {
        this.project = emptyProject();
        this.ui.compactLabels = false;
        this.ui.showFlow = true;
        this.results = null;
        this.resultsSignature = null;
        this.shortCircuit = null;
        this.shortCircuitSignature = null;
        this.scanShortCircuitResult = null;
        this.scanShortCircuitSignature = null;
        this.n1Result = null;
        this.selection = { kind: 'project', id: null };
        this.resetHistory();
        this.refreshValidation();
        this.updateProjectChrome();
        this.firstDesign = true;
        this.setMode('design', true);
        this.toast('已新建工程', '从左侧设备库添加第一条母线开始设计。');
      }
    });
  }

  updateProjectChrome() {
    const title = document.getElementById('project-title');
    const sub = document.getElementById('project-sub');
    if (title) title.textContent = this.project.meta.name;
    if (sub) sub.textContent = `${this.project.meta.projectNo} · ${this.project.meta.owner || ''}`;
  }

  /* ---------------- stats / validation ---------------- */
  refreshValidation() {
    this.issues = validateProject(this.project);
    if (this.editor) this.editor.updateStatus();
    const errors = this.issues.filter((i) => i.level === 'error').length;
    const warnings = this.issues.filter((i) => i.level === 'warning').length;
    const state = document.getElementById('nav-result-state');
    if (state) state.innerHTML = `<span style="color:${errors ? 'var(--red)' : warnings ? 'var(--amber)' : 'var(--green)'}">●</span> ${errors ? `${errors} 项错误` : warnings ? `${warnings} 项提示` : '网络就绪'}`;
    return { errors, warnings };
  }

  refreshShellStats() { return this.refreshShell(); }

  refreshShell() {
    const s = summarize(this.project);
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('nav-bus-count', s.buses);
    setText('nav-branch-count', s.lines + s.transformers + this.project.branches.filter((b) => b.type === 'breaker' || b.type === 'switch').length);
    const state = document.getElementById('nav-result-state');
    if (state) {
      if (this.results) state.innerHTML = `<span style="color:${this.results.converged ? 'var(--green)' : 'var(--red)'}">●</span> 潮流：${this.results.converged ? '已收敛' : '未收敛'}`;
      else {
        const v = this.refreshValidation();
        state.innerHTML = `<span style="color:${v.errors ? 'var(--red)' : v.warnings ? 'var(--amber)' : 'var(--green)'}">●</span> ${v.errors ? `${v.errors} 项错误` : v.warnings ? `${v.warnings} 项提示` : '网络就绪'}`;
      }
    }
    this.updateProjectChrome();
    this.refreshSaveState();
    this.updateHistoryButtons();
  }

  refreshAll() {
    this.refreshValidation();
    if (this.mode === 'design') {
      this.renderInspector();
      this.editor?.render();
    }
    this.refreshShell();
  }

  scheduleDiagramRender() {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.editor?.render();
      if (this.selection.kind === 'project') this.refreshValidation();
    }, 20);
  }

  renderDiagram() { this.editor?.render(); }

  electricalSignature() {
    const p = this.project;
    const buses = p.buses.map((b) => [b.id, b.vn, b.type, b.vm, b.va]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const branches = p.branches.map((b) => [
      b.id, b.type, b.from, b.to, b.status, b.fromSwitch, b.toSwitch, b.closed, b.paramMode,
      b.length, b.rPerKm, b.xPerKm, b.bPerKm, b.R, b.X, b.B,
      b.sn, b.vn1, b.vn2, b.uk, b.pk, b.p0, b.i0, b.tap, b.shift, b.ratingMVA
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const injections = p.injections.map((x) => [
      x.id, x.type, x.bus, x.status, x.p, x.q, x.qMin, x.qMax, x.switchClosed, x.ratedMVA, x.kind
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify({ baseMVA: p.meta.baseMVA, frequency: p.meta.frequency, buses, branches, injections });
  }

  syncResultLabels() {
    const p = this.project;
    const busMap = new Map(p.buses.map((b) => [b.id, b]));
    const branchMap = new Map(p.branches.map((b) => [b.id, b]));
    const genMap = new Map(p.injections.map((x) => [x.id, x]));
    if (this.results) {
      for (const b of this.results.busResults || []) {
        const cur = busMap.get(b.busId);
        if (!cur) continue;
        b.name = cur.name;
        b.tag = cur.tag;
        b.vn = cur.vn;
      }
      for (const b of this.results.branchResults || []) {
        const cur = branchMap.get(b.id);
        if (!cur) continue;
        b.name = cur.name;
        b.tag = cur.tag;
        const fromBus = busMap.get(cur.from);
        const toBus = busMap.get(cur.to);
        if (fromBus) b.fromName = fromBus.name;
        if (toBus) b.toName = toBus.name;
      }
      for (const g of this.results.generatorResults || []) {
        const cur = genMap.get(g.id);
        if (!cur) continue;
        g.name = cur.name;
        g.tag = cur.tag;
      }
      const net = this.results.net;
      if (net) {
        net.project = p;
        for (const node of net.nodes || []) {
          for (const b of node.buses || []) {
            const cur = busMap.get(b.id);
            if (cur) { b.name = cur.name; b.tag = cur.tag; b.vn = cur.vn; }
          }
          node.name = (node.buses || []).map((b) => b.name).join(' / ');
          node.shortName = node.buses?.[0]?.name || node.shortName;
        }
      }
    }
    if (this.shortCircuit) {
      const fault = busMap.get(this.shortCircuit.busId);
      if (fault) {
        this.shortCircuit.busName = fault.name;
        this.shortCircuit.busTag = fault.tag;
      }
      for (const b of this.shortCircuit.busVoltages || []) {
        const cur = busMap.get(b.busId);
        if (cur) { b.name = cur.name; b.tag = cur.tag; }
      }
      for (const b of this.shortCircuit.branchCurrents || []) {
        const cur = branchMap.get(b.id);
        if (cur) { b.name = cur.name; b.tag = cur.tag; }
      }
      const net = this.shortCircuit.net;
      if (net) {
        net.project = p;
        for (const node of net.nodes || []) {
          for (const b of node.buses || []) {
            const cur = busMap.get(b.id);
            if (cur) { b.name = cur.name; b.tag = cur.tag; }
          }
          node.name = (node.buses || []).map((b) => b.name).join(' / ');
          node.shortName = node.buses?.[0]?.name || node.shortName;
        }
      }
    }
    if (this.scanShortCircuitResult) {
      for (const row of this.scanShortCircuitResult.rows || []) {
        const cur = busMap.get(row.busId);
        if (!cur) continue;
        row.name = cur.name;
        row.tag = cur.tag;
        row.vn = cur.vn;
        row.scRating = Number(cur.scRating) || null;
        if (row.Ik != null) {
          row.ok = row.scRating == null ? null : row.Ik <= row.scRating + 1e-9;
          row.marginPct = row.scRating == null ? null : (row.scRating - row.Ik) / row.scRating * 100;
        }
      }
      const maxRow = this.scanShortCircuitResult.rows.find((r) => r.Ik != null);
      if (maxRow) {
        this.scanShortCircuitResult.summary.maxBus = maxRow.name;
        this.scanShortCircuitResult.summary.maxBusTag = maxRow.tag;
        this.scanShortCircuitResult.summary.maxIk = maxRow.Ik;
      }
      this.scanShortCircuitResult.summary.exceed = this.scanShortCircuitResult.rows.filter((r) => r.ok === false).length;
    }
    if (this.n1Result) {
      for (const c of this.n1Result.cases || []) {
        const cur = c.type === 'branch' ? branchMap.get(c.id) : genMap.get(c.id);
        if (!cur) continue;
        c.name = cur.name;
        c.tag = cur.tag;
      }
    }
  }

  invalidateShortCircuitResults() {
    this.shortCircuit = null;
    this.shortCircuitSignature = null;
    this.scanShortCircuitResult = null;
    this.scanShortCircuitSignature = null;
  }

  invalidateStabilityResults() {
    this.stabilityResult = null;
    this.stabilityCCT = null;
  }

  invalidateResults() {
    this.results = null;
    this.resultsSignature = null;
    this.invalidateShortCircuitResults();
    this.protectionSummary = null;
    this.protectionSensitivity = null;
    this.n1Result = null;
    this.voltageBalanceResult = null;
    this.frequencyResult = null;
    this.invalidateStabilityResults();
    this.updateFlowChip();
    this.refreshShell();
  }

  updateFlowChip() {
    if (this.mode === 'design') this.editor?.render();
  }

  toggleCompactLabels() {
    this.ui.compactLabels = !this.ui.compactLabels;
    this.project.meta.compactLabels = this.ui.compactLabels;
    this.persistNow(true);
    this.editor?.render();
    this.toast(this.ui.compactLabels ? '简洁标注模式' : '完整标注模式', this.ui.compactLabels ? '仅显示设备/支路编号，适合大型电网。' : '显示设备参数、支路长度与潮流明细。');
  }

  toggleFlow() {
    if (!this.results) {
      this.toast('暂无潮流结果', '请先运行潮流计算，再在单线图上叠加潮流信息。', 'warning');
      return;
    }
    this.ui.showFlow = !this.ui.showFlow;
    this.editor?.render();
    this.updateToolbarFlow();
  }

  updateToolbarFlow() {
    const btn = document.querySelector('[data-action="show-flow"]');
    if (btn) btn.classList.toggle('active', this.ui.showFlow);
  }

  updateToolPanel() {
    this.refreshAll();
  }

  /* ---------------- Analysis actions ---------------- */
  async runAnalysis(opts = {}) {
    const { switchMode = true, quiet = false } = opts;
    const v = this.refreshValidation();
    if (v.errors) {
      if (this.mode === 'design') this.select('project', null);
      this.toast('无法计算潮流', this.issues.find((i) => i.level === 'error')?.msg || '请先修正网络拓扑错误。', 'error');
      return null;
    }
    this.showLoading('正在组集节点导纳矩阵并求解潮流…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const result = runPowerFlow(this.project, this.analysisOptions);
      this.results = result;
      this.resultsSignature = this.electricalSignature();
      this.lastRunAt = new Date();
      if (switchMode) {
        if (this.mode === 'design') this.captureDiagram();
        this.setMode('analysis', true);
      } else {
        this.rerender();
      }
      this.refreshShell();
      if (!quiet) {
        const qNote = result.qLimitActions?.length ? ` · ${result.qLimitActions.length} 个 PV 节点转 PQ` : '';
        if (result.converged) this.toast('潮流计算完成', `${result.iterations} 次迭代收敛 · 总有功损耗 ${result.totals.lossP.toFixed(2)} MW${qNote}。`);
        else this.toast('潮流未收敛', `已达到 ${result.iterations} 次迭代，最大不平衡量 ${result.mismatch.toExponential(2)} pu。`, 'warning');
      }
      return result;
    } catch (e) {
      this.toast('潮流计算失败', e.message || '网络方程无法求解。', 'error');
      if (this.mode === 'analysis') this.rerender();
      return null;
    } finally {
      this.hideLoading();
    }
  }

  openYbus() {
    try {
      const net = buildNetwork(this.project, { baseMVA: this.project.meta.baseMVA });
      if (net.errors.length) throw new Error(net.errors[0]);
      const payload = buildYbusTabs(net);
      payload.toast = (t, m) => this.toast(t, m);
      openMatrixViewer(payload);
    } catch (e) {
      this.toast('无法生成 Ybus', e.message, 'error');
    }
  }

  openJacobian() {
    if (!this.results) {
      this.toast('尚无潮流结果', '请先运行潮流计算，再生成收敛点雅可比矩阵。', 'warning');
      return;
    }
    if (this.results.dc) {
      const payload = buildDcMatrixTabs(this.results);
      payload.toast = (t, m) => this.toast(t, m);
      openMatrixViewer(payload);
      return;
    }
    try {
      const variant = this.analysisOptions.algorithm === 'fdpf-bx' ? 'bx' : 'xb';
      const payload = buildJacobianTabs(this.results, variant);
      payload.toast = (t, m) => this.toast(t, m);
      openMatrixViewer(payload);
    } catch (e) {
      this.toast('无法生成雅可比矩阵', e.message, 'error');
    }
  }

  openMatricesForCurrent() {
    if (this.results) this.openJacobian();
    else this.openYbus();
  }

  compareAlgorithms() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法对比', '请先修正网络错误。', 'error'); return; }
    const rows = [];
    for (const algorithm of ['nr', 'fdpf-xb', 'fdpf-bx', 'gs', 'dc']) {
      try {
        const maxIter = algorithm === 'gs' ? 200 : 60;
        const r = runPowerFlow(this.project, { ...this.analysisOptions, algorithm, maxIter });
        const maxLoad = Math.max(0, ...r.branchResults.map((b) => b.loading || 0));
        rows.push({ algorithm, label: r.label, ok: r.converged, iter: r.iterations, mismatch: r.mismatch, loss: r.totals.lossP, vmin: r.vMin, maxLoad, time: r.elapsedMs });
      } catch (e) {
        rows.push({ algorithm, label: ALGORITHMS.find((a) => a.id === algorithm)?.label || algorithm, ok: false, error: e.message });
      }
    }
    const body = `<div class="method-note" style="margin-bottom:10px">${icon('info', 12)} 五种算法在同一网络与同一平启动条件下计算，便于比较收敛速度与结果一致性。直流潮流仅作有功参考。</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>算法</th><th>收敛</th><th>迭代</th><th>最大不平衡量</th><th>有功损耗</th><th>最低电压</th><th>最大负载率</th><th>耗时</th></tr></thead><tbody>
      ${rows.map((r) => r.error ? `<tr class="row-bad"><td>${esc(r.label)}</td><td colspan="7" style="color:var(--red)">${esc(r.error)}</td></tr>` : `<tr><td class="name-cell">${esc(r.label)}</td><td><span class="status-pill ${r.ok ? 'ok' : 'bad'}">${r.ok ? '收敛' : '未收敛'}</span></td><td class="num">${r.iter}</td><td class="num">${Number.isFinite(r.mismatch) ? r.mismatch.toExponential(2) : '—'}</td><td class="num">${r.loss.toFixed(3)} MW</td><td class="num">${r.vmin.toFixed(4)} pu</td><td class="num">${r.maxLoad.toFixed(1)}%</td><td class="num">${r.time.toFixed(1)} ms</td></tr>`).join('')}
      </tbody></table></div>
      <div class="method-note" style="margin-top:10px">${icon('flask', 12)} 牛顿-拉夫逊法二次收敛，精度最高；PQ 分解法每次迭代计算量更小，适合大系统；高斯-赛德尔法收敛较慢，用于教学对照；直流潮流为线性近似。</div>`;
    showModal({ title: '多算法计算结果对比', kicker: 'SOLVER BENCHMARK', subtitle: `同一网络 · ${this.project.buses.length} 节点`, body, size: 'lg', footer: `<button class="btn" data-modal-close>关闭</button>` });
    document.querySelector('#modal-root [data-modal-close]')?.addEventListener('click', () => closeModal());
  }

  openScenarioManager() {
    openScenarioManager(this);
  }

  openDataExchange() {
    openDataExchange(this);
  }

  applyImportedProject(project, summary, fileName = '') {
    this.project = project;
    this.ui.compactLabels = !!project.meta.compactLabels;
    this.ui.showFlow = !this.ui.compactLabels;
    this.selection = { kind: 'project', id: null };
    this.scOptions.sourceMVA = Number(project.meta.sourceMVA) || 12000;
    this.scOptions.busId = project.buses.find((b) => b.type === 'slack')?.id || project.buses[0]?.id || null;
    this.stabilityOptions.faultBusId = project.buses.find((b) => b.type !== 'slack')?.id || project.buses[0]?.id || null;
    this.protectionSelectedId = project.relays[0]?.id || null;
    this.invalidateResults();
    this.resetHistory();
    this.persistNow(true);
    this.firstDesign = true;
    this.setMode('design', true);
    this.refreshAll();
    this.refreshValidation();
    this.toast('数据导入完成', `${fileName || 'Excel 工作簿'} · 母线 ${summary?.buses || 0}、支路 ${summary?.branches || 0}、设备 ${summary?.injections || 0}、保护 ${summary?.protections || 0}，新增 ${summary?.added || 0} 个对象。`);
  }

  scenarioSnapshot() {
    return {
      buses: this.project.buses.map((b) => ({ id: b.id, type: b.type, vm: b.vm, va: b.va })),
      branches: this.project.branches.map((b) => ({
        id: b.id, status: b.status, fromSwitch: b.fromSwitch, toSwitch: b.toSwitch, thirdSwitch: b.thirdSwitch,
        closed: b.closed, tap: b.tap, tapH: b.tapH, tapM: b.tapM, tapL: b.tapL
      })),
      injections: this.project.injections.map((x) => ({
        id: x.id, status: x.status, p: x.p, q: x.q, switchClosed: x.switchClosed
      }))
    };
  }

  createScenario(name, note = '') {
    const clean = String(name || '').trim();
    if (!clean) { this.toast('场景名称为空', '请输入一个便于识别的场景名称。', 'warning'); return false; }
    if (!this.project.scenarios) this.project.scenarios = [];
    this.project.scenarios.push({
      id: `scn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: clean,
      note: String(note || '').trim(),
      createdAt: new Date().toISOString(),
      state: this.scenarioSnapshot()
    });
    this.commit('保存运行场景');
    this.persistNow(true);
    this.toast('场景已保存', `“${clean}”已写入工程，可在场景管理器中应用或对比。`);
    return true;
  }

  applyScenarioState(project, state) {
    if (!state) return project;
    const busMap = new Map(project.buses.map((b) => [b.id, b]));
    const branchMap = new Map(project.branches.map((b) => [b.id, b]));
    const injMap = new Map(project.injections.map((x) => [x.id, x]));
    for (const item of state.buses || []) {
      const b = busMap.get(item.id);
      if (!b) continue;
      b.type = item.type ?? b.type;
      b.vm = Number(item.vm) || b.vm;
      b.va = Number(item.va) || 0;
    }
    for (const item of state.branches || []) {
      const b = branchMap.get(item.id);
      if (!b) continue;
      b.status = item.status ?? b.status;
      b.fromSwitch = item.fromSwitch ?? b.fromSwitch;
      b.toSwitch = item.toSwitch ?? b.toSwitch;
      b.thirdSwitch = item.thirdSwitch ?? b.thirdSwitch;
      b.closed = item.closed ?? b.closed;
      for (const key of ['tap', 'tapH', 'tapM', 'tapL']) {
        if (item[key] != null) b[key] = item[key];
      }
    }
    for (const item of state.injections || []) {
      const x = injMap.get(item.id);
      if (!x) continue;
      x.status = item.status ?? x.status;
      x.p = item.p ?? x.p;
      x.q = item.q ?? x.q;
      x.switchClosed = item.switchClosed ?? x.switchClosed;
    }
    return project;
  }

  applyScenario(id) {
    const sc = (this.project.scenarios || []).find((s) => s.id === id);
    if (!sc) return;
    this.applyScenarioState(this.project, sc.state);
    this.invalidateResults();
    this.commit(`应用场景：${sc.name}`);
    closeModal();
    this.setMode('design', true);
    this.toast('场景已应用', `“${sc.name}”的负荷、机组出力、开关/分接位置已载入。`);
  }

  deleteScenario(id) {
    const sc = (this.project.scenarios || []).find((s) => s.id === id);
    if (!sc) return;
    this.project.scenarios = this.project.scenarios.filter((s) => s.id !== id);
    this.commit('删除运行场景');
    this.persistNow(true);
    this.toast('场景已删除', `“${sc.name}”已从工程中移除。`);
  }

  compareScenarios() {
    if (!this.project.scenarios?.length) {
      this.toast('没有可对比的场景', '先保存至少一个运行场景。', 'warning');
      return;
    }
    const rows = [];
    const nf = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
    const maxLoadOf = (r) => r ? Math.max(0, ...r.branchResults.map((b) => b.loading || 0)) : null;
    try {
      rows.push({ name: '当前方式', note: '当前工程状态', result: runPowerFlow(this.project, { ...this.analysisOptions, algorithm: 'nr', maxIter: 60 }) });
    } catch (e) {
      rows.push({ name: '当前方式', note: '当前工程状态', error: e.message });
    }
    for (const sc of this.project.scenarios) {
      const p = clone(this.project);
      this.applyScenarioState(p, sc.state);
      try {
        rows.push({ name: sc.name, note: sc.note, result: runPowerFlow(p, { ...this.analysisOptions, algorithm: 'nr', maxIter: 60 }) });
      } catch (e) {
        rows.push({ name: sc.name, note: sc.note, error: e.message });
      }
    }
    const body = `<div class="method-note" style="margin-bottom:10px">${icon('info', 12)} 各场景均采用牛顿-拉夫逊法重新计算，当前工程状态作为对照。场景只改变运行参数，不改变网络拓扑本体。</div>
      <div class="table-wrap tall"><table class="data-table"><thead><tr><th>场景</th><th>收敛</th><th>最低电压</th><th>最高电压</th><th>有功损耗</th><th>最大负载率</th><th>越限母线</th><th>过载支路</th></tr></thead><tbody>
      ${rows.map((r) => {
        if (r.error) return `<tr class="row-bad"><td><div class="name-cell">${esc(r.name)}</div><div class="cell-sub">${esc(r.note)}</div></td><td colspan="7" style="color:var(--red)">${esc(r.error)}</td></tr>`;
        const res = r.result;
        const bad = !res.converged || res.violations.length || res.overloads.length;
        return `<tr class="${bad ? 'row-warn' : ''}"><td><div class="name-cell">${esc(r.name)}</div><div class="cell-sub">${esc(r.note || '')}</div></td><td><span class="status-pill ${res.converged ? 'ok' : 'bad'}">${res.converged ? '收敛' : '未收敛'}</span></td><td class="num">${nf(res.vMin, 4)}</td><td class="num">${nf(res.vMax, 4)}</td><td class="num">${nf(res.totals.lossP, 3)} MW</td><td class="num">${nf(maxLoadOf(res), 1)}%</td><td class="num">${res.violations.length}</td><td class="num">${res.overloads.length}</td></tr>`;
      }).join('')}
      </tbody></table></div>`;
    const { root } = showModal({
      title: '运行场景对比', kicker: 'SCENARIO COMPARISON',
      subtitle: `${this.project.scenarios.length} 个保存场景 + 当前方式 · 牛顿法潮流`,
      body, size: 'lg',
      footer: `<button class="btn" data-scn-export>${icon('download', 12)} 导出对比</button><button class="btn" data-modal-close>关闭</button>`
    });
    root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
    root.querySelector('[data-scn-export]')?.addEventListener('click', () => {
      const lines = [
        ['ELECTRA 运行场景对比', this.project.meta.name],
        ['场景', '收敛', '最低电压(pu)', '最高电压(pu)', '有功损耗(MW)', '最大负载率(%)', '越限母线', '过载支路'],
        ...rows.map((r) => r.error ? [r.name, '失败', '', '', '', '', '', r.error] : [r.name, r.result.converged ? '是' : '否', r.result.vMin, r.result.vMax, r.result.totals.lossP, maxLoadOf(r.result), r.result.violations.length, r.result.overloads.length])
      ];
      const csv = lines.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.project.meta.name}_场景对比.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.toast('已导出场景对比', '对比结果已导出为 CSV。');
    });
  }

  async runOptimizationAnalysis(objective = 'loss') {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法执行优化', '请先修正网络错误。', 'error'); return; }
    this.showLoading(objective === 'cost' ? '正在执行启发式 AC OPF 搜索…' : '正在搜索变压器分接头与补偿容量最优组合…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const opt = runOptimization(this.project, { objective, passes: 2 });
      this.optimizationResult = opt;
      const s = opt.summary;
      const title = objective === 'cost' ? '成本优化 / 简化 AC OPF' : '网损与分接头优化';
      const metric = (label, base, best, unit, digits = 3, better = 'down') => {
        const diff = best - base;
        const improved = better === 'down' ? diff < -1e-6 : diff > 1e-6;
        return `<div class="metric ${improved ? 'good' : ''}" style="padding:10px 12px"><div class="m-label">${label}</div><div class="m-value">${Number(best).toFixed(digits)} <small>${unit}</small></div><div class="m-foot">优化前 ${Number(base).toFixed(digits)} · ${diff > 0 ? '+' : ''}${diff.toFixed(digits)}</div></div>`;
      };
      const rows = opt.changes.length ? opt.changes.map((c) => `<tr><td class="name-cell">${esc(c.label)}</td><td>${esc(c.kind === 'voltage' ? '电压设定' : c.kind === 'tap' ? '分接头' : c.kind === 'shunt' ? '补偿容量' : '有功调度')}</td><td class="num">${Number(c.from).toFixed(2)} ${esc(c.unit)}</td><td class="num">${Number(c.to).toFixed(2)} ${esc(c.unit)}</td><td class="num accent">${(c.to - c.from > 0 ? '+' : '')}${(c.to - c.from).toFixed(2)}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--dim);padding:20px">当前运行方式已接近该目标下的局部最优。</td></tr>';
      const body = `<div class="grid-4" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:11px">
        ${metric('总有功损耗', s.baseLoss, s.bestLoss, 'MW')}
        ${metric('最低母线电压', s.baseVMin, s.bestVMin, 'pu', 4, 'up')}
        ${metric('最大负载率', s.baseMaxLoad, s.bestMaxLoad, '%', 1)}
        ${metric('发电成本', s.baseCost, s.bestCost, '元/h', 0)}
      </div>
      <div class="method-note" style="margin-bottom:10px">${icon('info', 12)} 目标：${objective === 'cost' ? '在电压与支路约束下最小化发电成本（含分接头、无功补偿与有功再调度）' : '在电压与支路约束下最小化有功网损（调整分接头、补偿容量与 PV/Slack 电压）'}。共评估 ${opt.evaluations} 个潮流方式，结果${opt.feasible ? '满足' : '未完全满足'} 0.95–1.05 pu 与 100% 负载率约束。</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>调整对象</th><th>类型</th><th>当前值</th><th>建议值</th><th>变化</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="method-note" style="margin-top:10px">${icon('flask', 12)} 求解器为工程阶段启发式坐标搜索：每步用完整交流潮流校验，不保证全局最优。分接头调节范围 ±10%，PV/Slack 电压 0.97–1.065 pu，补偿容量在现有容量 0–200% 范围内。应用前请结合运行规程与设备调节次数复核。</div>`;
      const { root } = showModal({
        title, kicker: objective === 'cost' ? 'HEURISTIC AC OPF' : 'LOSS / TAP OPTIMIZATION',
        subtitle: `${this.project.meta.name} · ${opt.changes.length} 项建议调整 · ${opt.evaluations} 次潮流评估`,
        body, size: 'lg',
        footer: `<button class="btn" data-opt-export>${icon('download', 12)} 导出建议</button><button class="btn ${opt.changes.length ? 'btn-primary' : ''}" data-opt-apply ${opt.changes.length ? '' : 'disabled'}>${icon('check', 12)} 应用优化方案</button><button class="btn" data-modal-close>关闭</button>`
      });
      root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      root.querySelector('[data-opt-export]')?.addEventListener('click', () => this.exportOptimizationCSV());
      root.querySelector('[data-opt-apply]')?.addEventListener('click', () => this.applyOptimization());
      this.toast('优化搜索完成', `${title} · ${opt.changes.length} 项建议 · ${opt.feasible ? '满足约束' : '存在约束越限'}。`, opt.feasible ? 'success' : 'warning');
    } catch (e) {
      this.toast('优化失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  applyOptimization() {
    const opt = this.optimizationResult;
    if (!opt?.changes?.length) return;
    for (const c of opt.changes) {
      if (c.kind === 'voltage') {
        const bus = this.project.buses.find((b) => b.id === c.id);
        if (bus) bus.vm = c.to;
      } else if (c.kind === 'tap') {
        const br = this.project.branches.find((b) => b.id === (c.branchId || c.id));
        if (br) br[c.field || 'tap'] = c.to;
      } else if (c.kind === 'shunt' || c.kind === 'dispatch') {
        const inj = this.project.injections.find((x) => x.id === c.id);
        if (inj) inj[c.field || (c.kind === 'shunt' ? 'q' : 'p')] = c.to;
      }
    }
    this.invalidateResults();
    this.commit('应用优化方案');
    closeModal();
    this.setMode('design', true);
    this.toast('优化方案已应用', '分接头、补偿容量、电压设定与有功出力已写入工程，正在重新计算潮流。');
    setTimeout(() => this.runAnalysis({ quiet: true }), 150);
  }

  exportOptimizationCSV() {
    const opt = this.optimizationResult;
    if (!opt) return;
    const rows = [
      ['ELECTRA 优化建议', this.optimizationResult.objective === 'cost' ? '成本优化 / 简化 AC OPF' : '网损与分接头优化'],
      ['指标', '优化前', '优化后'],
      ['有功损耗(MW)', opt.summary.baseLoss, opt.summary.bestLoss],
      ['最低电压(pu)', opt.summary.baseVMin, opt.summary.bestVMin],
      ['最高电压(pu)', opt.summary.baseVMax, opt.summary.bestVMax],
      ['最大负载率(%)', opt.summary.baseMaxLoad, opt.summary.bestMaxLoad],
      ['发电成本(元/h)', opt.summary.baseCost, opt.summary.bestCost],
      [],
      ['调整对象', '类型', '当前值', '建议值', '单位'],
      ...opt.changes.map((c) => [c.label, c.kind, c.from, c.to, c.unit])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_优化建议.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('已导出优化建议', '优化前后指标与调整清单已导出。');
  }

  async runProtectionSensitivity() {
    const f = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
    if (!this.project.relays.length) {
      this.toast('尚未配置保护', '请先为线路/变压器自动生成保护配置。', 'warning');
      return;
    }
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法扫描保护灵敏度', '请先修正网络错误。', 'error'); return; }
    this.showLoading('正在计算本线末端与远后备故障电流…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const scan = runProtectionSensitivityScan(this.project, {
        c: 1.1,
        sourceMVA: this.scOptions.sourceMVA,
        includeMotors: this.scOptions.includeMotors
      });
      this.protectionSensitivity = scan;
      const s = scan.summary;
      const rows = scan.rows.map((r) => `<tr class="${r.status === 'fail' ? 'row-bad' : r.status === 'warn' ? 'row-warn' : ''}">
        <td><div class="name-cell">${esc(r.branchTag)} · ${esc(r.branchName)}</div><div class="cell-sub">${esc(r.relayName)}</div></td>
        <td class="cell-sub">${esc(r.nearBus)}</td>
        <td class="num">${f(r.nearFaultKA, 2)}</td>
        <td class="num">${f(r.farFaultKA, 2)}</td>
        <td class="num ${r.ksenNear != null && r.ksenNear < 1.3 ? 'red' : 'accent'}">${f(r.ksenNear, 2)}</td>
        <td class="num ${r.ksenFar != null && r.ksenFar < 1.2 ? 'red' : 'accent'}">${f(r.ksenFar, 2)}</td>
        <td class="num">${r.z1Ratio != null ? f(r.z1Ratio * 100, 0) + '%' : '—'}</td>
        <td>${r.z2Covers == null ? '—' : `<span class="status-pill ${r.z2Covers ? 'ok' : 'bad'}">${r.z2Covers ? '覆盖' : '不足'}</span>`}</td>
        <td class="cell-sub">${esc(r.issues.map((i) => i.msg).join('；') || '通过')}</td>
      </tr>`).join('');
      const body = `<div class="metrics" style="grid-template-columns:repeat(4,1fr);margin-bottom:11px">
        <div class="metric"><div class="m-label">${icon('shield', 11)} 校核保护</div><div class="m-value">${s.total}</div><div class="m-foot">${s.ok} 通过 / ${s.warn} 关注 / ${s.fail} 不合格</div></div>
        <div class="metric ${s.fail ? 'bad' : 'good'}"><div class="m-label">${icon('target', 11)} 最小远后备 Ksen</div><div class="m-value">${f(s.minKsen, 2)}</div><div class="m-foot">${esc(s.minKsenRelay || '—')} · 门槛 1.20</div></div>
        <div class="metric"><div class="m-label">${icon('layers', 11)} 故障点</div><div class="m-value">本线末端</div><div class="m-foot">下一级母线作为远后备点</div></div>
        <div class="metric"><div class="m-label">${icon('clock', 11)} 短路计算</div><div class="m-value">三相</div><div class="m-foot">c = 1.1 · ${esc(String(this.scOptions.sourceMVA))} MVA</div></div>
      </div>
      <div class="method-note" style="margin-bottom:10px">${icon('info', 12)} 近端取被保护支路对端母线三相短路，远端取下一级母线三相短路；Ksen = 流过保护的故障电流 / 过流保护一次启动值。距离 II/III 段覆盖按本线阻抗与相邻线路阻抗校核。</div>
      <div class="table-wrap tall"><table class="data-table"><thead><tr><th>保护 / 支路</th><th>近端故障点</th><th>近端 Ik (kA)</th><th>远端 Ik (kA)</th><th>Ksen 近</th><th>Ksen 远</th><th>Z1 范围</th><th>Z2 覆盖</th><th>校核结论</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="method-note" style="margin-top:10px">${icon('flask', 12)} 本扫描用于方案阶段保护灵敏度与距离段覆盖初筛；正式整定应使用实测线路参数、故障计算程序及保护装置说明书，并校核 CT 饱和、弧光电阻与运行方式变化。</div>`;
      const { root } = showModal({
        title: '保护灵敏度 / 距离扫描', kicker: 'PROTECTION SENSITIVITY',
        subtitle: `${scan.rows.length} 套保护 · 本线末端与远后备故障 · Ksen 门槛 1.30 / 1.20`,
        body, size: 'lg',
        footer: `<button class="btn" data-sens-export>${icon('download', 12)} 导出 CSV</button><button class="btn" data-modal-close>关闭</button>`
      });
      root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      root.querySelector('[data-sens-export]')?.addEventListener('click', () => this.exportProtectionSensitivityCSV());
      this.toast(scan.summary.fail ? '灵敏度扫描完成：存在不合格项' : '灵敏度扫描完成', `${scan.summary.ok} 套通过，${scan.summary.warn} 套关注，${scan.summary.fail} 套不合格。`, scan.summary.fail ? 'warning' : 'success');
    } catch (e) {
      this.toast('灵敏度扫描失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  runRecloseCheck() {
    const relay = this.project.relays.find((r) => r.id === this.protectionSelectedId);
    if (!relay) { this.toast('请选择保护', '先选择一套线路保护。', 'warning'); return; }
    const branch = this.project.branches.find((b) => b.id === relay.branchId);
    if (!branch || branch.type !== 'line') { this.toast('该保护不支持重合闸', '重合闸时序仅针对线路保护。', 'warning'); return; }
    try {
      const seq = recloseSummary(this.project, {
        relayId: relay.id,
        faultCurrentA: this.protectionFaultCurrent,
        attempts: relay.reclose?.attempts ?? 1,
        deadTime: relay.reclose?.deadTime ?? 1,
        sourceMVA: this.scOptions.sourceMVA
      });
      const table = (r) => `<table class="data-table"><thead><tr><th>时间 (s)</th><th>动作</th><th>说明</th></tr></thead><tbody>${r.events.map((e) => `<tr class="${e.type === 'lockout' ? 'row-bad' : e.type === 'restore' ? 'row-warn' : ''}"><td class="num">${e.t.toFixed(3)}</td><td><span class="status-pill ${e.type === 'restore' ? 'ok' : e.type === 'lockout' ? 'bad' : 'neutral'}">${esc({ fault: '故障', trip: '跳闸', open: '分闸', reclose: '重合', restore: '恢复', lockout: '闭锁' }[e.type] || e.type)}</span></td><td class="cell-sub">${esc(e.text)}</td></tr>`).join('')}</tbody></table>`;
      const body = `<div class="metrics" style="grid-template-columns:repeat(4,1fr);margin-bottom:11px">
        <div class="metric"><div class="m-label">保护动作</div><div class="m-value">${seq.transient.protectionTime.toFixed(3)} <small>s</small></div><div class="m-foot">故障电流 ${(seq.transient.faultCurrentA / 1000).toFixed(2)} kA</div></div>
        <div class="metric"><div class="m-label">死区 / 次数</div><div class="m-value">${seq.transient.deadTime.toFixed(2)} s</div><div class="m-foot">${seq.transient.attempts} 次重合</div></div>
        <div class="metric good"><div class="m-label">瞬时故障</div><div class="m-value">${seq.transient.restored ? '恢复' : '失败'}</div><div class="m-foot">停电 ${seq.transient.totalOutageSeconds?.toFixed(3) || '—'} s</div></div>
        <div class="metric ${seq.permanent.restored ? 'good' : 'bad'}"><div class="m-label">永久故障</div><div class="m-value">${seq.permanent.restored ? '恢复' : '闭锁'}</div><div class="m-foot">${seq.permanent.lockoutAt != null ? `闭锁于 ${seq.permanent.lockoutAt.toFixed(3)} s` : '—'}</div></div>
      </div>
      <div class="method-note" style="margin-bottom:9px">${icon('info', 12)} ${esc(relay.name)} · ${esc(branch.tag)} ${esc(branch.name)} · 重合闸${seq.transient.enabled ? '投入' : '退出'}。</div>
      <div class="grid-2"><div class="card"><div class="card-head"><div><div class="card-title">瞬时性故障</div><div class="card-sub">第一次重合成功</div></div></div>${table(seq.transient)}</div><div class="card"><div class="card-head"><div><div class="card-title">永久性故障</div><div class="card-sub">达到重合次数后闭锁</div></div></div>${table(seq.permanent)}</div></div>
      <div class="method-note" style="margin-top:10px">${icon('flask', 12)} ${seq.transient.notes.join(' ')}</div>`;
      const { root } = showModal({ title: '重合闸动作时序', kicker: 'AUTO-RECLOSING SEQUENCE', subtitle: `${relay.name} · ${branch.tag} · 保护动作 ${seq.transient.protectionTime.toFixed(3)} s`, body, size: 'lg', footer: `<button class="btn" data-modal-close>关闭</button>` });
      root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      this.toast('重合闸时序已生成', `${branch.tag} · 瞬时故障恢复 · 永久故障闭锁。`);
    } catch (e) {
      this.toast('重合闸时序生成失败', e.message, 'error');
    }
  }

  exportProtectionSensitivityCSV() {
    const scan = this.protectionSensitivity;
    if (!scan) return;
    const lines = [
      ['ELECTRA 保护灵敏度 / 距离扫描', this.project.meta.name],
      ['保护', '支路', '近端故障点', '近端Ik(kA)', '远端故障点', '远端Ik(kA)', 'Ksen近', 'Ksen远', 'Z1范围(%)', 'Z2覆盖', '结论', '问题'],
      ...scan.rows.map((r) => [r.relayName, `${r.branchTag} ${r.branchName}`, r.nearBus, r.nearFaultKA, r.farBus, r.farFaultKA, r.ksenNear, r.ksenFar, r.z1Ratio != null ? r.z1Ratio * 100 : '', r.z2Covers == null ? '' : (r.z2Covers ? '是' : '否'), r.status, r.issues.map((i) => i.msg).join('；')])
    ];
    const csv = lines.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_保护灵敏度.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('已导出灵敏度清单', 'Ksen 与距离段覆盖结果已导出。');
  }

  async runVoltageRegulation() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法执行电压平衡', '请先修正网络错误。', 'error'); return; }
    this.showLoading('正在协调发电机电压、分接头与补偿容量…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const res = runVoltageBalance(this.project, {
        targetMin: this.regulationOptions.targetMin,
        targetMax: this.regulationOptions.targetMax,
        passes: 3
      });
      this.voltageBalanceResult = res;
      this.rerender();
      this.toast('电压平衡完成', `${res.summary.baseOutOfBand} → ${res.summary.bestOutOfBand} 个目标带外母线，${res.changes.length} 项调整建议。`, res.summary.bestOutOfBand ? 'warning' : 'success');
    } catch (e) {
      this.toast('电压平衡失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  applyVoltageBalance() {
    const res = this.voltageBalanceResult;
    if (!res?.changes?.length) return;
    for (const c of res.changes) {
      if (c.kind === 'voltage') {
        const b = this.project.buses.find((x) => x.id === c.id);
        if (b) b.vm = c.to;
      } else if (c.kind === 'tap') {
        const b = this.project.branches.find((x) => x.id === (c.branchId || c.id));
        if (b) b[c.field || 'tap'] = c.to;
      } else if (c.kind === 'shunt') {
        const x = this.project.injections.find((y) => y.id === c.id);
        if (x) x.q = c.to;
      }
    }
    this.invalidateResults();
    this.commit('应用电压平衡方案');
    this.setMode('design', true);
    this.toast('电压平衡方案已应用', '电压设定、分接头与补偿容量已写入工程，正在重新计算潮流。');
    setTimeout(() => this.runAnalysis({ quiet: true }), 160);
  }

  async runFrequencyRegulation() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法执行频率仿真', '请先修正网络错误。', 'error'); return; }
    this.showLoading('正在积分转子惯量、一次调频与 AGC 响应…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const res = runFrequencyResponse(this.project, {
        eventType: this.regulationOptions.eventType,
        eventMW: this.regulationOptions.eventMW,
        droop: this.regulationOptions.droop,
        tEnd: this.regulationOptions.tEnd,
        agc: this.regulationOptions.agc
      });
      this.frequencyResult = res;
      this.rerender();
      this.toast(res.stable ? '频率仿真完成：恢复' : res.recovered ? '频率仿真完成：恢复但最低频率越限' : '频率仿真完成：未恢复', `最低 ${res.minHz.toFixed(3)} Hz · 最终 ${res.finalHz.toFixed(3)} Hz · RoCoF ${res.rocof.toFixed(3)} Hz/s。`, res.stable ? 'success' : 'warning');
    } catch (e) {
      this.toast('频率仿真失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  async runStabilityAnalysis() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法运行暂态仿真', '请先修正网络错误。', 'error'); return; }
    const buses = this.project.buses.filter((b) => b.type !== 'slack');
    if (!buses.length) { this.toast('无法运行暂态仿真', '至少需要一条非平衡母线作为故障点。', 'error'); return; }
    if (!this.stabilityOptions.faultBusId || !buses.some((b) => b.id === this.stabilityOptions.faultBusId)) {
      this.stabilityOptions.faultBusId = buses[0].id;
    }
    this.showLoading('正在建立 E′ 网络、Kron 降阶并积分摇摆方程…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const res = runTransientStability(this.project, {
        ...this.stabilityOptions,
        faultBusId: this.stabilityOptions.faultBusId
      });
      this.stabilityResult = res;
      this.stabilityCCT = null;
      this.rerender();
      this.toast(res.stable ? '暂态仿真完成：稳定' : '暂态仿真完成：失稳', `最大功角差 ${res.maxSpread.toFixed(1)}° · 末段转速偏差 ${res.finalSpeed.toFixed(4)} pu。`, res.stable ? 'success' : 'warning');
    } catch (e) {
      this.toast('暂态仿真失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  async estimateStabilityCCT() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法估算临界切除时间', '请先修正网络错误。', 'error'); return; }
    this.showLoading('正在用二分搜索估算临界切除时间…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const c = findCriticalClearingTime(this.project, {
        ...this.stabilityOptions,
        faultBusId: this.stabilityOptions.faultBusId,
        maxDuration: 0.8,
        tEnd: Math.min(4, this.stabilityOptions.tEnd || 4)
      });
      this.stabilityCCT = c;
      if (!this.stabilityResult) this.stabilityResult = c.result;
      this.rerender();
      if (c.stableAtMax) this.toast('故障在 0.80 s 内均稳定', '未能找到失稳边界，可尝试延长最大切除时间或调整故障点。', 'warning');
      else if (c.criticalTime <= 0.02) this.toast('临界切除时间极短', '当前方式对故障清除时间非常敏感，请校核保护与断路器动作时间。', 'warning');
      else this.toast('临界切除时间估算完成', `约 ${c.criticalTime.toFixed(3)} s（${c.scans} 次仿真）。`);
    } catch (e) {
      this.toast('临界切除时间估算失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  async runN1Analysis() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法执行 N-1 扫描', '请先修正网络错误。', 'error'); return; }
    this.showLoading('正在逐个停运线路、变压器与发电机进行 N-1 扫描…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const scan = runN1Scan(this.project, { ...this.analysisOptions, algorithm: 'nr' });
      this.n1Result = scan;
      const s = scan.summary;
      const body = `
        <div class="grid-3" style="margin-bottom:11px">
          <div class="metric ${s.critical ? 'bad' : 'good'}" style="padding:10px 12px"><div class="m-label">临界 / 不收敛</div><div class="m-value">${s.critical}</div><div class="m-foot">需优先处理</div></div>
          <div class="metric ${s.severe ? 'warn' : 'good'}" style="padding:10px 12px"><div class="m-label">严重越限</div><div class="m-value">${s.severe}</div><div class="m-foot">低压 &lt; 0.90 pu 或支路过载</div></div>
          <div class="metric" style="padding:10px 12px"><div class="m-label">一般告警</div><div class="m-value">${s.warning}</div><div class="m-foot">电压超出 0.95–1.05 pu</div></div>
        </div>
        <div class="method-note" style="margin-bottom:10px">${icon('info', 12)} 基准方式：最低电压 ${scan.base.vMin.toFixed(4)} pu，最大负载率 ${Math.max(0, ...scan.base.branchResults.map((b) => b.loading || 0)).toFixed(1)}%。共扫描 ${s.total} 个 N-1 事件，全部重新求解交流潮流。</div>
        <div class="table-wrap tall"><table class="data-table"><thead><tr><th>停运元件</th><th>类型</th><th>收敛</th><th>最低电压</th><th>最大负载率</th><th>越限节点</th><th>过载支路</th><th>评价</th></tr></thead><tbody>
          ${scan.cases.map((c) => {
            const label = c.severity === 'critical' ? '临界' : c.severity === 'severe' ? '严重' : c.severity === 'warning' ? '关注' : '通过';
            const pill = c.severity === 'critical' || c.severity === 'severe' ? 'bad' : c.severity === 'warning' ? 'warn' : 'ok';
            return `<tr class="${c.severity === 'critical' || c.severity === 'severe' ? 'row-bad' : c.severity === 'warning' ? 'row-warn' : ''}">
              <td><div class="name-cell">${esc(c.name)}</div><div class="cell-sub">${esc(c.tag)}</div></td>
              <td>${esc(c.label)}</td>
              <td>${c.error ? `<span class="status-pill bad" title="${esc(c.error)}">失败</span><div class="cell-sub">${c.error.includes('平衡节点') ? '孤岛 / 失去平衡节点' : '网络方程求解失败'}</div>` : `<span class="status-pill ${c.converged ? 'ok' : 'bad'}">${c.converged ? '是' : '否'}</span>`}</td>
              <td class="num">${c.minV == null ? '—' : c.minV.toFixed(4)}</td>
              <td class="num">${c.maxLoad == null ? '—' : `${c.maxLoad.toFixed(1)}%`}</td>
              <td class="num">${c.violations || 0}</td>
              <td class="num">${c.overloads.length || 0}</td>
              <td><span class="status-pill ${pill}">${label}</span></td>
            </tr>`;
          }).join('')}
        </tbody></table></div>
        <div class="method-note" style="margin-top:10px">${icon('flask', 12)} 严重程度排序：不收敛 → 最低电压低于 0.90 pu 或支路过载 → 一般电压越限 → 通过。N-1 未考虑保护动作与再调度，仅用于静态安全初筛。</div>`;
      const { root } = showModal({
        title: 'N-1 静态安全扫描', kicker: 'CONTINGENCY SCREENING',
        subtitle: `${this.project.meta.name} · ${s.total} 个停运事件 · 基准 ${scan.base.label}`,
        body, size: 'lg',
        footer: `<button class="btn" data-n1-export>${icon('download', 12)} 导出 CSV</button><button class="btn" data-modal-close>关闭</button>`
      });
      root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      root.querySelector('[data-n1-export]')?.addEventListener('click', () => this.exportN1CSV());
      this.toast('N-1 扫描完成', `${s.total} 个事件 · ${s.critical + s.severe} 项严重 · ${s.warning} 项关注。`, s.critical + s.severe ? 'warning' : 'success');
    } catch (e) {
      this.toast('N-1 扫描失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  exportN1CSV() {
    const scan = this.n1Result;
    if (!scan) return;
    const rows = [
      ['ELECTRA N-1 静态安全扫描', this.project.meta.name],
      ['事件数', scan.summary.total, '临界', scan.summary.critical, '严重', scan.summary.severe, '关注', scan.summary.warning],
      [],
      ['停运元件', '编号', '类型', '收敛', '最低电压(pu)', '最大负载率(%)', '越限节点', '过载支路', '评价', '说明'],
      ...scan.cases.map((c) => [c.name, c.tag, c.label, c.converged ? '是' : '否', c.minV, c.maxLoad, c.violations, c.overloads.length, c.severity, c.error || ''])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_N-1扫描.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('已导出 N-1 结果', '扫描结果已导出为 CSV。');
  }

  exportResultsCSV() {
    if (!this.results) { this.toast('暂无结果', '请先运行潮流计算。', 'warning'); return; }
    const r = this.results;
    const rows = [];
    rows.push(['ELECTRA 潮流计算结果', this.project.meta.name]);
    rows.push(['算法', r.label, '收敛', r.converged ? '是' : '否', '迭代', r.iterations, '最大不平衡量', r.mismatch]);
    rows.push([]);
    rows.push(['母线节点']);
    rows.push(['编号', '名称', '类型', 'V(pu)', '相角(°)', '电压(kV)', 'P_gen(MW)', 'Q_gen(Mvar)', 'P_load(MW)', 'Q_load(Mvar)']);
    for (const b of r.busResults) rows.push([b.tag, b.name, b.type, b.Vm, b.Va, b.VkV, b.pGen, b.qGen, b.pLoad, b.qLoad]);
    rows.push([]);
    rows.push(['支路潮流']);
    rows.push(['编号', '名称', '类型', '起点', '终点', 'P首(MW)', 'Q首(Mvar)', 'P末(MW)', 'Q末(Mvar)', 'ΔP(MW)', 'ΔQ(Mvar)', '电流(kA)', '负载率(%)']);
    for (const b of r.branchResults) rows.push([b.tag, b.name, b.type, b.fromName, b.toName, b.pFrom, b.qFrom, b.pTo, b.qTo, b.pLoss, b.qLoss, b.current, b.loading]);
    const csv = rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_潮流结果.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('已导出结果', '潮流结果已导出为 CSV 文件。');
  }

  /* ---------------- Protection actions ---------------- */
  openProtectionLibrary() {
    const selected = this.project.relays.find((r) => r.id === this.protectionSelectedId);
    const groups = [
      ['line', '线路保护', 'line'],
      ['transformer', '变压器保护', 'transformer'],
      ['bus', '母线保护', 'bus']
    ];
    const body = `<div class="method-note" style="margin-bottom:12px">${icon('shield', 12)} 共 <b>${PROTECTION_COUNT}</b> 种主流保护功能。线路、变压器、母线保护共用同一套配置、校验与报告框架；核心保护使用专用整定卡片，扩展保护使用通用定值卡。</div>
      <div class="protection-catalog">${groups.map(([cat, label, ico]) => `<div class="catalog-column"><div class="catalog-head">${icon(ico, 14)} ${label}<span>${protectionsFor(cat).length} 种</span></div>${PROTECTION_CATALOG.filter((p) => p.category === cat).map((p) => {
        const inst = selected?.targetType === (cat === 'bus' ? 'bus' : 'branch') && selected?.protections?.[p.id];
        return `<div class="catalog-row"><span class="catalog-code">${esc(p.code)}</span><span class="catalog-name">${esc(p.name)}${p.core ? '<em>核心</em>' : ''}</span><span class="catalog-state ${inst ? (inst.enabled !== false ? 'on' : 'off') : ''}">${inst ? (inst.enabled !== false ? '投入' : '退出') : '可配置'}</span><span class="catalog-desc">${esc(p.description)}</span></div>`;
      }).join('')}</div>`).join('')}</div>`;
    const { root } = showModal({ title: '主流保护功能库', kicker: 'PROTECTION FUNCTION CATALOG', subtitle: `${PROTECTION_COUNT} 种 · 线路 / 变压器 / 母线`, body, size: 'matrix', footer: `<button class="btn" data-modal-close>关闭</button>` });
    root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
  }

  autoSetProtection(all = true) {
    try {
      const existing = new Set(this.project.relays.map((r) => r.branchId));
      for (const br of this.project.branches.filter((b) => b.type === 'line' || b.type === 'transformer')) {
        if (!existing.has(br.id)) this.project.relays.push(newRelay(br));
      }
      if (all) {
        const summary = autoSetAll(this.project, this.results);
        const target = this.project.relays[0]?.id || null;
        if (target) this.protectionSelectedId = this.protectionSelectedId || target;
        this.commit('自动整定全部保护');
        this.refreshProtectionSummary();
        if (this.mode === 'protection') this.rerender();
        this.toast('自动整定完成', `${summary.count} 套保护已更新 · 共享母线级差校核 ${summary.coordinated} 次。`);
      } else {
        const relay = this.project.relays.find((r) => r.id === this.protectionSelectedId);
        if (!relay) { this.toast('请先选择保护', '从左侧列表选择一套保护装置。', 'warning'); return; }
        if (relay.targetType === 'bus') { this.toast('母线保护无需距离整定', '母线保护功能使用推荐定值，可在功能库中逐项调整。', 'info'); return; }
        const branch = this.project.branches.find((b) => b.id === relay.branchId);
        const { levels, maxLevel } = branchLevels(this.project);
        autoSetRelay(this.project, relay, { result: this.results, level: levels.get(branch?.id) || 1, maxLevel });
        this.commit('自动整定保护');
        this.refreshProtectionSummary();
        if (this.mode === 'protection') this.rerender();
        this.toast('本套保护已整定', `${relay.name} · CT ${relay.ct.primary}/${relay.ct.secondary} · 过流 ${relay.overcurrent.pickup} A。`);
      }
    } catch (e) {
      this.toast('自动整定失败', e.message, 'error');
    }
  }

  resetSelectedRelay() {
    const relay = this.project.relays.find((r) => r.id === this.protectionSelectedId);
    if (!relay) return;
    resetRelayToFactory(this.project, relay);
    if (relay.targetType === 'bus') {
      this.commit('恢复母线保护推荐值');
      this.refreshProtectionSummary();
      if (this.mode === 'protection') this.rerender();
      this.toast('母线保护已恢复推荐值', `${relay.name} · ${Object.keys(relay.protections || {}).length} 项功能。`);
      return;
    }
    this.autoSetProtection(false);
  }

  refreshProtectionSummary() {
    this.protectionSummary = protectionSummary(this.project, this.results);
    this.protectionSensitivity = null;
  }

  /* ---------------- Short circuit actions ---------------- */
  async runShortCircuitCalculation() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法计算短路', '请先修正网络错误。', 'error'); return; }
    if (!this.scOptions.busId) this.scOptions.busId = this.project.buses[0]?.id || null;
    this.showLoading('正在求取戴维南等值阻抗与短路电流…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const res = runShortCircuit(this.project, {
        busId: this.scOptions.busId,
        faultType: this.scOptions.faultType,
        c: this.scOptions.c,
        sourceMVA: this.scOptions.sourceMVA,
        faultImpedanceOhm: this.scOptions.faultImpedanceOhm,
        includeGenerators: true,
        includeMotors: this.scOptions.includeMotors !== false
      });
      this.shortCircuit = res;
      this.shortCircuitSignature = this.electricalSignature();
      if (this.mode !== 'shortcircuit') this.setMode('shortcircuit', true);
      else this.rerender();
      this.toast('短路计算完成', `${res.busTag} ${res.faultTypeLabel} · I″k = ${res.Ik.toFixed(2)} kA · S″k = ${res.Sk.toFixed(0)} MVA。`);
    } catch (e) {
      this.toast('短路计算失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  async runShortCircuitScan() {
    const v = this.refreshValidation();
    if (v.errors) { this.toast('无法执行全网扫描', '请先修正网络错误。', 'error'); return; }
    if (!this.project.buses.length) { this.toast('无法执行全网扫描', '工程中没有母线。', 'error'); return; }
    this.showLoading('正在逐母线计算短路电流并校核耐受能力…');
    await new Promise((r) => setTimeout(r, 45));
    try {
      const scan = scanShortCircuitBuses(this.project, {
        faultType: this.scOptions.faultType,
        c: this.scOptions.c,
        sourceMVA: this.scOptions.sourceMVA,
        faultImpedanceOhm: this.scOptions.faultImpedanceOhm,
        includeGenerators: true,
        includeMotors: this.scOptions.includeMotors !== false
      });
      this.scanShortCircuitResult = scan;
      this.scanShortCircuitSignature = this.electricalSignature();
      const s = scan.summary;
      const body = `
        <div class="grid-3" style="margin-bottom:11px">
          <div class="metric" style="padding:10px 12px"><div class="m-label">最大短路电流</div><div class="m-value">${s.maxIk == null ? '—' : s.maxIk.toFixed(2)} <small>kA</small></div><div class="m-foot">${esc(s.maxBus || '—')}</div></div>
          <div class="metric ${s.exceed ? 'bad' : 'good'}" style="padding:10px 12px"><div class="m-label">超出母线耐受</div><div class="m-value">${s.exceed}</div><div class="m-foot">按各母线短路耐受电流校核</div></div>
          <div class="metric" style="padding:10px 12px"><div class="m-label">扫描完成</div><div class="m-value">${s.tested}<span style="font-size:12px;color:var(--dim)"> / ${s.total}</span></div><div class="m-foot">${s.failed ? `${s.failed} 个节点计算失败` : '全部母线计算成功'}</div></div>
        </div>
        <div class="method-note" style="margin-bottom:10px">${icon('info', 12)} ${esc(s.faultTypeLabel)} · c=${s.c} · 系统短路容量 ${s.sourceMVA} MVA。短路电流与母线耐受值比较；超限母线以红色标出。</div>
        <div class="table-wrap tall"><table class="data-table"><thead><tr><th>母线</th><th>电压等级</th><th>I″k (kA)</th><th>S″k (MVA)</th><th>ip (kA)</th><th>耐受 (kA)</th><th>裕度</th><th>校核</th></tr></thead><tbody>
          ${scan.rows.map((r) => {
            if (r.error) return `<tr class="row-bad"><td><div class="name-cell">${esc(r.name)}</div><div class="cell-sub">${esc(r.tag)}</div></td><td>${r.vn} kV</td><td colspan="5" style="color:var(--red)">${esc(r.error)}</td><td><span class="status-pill bad">失败</span></td></tr>`;
            const bad = r.ok === false;
            return `<tr class="${bad ? 'row-bad' : ''}"><td><div class="name-cell">${esc(r.name)}</div><div class="cell-sub">${esc(r.tag)}</div></td><td>${r.vn} kV</td><td class="num">${r.Ik.toFixed(2)}</td><td class="num">${r.Sk.toFixed(0)}</td><td class="num">${r.ip.toFixed(2)}</td><td class="num">${r.scRating == null ? '—' : r.scRating.toFixed(1)}</td><td class="num">${r.marginPct == null ? '—' : `${r.marginPct.toFixed(1)}%`}</td><td><span class="status-pill ${bad ? 'bad' : 'ok'}">${bad ? '超限' : '通过'}</span></td></tr>`;
          }).join('')}
        </tbody></table></div>
        <div class="method-note" style="margin-top:10px">${icon('warning', 12)} 母线耐受能力为工程属性，可在母线属性面板修改。正式设备校核还需核对断路器开断能力、动稳定电流、热稳定电流及保护动作时间。</div>`;
      const { root } = showModal({
        title: '全网短路电流扫描', kicker: 'SHORT-CIRCUIT SWEEP',
        subtitle: `${this.project.meta.name} · ${s.total} 条母线 · 逐点戴维南等值计算`,
        body, size: 'lg',
        footer: `<button class="btn" data-scan-apply>${icon('target', 12)} 查看最大故障点</button><button class="btn" data-scan-export>${icon('download', 12)} 导出 CSV</button><button class="btn" data-modal-close>关闭</button>`
      });
      root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
      root.querySelector('[data-scan-export]')?.addEventListener('click', () => this.exportShortCircuitScanCSV());
      root.querySelector('[data-scan-apply]')?.addEventListener('click', () => {
        const maxRow = scan.rows.find((r) => r.Ik != null);
        if (!maxRow) return;
        this.scOptions.busId = maxRow.busId;
        closeModal();
        this.runShortCircuitCalculation();
      });
      this.toast('全网短路扫描完成', `${s.total} 条母线 · 最大 ${s.maxIk?.toFixed(2)} kA @ ${s.maxBusTag || '—'} · ${s.exceed} 条超出耐受。`, s.exceed ? 'warning' : 'success');
    } catch (e) {
      this.toast('全网扫描失败', e.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  exportShortCircuitScanCSV() {
    const scan = this.scanShortCircuitResult;
    if (!scan) return;
    const rows = [
      ['ELECTRA 全网短路电流扫描', this.project.meta.name],
      ['故障类型', scan.summary.faultTypeLabel, 'c', scan.summary.c, '系统短路容量(MVA)', scan.summary.sourceMVA],
      ['母线', '编号', '电压(kV)', 'Ik(kA)', 'Sk(MVA)', 'ip(kA)', '耐受(kA)', '裕度(%)', '校核', '错误'],
      ...scan.rows.map((r) => [r.name, r.tag, r.vn, r.Ik, r.Sk, r.ip, r.scRating, r.marginPct, r.error ? '失败' : r.ok ? '通过' : '超限', r.error || ''])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_全网短路扫描.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('已导出扫描结果', '全网短路电流与母线耐受校核已导出。');
  }

  exportShortCircuitCSV() {
    const r = this.shortCircuit;
    if (!r) { this.toast('暂无短路结果', '请先计算短路电流。', 'warning'); return; }
    const rows = [
      ['ELECTRA 短路电流计算', this.project.meta.name],
      ['故障母线', r.busName, '电压', r.baseKV, '故障类型', r.faultTypeLabel],
      ['Ik(kA)', r.Ik, 'Sk(MVA)', r.Sk, 'ip(kA)', r.ip, 'Zth(Ω)', r.zThOhm, 'X/R', r.xr],
      [], ['母线电压暂降'], ['编号', '母线', '电压等级', '残压(pu)', '残压(kV)', '暂降(%)'],
      ...r.busVoltages.map((b) => [b.tag, b.name, b.vn, b.vpu, b.vkV, b.dip]),
      [], ['支路故障电流'], ['编号', '支路', '首端(kA)', '末端(kA)'],
      ...r.branchCurrents.map((b) => [b.tag, b.name, b.iFrom, b.iTo]),
      [], ['电源贡献'], ['名称', '短路电流(kA)', '等值电抗(pu)'],
      ...r.sources.map((s) => [s.name, s.current, s.xPu])
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_短路计算.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('已导出短路结果', '短路电流与母线电压暂降已导出。');
  }

  /* ---------------- Deletion & project settings ---------------- */
  deleteSelection() {
    const sel = this.selection;
    if (!sel || sel.kind === 'project') return;
    let title = '删除所选元素？';
    let text = '该操作可通过撤销恢复。';
    if (sel.kind === 'bus') {
      const bus = this.project.buses.find((b) => b.id === sel.id);
      const branches = this.project.branches.filter((b) => b.from === sel.id || b.to === sel.id);
      const injects = this.project.injections.filter((x) => x.bus === sel.id);
      title = `删除母线“${bus?.tag || ''}”？`;
      text = `将同时删除 ${branches.length} 条连接支路和 ${injects.length} 个接入设备。该操作可通过撤销恢复。`;
    } else if (sel.kind === 'branch') {
      const br = this.project.branches.find((b) => b.id === sel.id);
      title = `删除支路“${br?.tag || ''}”？`;
      text = '支路参数与对应继电保护配置将被一并删除。';
    } else if (sel.kind === 'injection') {
      const inj = this.project.injections.find((x) => x.id === sel.id);
      title = `删除设备“${inj?.tag || ''}”？`;
      text = '设备参数与运行状态将从工程中移除。';
    }
    confirmModal({
      title, text, confirmLabel: '确认删除',
      onConfirm: () => {
        if (sel.kind === 'bus') {
          const branchIds = this.project.branches.filter((b) => b.from === sel.id || b.to === sel.id).map((b) => b.id);
          this.project.relays = this.project.relays.filter((r) => !branchIds.includes(r.branchId));
          this.project.branches = this.project.branches.filter((b) => b.from !== sel.id && b.to !== sel.id);
          this.project.injections = this.project.injections.filter((x) => x.bus !== sel.id);
          this.project.buses = this.project.buses.filter((b) => b.id !== sel.id);
        } else if (sel.kind === 'branch') {
          this.project.branches = this.project.branches.filter((b) => b.id !== sel.id);
          this.project.relays = this.project.relays.filter((r) => r.branchId !== sel.id);
        } else if (sel.kind === 'injection') {
          this.project.injections = this.project.injections.filter((x) => x.id !== sel.id);
        }
        this.selection = { kind: 'project', id: null };
        this.invalidateResults();
        this.commit('删除元素');
        this.refreshAll();
        this.editor?.render();
        this.toast('已删除', '可使用 Ctrl+Z 撤销此操作。');
      }
    });
  }

  openProjectSettings() {
    const m = this.project.meta;
    const body = `<div class="form-grid">
      <div class="modal-field full"><label>工程名称</label><input data-meta="name" value="${esc(m.name)}"></div>
      <div class="modal-field"><label>工程编号</label><input data-meta="projectNo" value="${esc(m.projectNo)}"></div>
      <div class="modal-field"><label>设计单位</label><input data-meta="owner" value="${esc(m.owner || '')}"></div>
      <div class="modal-field"><label>基准容量 (MVA)</label><input data-meta="baseMVA" type="number" min="1" step="10" value="${m.baseMVA}"></div>
      <div class="modal-field"><label>系统频率 (Hz)</label><input data-meta="frequency" type="number" value="${m.frequency}"></div>
      <div class="modal-field"><label>系统短路容量 (MVA)</label><input data-meta="sourceMVA" type="number" min="10" step="100" value="${m.sourceMVA || 12000}"><div class="hint">用于短路电流等值电源，可按电网提供的短路容量填写。</div></div>
      <div class="modal-field"><label>设计日期</label><input data-meta="date" type="date" value="${esc(m.date)}"></div>
      <div class="modal-field full"><label>工程说明</label><textarea data-meta="note">${esc(m.note || '')}</textarea></div>
    </div>
    <div class="modal-help">修改基准容量会改变整个网络的标幺值体系；保存后建议重新运行潮流与短路计算。</div>`;
    const { root } = showModal({
      title: '工程设置', kicker: 'PROJECT SETTINGS', subtitle: '工程元数据、系统基准与短路计算等值参数', body, size: 'md',
      footer: `<button class="btn" data-modal-close>取消</button><button class="btn btn-primary" data-save-meta>保存设置</button>`
    });
    root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
    root.querySelector('[data-save-meta]').onclick = () => {
      const next = { ...m };
      root.querySelectorAll('[data-meta]').forEach((el) => {
        const k = el.dataset.meta;
        next[k] = el.type === 'number' ? Number(el.value) : el.value;
      });
      if (!(next.baseMVA > 0)) { this.toast('参数无效', '基准容量必须大于 0。', 'error'); return; }
      this.project.meta = next;
      this.scOptions.sourceMVA = Number(next.sourceMVA) || this.scOptions.sourceMVA;
      this.invalidateResults();
      this.commit('修改工程设置');
      closeModal();
      this.refreshShell();
      this.updateProjectChrome();
      if (this.mode === 'design') this.refreshAll();
      else this.rerender();
      this.toast('设置已保存', '工程元数据与基准参数已更新。');
    };
  }

  openShortcuts() {
    const rows = [
      ['选择 / 移动', 'V'], ['平移画布', 'H / 空格拖动'], ['适应窗口', 'F'],
      ['删除所选', 'Delete'], ['撤销', 'Ctrl + Z'], ['重做', 'Ctrl + Y'],
      ['运行潮流', 'Ctrl + Enter'], ['保存工程', 'Ctrl + S'], ['打开工程', 'Ctrl + O'],
      ['取消当前工具', 'Esc'], ['缩放画布', '滚轮'], ['打开属性', '双击母线']
    ];
    const body = `<div class="kbd-grid">${rows.map(([a, b]) => `<div class="kbd-row"><span>${esc(a)}</span><kbd>${esc(b)}</kbd></div>`).join('')}</div>
      <div class="modal-help" style="margin-top:14px"><b>操作提示</b><br>添加线路或变压器时，依次单击起点母线与终点母线。单击设备库按钮后，画布顶部会显示当前操作提示。母线可拖动，支路路由会自动重排。</div>`;
    const { root } = showModal({ title: '快捷键与操作指南', kicker: 'KEYBOARD & WORKFLOW', subtitle: '面向键盘与鼠标的快速设计流程', body, size: 'md', footer: `<button class="btn" data-modal-close>知道了</button>` });
    root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
  }

  /* ---------------- Report / diagram ---------------- */
  captureDiagram() {
    try {
      if (this.editor) this.lastDiagramSVG = this.editor.exportSVG(false);
    } catch (e) {
      console.warn('单线图快照失败', e);
    }
  }

  exportReportHTML() {
    const paper = document.getElementById('report-paper');
    if (!paper) return;
    const css = `
      body{font-family:'Microsoft YaHei','PingFang SC','Segoe UI',sans-serif;background:#e9eef3;margin:0;padding:28px;color:#1b2734}
      .report-paper{width:862px;max-width:100%;margin:0 auto;background:#f7f8fb;padding:46px 54px;box-shadow:0 20px 60px rgba(0,0,0,.15);position:relative}
      .report-paper::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#159f87,#43cdb1 55%,#285b84)}
      .rp-top{display:flex;justify-content:space-between;border-bottom:2px solid #193548;padding-bottom:18px;margin-bottom:24px}
      .rp-brand{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#55758d;font-weight:700}
      .rp-title{font-size:26px;font-weight:760;margin:6px 0 4px;color:#112635}
      .rp-subtitle{font-size:11px;color:#607a8c}.rp-doc{text-align:right;font-family:Consolas,monospace;font-size:8.5px;color:#647d8e;line-height:1.7}
      .report-paper h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#18394c;border-bottom:1px solid #cbd8e1;padding-bottom:6px;margin:25px 0 11px}
      .report-paper h2 .num{font-family:Consolas,monospace;font-size:9px;color:#218d7c;background:#e3f4f0;border-radius:3px;padding:1px 4px;margin-right:6px}
      .report-paper h3{font-size:10px;color:#2a485c;margin:13px 0 6px}.report-paper p{font-size:9.5px;line-height:1.75;color:#405a6c;margin:0 0 8px}
      .report-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.report-kv{display:grid;grid-template-columns:90px 1fr;gap:5px 8px;font-size:9px}
      .report-kv .k{color:#6a8293}.report-kv .v{color:#203c4d;font-weight:600}
      .report-table{width:100%;border-collapse:collapse;font-size:8.3px;margin:7px 0 10px}.report-table th{text-align:left;background:#e9eff4;color:#385668;padding:5px 6px;border:1px solid #d3dee6;font-weight:650}
      .report-table td{padding:4px 6px;border:1px solid #dce5eb;color:#354f61}.report-table td.num{font-family:Consolas,monospace;text-align:right}
      .report-callout{border-left:3px solid #28a58e;background:#edf7f4;padding:9px 11px;font-size:9px;line-height:1.7;color:#3a605b;margin:10px 0}.report-callout.warn{border-color:#d39536;background:#fbf5e9;color:#6f5c3b}
      .report-signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:36px;padding-top:18px;border-top:1px solid #d3dee6}
      .report-signatures .sig .line{border-bottom:1px solid #91a6b4;height:25px}.report-signatures .sig .cap{font-size:8px;color:#6d8291;margin-top:5px}
      .report-footer{margin-top:28px;padding-top:9px;border-top:1px solid #dbe4ea;display:flex;justify-content:space-between;font-size:7.5px;color:#8a9daa;font-family:Consolas,monospace}
      .report-watermark{position:absolute;right:38px;top:154px;font-size:78px;font-weight:800;color:rgba(27,63,80,.028);letter-spacing:.05em;transform:rotate(-8deg);pointer-events:none}
      .report-diagram svg{max-width:100%;height:auto}@media print{body{background:#fff;padding:0}.report-paper{box-shadow:none;padding:28px 34px;width:100%}}@page{size:A4;margin:14mm}
    `;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(this.project.meta.name)} · 设计计算报告</title><style>${css}</style></head><body>${paper.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.meta.name}_设计报告.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('报告已导出', 'HTML 文件可离线打开并打印为 PDF。');
  }

  /* ---------------- Loading / toast ---------------- */
  showLoading(text) {
    let el = document.getElementById('loading-overlay');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.className = 'loading-overlay';
    el.innerHTML = `<div class="loading-card"><span class="spinner"></span><span>${esc(text)}</span></div>`;
    document.body.appendChild(el);
  }

  hideLoading() {
    document.getElementById('loading-overlay')?.remove();
  }

  toast(title, msg = '', type = 'success') {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icon(type === 'error' ? 'x' : type === 'warning' ? 'warning' : 'check', 12)}</span><span class="toast-copy"><span class="toast-title">${esc(title)}</span>${msg ? `<span class="toast-msg">${esc(msg)}</span>` : ''}</span><button class="toast-close">${icon('close', 11)}</button>`;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const remove = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 230); };
    el.querySelector('.toast-close').onclick = remove;
    setTimeout(remove, type === 'error' ? 6500 : 4200);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.electra = new App();
});
