import { newBus, newBranch, newInjection, nextTag, isSwitchType, isSeriesType } from '../model.js';
import { newRelay } from '../model.js';
import { icon } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function voltageColor(vn) {
  const v = Number(vn) || 110;
  if (v >= 500) return '#ffc46e';
  if (v >= 330) return '#ffad72';
  if (v >= 220) return '#5fe2c9';
  if (v >= 110) return '#65adff';
  if (v >= 35) return '#b898ff';
  return '#8da2ba';
}

export function voltageClassLabel(vn) {
  const v = Number(vn) || 110;
  if (v >= 500) return '超高压';
  if (v >= 220) return '高压';
  if (v >= 110) return '高压配电';
  return '中压';
}

const BUS_TYPES = { slack: '平衡节点', PV: 'PV 节点', PQ: 'PQ 节点' };
const BUS_TYPE_SHORT = { slack: 'SLACK', PV: 'PV', PQ: 'PQ' };

function pointAlong(points, ratio) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(l);
    total += l;
  }
  let target = total * ratio;
  for (let i = 1; i < points.length; i++) {
    const l = lengths[i - 1];
    if (target <= l || i === points.length - 1) {
      const a = points[i - 1];
      const b = points[i];
      const r = l > 0 ? target / l : 0;
      return {
        x: a.x + (b.x - a.x) * r,
        y: a.y + (b.y - a.y) * r,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        segment: i - 1
      };
    }
    target -= l;
  }
  const p = points[points.length - 1];
  return { x: p.x, y: p.y, angle: 0, segment: points.length - 2 };
}

function routePoints(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (Math.abs(dy) < 3) return [{ ...p1 }, { ...p2 }];
  if (Math.abs(dx) < 80 && Math.abs(dy) > 90) {
    return [{ ...p1 }, { x: p1.x, y: p2.y }, { ...p2 }];
  }
  const midY = p1.y + dy * 0.5;
  return [
    { ...p1 },
    { x: p1.x, y: midY },
    { x: p2.x, y: midY },
    { ...p2 }
  ];
}

class SchematicEditor {
  constructor(host, app) {
    this.host = host;
    this.app = app;
    this.stage = null;
    this.svg = null;
    this.world = null;
    this.tool = 'select';
    this.branchType = null;
    this.injType = null;
    this.pendingBus = null;
    this.pendingSecond = null;
    this.drag = null;
    this.pan = null;
    this.spaceDown = false;
    this.pointerWorld = { x: 0, y: 0 };
    this.resizeObserver = null;
    this._handlers = [];
    this.mount();
  }

  get project() { return this.app.project; }
  get view() { return this.project.view || (this.project.view = { x: 80, y: 70, k: 0.75 }); }
  get ui() { return this.app.ui; }

  mount() {
    this.host.innerHTML = `
      <div class="canvas-stage" id="canvas-stage">
        <div class="canvas-toolbar">
          <button class="icon-btn active" data-tool="select" title="选择 / 移动（V）">${icon('cursor', 16)}</button>
          <button class="icon-btn" data-tool="pan" title="平移画布（H / 空格拖动）">${icon('hand', 16)}</button>
          <span class="tb-sep"></span>
          <button class="icon-btn" data-action="fit" title="适应窗口（F）">${icon('fit', 16)}</button>
          <button class="icon-btn" data-action="zoom-in" title="放大">${icon('plus', 16)}</button>
          <button class="icon-btn" data-action="zoom-out" title="缩小">${icon('minus', 16)}</button>
          <button class="icon-btn" data-action="toggle-grid" title="显示/隐藏网格">${icon('grid', 16)}</button>
          <span class="tb-sep"></span>
          <button class="icon-btn" data-action="show-flow" title="显示潮流结果">${icon('wave', 16)}</button>
          <button class="icon-btn" data-action="toggle-labels" title="简洁 / 完整标注">${icon('eye', 16)}</button>
          <button class="icon-btn" data-action="export-svg" title="导出 SVG">${icon('download', 16)}</button>
        </div>
        <div class="canvas-hint" id="canvas-hint">${icon('cursor', 12)} 拖动母线调整位置 · 滚轮缩放 · 空格 + 拖动平移画布 <kbd>F</kbd> 适应窗口</div>
        <div class="canvas-flow-chip hidden" id="canvas-flow-chip"><span class="dot"></span><span>潮流结果</span></div>
        <div class="canvas-empty hidden" id="canvas-empty"></div>
        <svg id="schematic" class="schematic-svg" xmlns="${SVG_NS}"></svg>
        <div class="zoom-chip">
          <button data-action="zoom-out" title="缩小">${icon('minus', 13)}</button>
          <span class="level" id="zoom-level">75%</span>
          <button data-action="zoom-in" title="放大">${icon('plus', 13)}</button>
          <button data-action="fit" title="适应窗口">${icon('fit', 13)}</button>
        </div>
      </div>
      <div class="canvas-status">
        <div class="item"><span class="status-dot" id="health-dot"></span><span id="status-health">网络就绪</span></div>
        <div class="item"><span>母线</span><b id="status-buses">0</b></div>
        <div class="item"><span>支路</span><b id="status-branches">0</b></div>
        <div class="item"><span>设备</span><b id="status-injections">0</b></div>
        <div class="item"><span>保护</span><b id="status-relays">0</b></div>
        <div class="spacer"></div>
        <div class="item coord" id="cursor-coord">x 0 · y 0</div>
        <button class="help-link" data-action="shortcuts">${icon('keyboard', 11)} 快捷键</button>
      </div>
    `;
    this.stage = this.host.querySelector('#canvas-stage');
    this.svg = this.host.querySelector('#schematic');
    this.world = document.createElementNS(SVG_NS, 'g');
    this.world.setAttribute('class', 'world');
    this.svg.appendChild(this.world);
    this.bind();
    this.applyView();
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.applyView());
    this.resizeObserver.observe(this.stage);
  }

  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    for (const [target, type, fn] of this._handlers) target.removeEventListener(type, fn);
    this._handlers = [];
  }

  on(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this._handlers.push([target, type, fn]);
  }

  bind() {
    this.on(this.stage, 'pointerdown', (e) => this.onPointerDown(e));
    this.on(window, 'pointermove', (e) => this.onPointerMove(e));
    this.on(window, 'pointerup', (e) => this.onPointerUp(e));
    this.on(this.stage, 'wheel', (e) => this.onWheel(e), { passive: false });
    this.on(this.stage, 'dblclick', (e) => {
      const bus = e.target.closest('[data-kind="bus"]');
      if (bus) this.app.select('bus', bus.dataset.id);
    });
    this.on(this.stage, 'click', (e) => {
      if (e.target.closest('[data-action]')) return;
    });
    this.on(this.stage, 'contextmenu', (e) => {
      if (e.target.closest('[data-kind]')) e.preventDefault();
    });
    this.on(window, 'keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
        this.spaceDown = true;
        this.stage.classList.add('is-panning');
        e.preventDefault();
      }
      if (e.key === 'Escape') this.cancelTool();
    });
    this.on(window, 'keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.stage.classList.remove('is-panning');
        if (this.pan) this.pan = null;
      }
    });
    this.on(this.stage, 'click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'fit') this.fit();
      if (action.dataset.action === 'zoom-in') this.zoomBy(1.2);
      if (action.dataset.action === 'zoom-out') this.zoomBy(1 / 1.2);
      if (action.dataset.action === 'toggle-grid') this.toggleGrid();
      if (action.dataset.action === 'export-svg') this.exportSVG();
      if (action.dataset.action === 'show-flow') this.app.toggleFlow();
      if (action.dataset.action === 'toggle-labels') this.app.toggleCompactLabels();
      if (action.dataset.action === 'shortcuts') this.app.openShortcuts();
      const toolBtn = e.target.closest('[data-tool]');
      if (toolBtn) {
        if (toolBtn.dataset.tool === 'select') this.cancelTool();
        if (toolBtn.dataset.tool === 'pan') this.setTool('pan');
      }
    });
  }

  setTool(tool) {
    this.tool = tool;
    this.pendingBus = null;
    this.stage.dataset.tool = tool;
    this.stage.classList.toggle('tool-pan', tool === 'pan');
    for (const btn of this.stage.querySelectorAll('[data-tool]')) {
      btn.classList.toggle('active', btn.dataset.tool === (tool === 'pan' ? 'pan' : 'select'));
    }
    this.updateHint();
    this.app.setArmed(null);
    this.render();
  }

  arm(kind) {
    if (['bus'].includes(kind)) {
      this.tool = 'add-bus';
      this.branchType = null;
      this.injType = null;
    } else if (kind === 'cable' || kind === 'line' || kind === 'transformer' || kind === 'transformer3' || kind === 'breaker' || kind === 'recloser' || kind === 'loadSwitch' || kind === 'switch' || kind === 'disconnector' || kind === 'sectionalizer' || kind === 'fuse' || kind === 'seriesReactor' || kind === 'seriesCap' || kind === 'fcl') {
      this.tool = 'add-branch';
      this.branchType = kind;
      this.injType = null;
    } else if (['generator', 'load', 'shunt'].includes(kind)) {
      this.tool = 'add-injection';
      this.injType = kind;
      this.branchType = null;
    }
    this.pendingBus = null;
    this.pendingSecond = null;
    this.stage.dataset.tool = this.tool;
    this.stage.classList.remove('tool-pan');
    for (const btn of this.stage.querySelectorAll('[data-tool]')) btn.classList.remove('active');
    this.stage.classList.add('is-armed');
    this.app.setArmed(kind);
    this.updateHint();
    this.render();
  }

  cancelTool(keepSelection = true) {
    if (this.tool === 'select' && !this.pendingBus) return;
    this.tool = 'select';
    this.branchType = null;
    this.injType = null;
    this.pendingBus = null;
    this.pendingSecond = null;
    this.stage.dataset.tool = 'select';
    this.stage.classList.remove('is-armed', 'tool-pan');
    for (const btn of this.stage.querySelectorAll('[data-tool]')) btn.classList.toggle('active', btn.dataset.tool === 'select');
    this.app.setArmed(null);
    this.updateHint();
    this.render();
  }

  updateHint() {
    const hint = this.host.querySelector('#canvas-hint');
    if (!hint) return;
    let text = '';
    if (this.tool === 'add-bus') text = '在画布空白处单击放置母线 · <kbd>Esc</kbd> 取消';
    else if (this.tool === 'add-branch' && this.branchType === 'transformer3' && !this.pendingBus) text = '选择三绕组变压器的高压侧母线 · <kbd>Esc</kbd> 取消';
    else if (this.tool === 'add-branch' && this.branchType === 'transformer3' && !this.pendingSecond) text = '已选高压侧，请选择中压侧母线 · <kbd>Esc</kbd> 取消';
    else if (this.tool === 'add-branch' && this.branchType === 'transformer3') text = '已选高、中压侧，请选择低压侧母线 · <kbd>Esc</kbd> 取消';
    else if (this.tool === 'add-branch' && !this.pendingBus) text = `选择 ${this.branchLabel()} 的起点母线 · <kbd>Esc</kbd> 取消`;
    else if (this.tool === 'add-branch' && this.pendingBus) text = `已选起点，请选择 ${this.branchLabel()} 的终点母线 · <kbd>Esc</kbd> 取消`;
    else if (this.tool === 'add-injection') text = `选择要接入 ${this.injectionLabel()} 的母线 · <kbd>Esc</kbd> 取消`;
    else if (this.tool === 'pan') text = '按住并拖动平移画布 · 滚轮缩放 · <kbd>F</kbd> 适应窗口';
    else text = '拖动母线调整位置 · 滚轮缩放 · 空格 + 拖动平移画布 · 双击母线打开属性';
    hint.innerHTML = `${icon(this.tool === 'select' ? 'cursor' : this.tool === 'pan' ? 'hand' : 'target', 12)} ${text}${this.tool === 'select' ? ' <kbd>F</kbd> 适应窗口' : ''}`;
  }

  branchLabel() {
    return { cable: '电缆', line: '线路', transformer: '变压器', transformer3: '三绕组变压器', breaker: '断路器', switch: '隔离开关', disconnector: '隔离开关', loadSwitch: '负荷开关', recloser: '重合器', sectionalizer: '分段器', fuse: '熔断器', seriesReactor: '串联电抗器', seriesCap: '串联电容器', fcl: '故障电流限制器' }[this.branchType] || '支路';
  }

  injectionLabel() {
    return { generator: '发电机', load: '负荷', shunt: '补偿装置' }[this.injType] || '设备';
  }

  applyView() {
    if (!this.stage || !this.svg) return;
    const r = this.stage.getBoundingClientRect();
    this.svg.setAttribute('viewBox', `0 0 ${Math.max(1, r.width)} ${Math.max(1, r.height)}`);
    this.svg.setAttribute('width', r.width);
    this.svg.setAttribute('height', r.height);
    this.world.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);
    const gs = Math.max(8, 22 * this.view.k);
    this.stage.style.backgroundSize = `${gs}px ${gs}px`;
    this.stage.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
    const z = this.host.querySelector('#zoom-level');
    if (z) z.textContent = `${Math.round(this.view.k * 100)}%`;
  }

  zoomBy(factor, center) {
    const stageRect = this.stage.getBoundingClientRect();
    const cx = center?.x ?? stageRect.width / 2;
    const cy = center?.y ?? stageRect.height / 2;
    const oldK = this.view.k;
    const newK = clamp(oldK * factor, 0.16, 2.4);
    const wx = (cx - this.view.x) / oldK;
    const wy = (cy - this.view.y) / oldK;
    this.view.k = newK;
    this.view.x = cx - wx * newK;
    this.view.y = cy - wy * newK;
    this.applyView();
    this.app.scheduleSave();
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.stage.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0011);
    this.zoomBy(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  screenToWorld(clientX, clientY) {
    const r = this.svg.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.view.x) / this.view.k,
      y: (clientY - r.top - this.view.y) / this.view.k
    };
  }

  toggleGrid() {
    this.ui.grid = !this.ui.grid;
    this.stage.classList.toggle('no-grid', !this.ui.grid);
  }

  fit(padding = 72) {
    if (!this.world || !this.project.buses.length) {
      this.view.x = 80; this.view.y = 70; this.view.k = 0.8;
      this.applyView();
      return;
    }
    let bbox;
    try { bbox = this.world.getBBox(); } catch { return; }
    if (!bbox || !bbox.width) return;
    const r = this.stage.getBoundingClientRect();
    const availW = r.width - padding * 2;
    const availH = r.height - padding * 2;
    const k = clamp(Math.min(availW / bbox.width, availH / bbox.height), 0.16, 1.15);
    this.view.k = k;
    this.view.x = (r.width - bbox.width * k) / 2 - bbox.x * k;
    this.view.y = (r.height - bbox.height * k) / 2 - bbox.y * k;
    this.applyView();
    this.app.scheduleSave();
  }

  buildPortMap() {
    const buses = new Map(this.project.buses.map((b) => [b.id, b]));
    const ports = new Map();
    const groups = new Map(this.project.buses.map((b) => [b.id, []]));
    for (const br of this.project.branches) {
      if (br.type === 'transformer3') continue;
      const a = buses.get(br.from);
      const b = buses.get(br.to);
      if (!a || !b || a.id === b.id) continue;
      const ac = { x: a.x + a.width / 2, y: a.y };
      const bc = { x: b.x + b.width / 2, y: b.y };
      const dx = bc.x - ac.x;
      const dy = bc.y - ac.y;
      let category;
      if (Math.abs(dy) > Math.abs(dx) * 0.7) category = dy < 0 ? 'up' : 'down';
      else category = dx < 0 ? 'left' : 'right';
      groups.get(a.id).push({ br, end: 'from', category, other: b.id });
      groups.get(b.id).push({ br, end: 'to', category, other: a.id });
    }
    for (const bus of this.project.buses) {
      const entries = groups.get(bus.id) || [];
      const byCat = { left: [], up: [], down: [], right: [] };
      for (const en of entries) byCat[en.category].push(en);
      // Keep the lower-left part of a bus free for its label. Vertical branches
      // attach on the right half; horizontal branches attach near the ends.
      const ranges = { left: [0.06, 0.27], up: [0.33, 0.56], down: [0.64, 0.79], right: [0.84, 0.94] };
      for (const cat of ['left', 'up', 'down', 'right']) {
        const arr = byCat[cat];
        arr.sort((x, y) => (x.other || '').localeCompare(y.other || ''));
        arr.forEach((en, i) => {
          const [lo, hi] = ranges[cat];
          const f = arr.length === 1 ? (lo + hi) / 2 : lo + (hi - lo) * (i / (arr.length - 1));
          if (!ports.has(en.br.id)) ports.set(en.br.id, {});
          ports.get(en.br.id)[en.end] = {
            x: bus.x + bus.width * f,
            y: bus.y,
            busId: bus.id,
            category: cat
          };
        });
      }
    }
    return ports;
  }

  busResultMap() {
    const map = new Map();
    if (this.app.results?.busResults) for (const b of this.app.results.busResults) map.set(b.busId, b);
    return map;
  }

  branchResultMap() {
    const map = new Map();
    if (this.app.results?.branchResults) for (const b of this.app.results.branchResults) map.set(b.id, b);
    return map;
  }

  render() {
    if (!this.world) return;
    this.world.innerHTML = this.buildWorldMarkup();
    this.applyView();
    this.updateStatus();
    const empty = this.host.querySelector('#canvas-empty');
    if (empty) {
      const show = this.project.buses.length === 0;
      empty.classList.toggle('hidden', !show);
      if (show) {
        empty.innerHTML = `<div class="empty-card">
          <svg class="empty-illustration" viewBox="0 0 120 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 20h92M14 52h32M68 52h38" stroke="#5fe2c9" stroke-width="4" stroke-linecap="round" opacity=".7"/>
            <path d="M40 20v32M82 20v32" stroke="#50718e" stroke-width="1.5" stroke-dasharray="4 4"/>
            <circle cx="40" cy="36" r="7" stroke="#ffbd66" stroke-width="1.5"/>
            <path d="M88 52v-9m0 0-4 4m4-4 4 4" stroke="#ff7d8c" stroke-width="1.5"/>
            <path d="M14 20v10M106 20v10" stroke="#5fe2c9" stroke-width="2" opacity=".4"/>
          </svg>
          <h3>开始绘制一次主接线</h3>
          <p>从左侧设备库添加母线、线路、变压器与电源，构建拓扑后即可进行导纳矩阵、潮流与继电保护计算。</p>
          <button class="btn btn-primary" data-action="quick-add-bus">${icon('plus', 15)} 添加第一条母线</button>
        </div>`;
      }
    }
    const chip = this.host.querySelector('#canvas-flow-chip');
    if (chip) {
      chip.classList.toggle('hidden', !(this.app.results && this.ui.showFlow));
      chip.classList.toggle('warn', !!this.app.results && this.app.results.violations?.length > 0);
      chip.querySelector('span:last-child').textContent = this.app.results
        ? `潮流结果 · ${this.app.results.converged ? '已收敛' : '未收敛'} · 点击隐藏`
        : '潮流结果';
      chip.onclick = () => this.app.toggleFlow();
    }
  }

  buildWorldMarkup(exportMode = false) {
    const ports = this.buildPortMap();
    const buses = new Map(this.project.buses.map((b) => [b.id, b]));
    const busRes = this.busResultMap();
    const brRes = this.branchResultMap();
    const sel = exportMode ? null : this.app.selection;
    let out = '<defs>';
    out += '<marker id="arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker>';
    out += '</defs>';
    // Branches first
    for (const br of this.project.branches) {
      if (br.type === 'transformer3') {
        out += this.threeWindingMarkup(br, buses, sel, exportMode);
        continue;
      }
      if (!ports.has(br.id)) continue;
      out += this.branchMarkup(br, ports.get(br.id), buses, brRes.get(br.id), sel, exportMode);
    }
    // Buses
    for (const bus of this.project.buses) {
      out += this.busMarkup(bus, busRes.get(bus.id), sel, exportMode);
    }
    // Injections
    for (const inj of this.project.injections) {
      const bus = buses.get(inj.bus);
      if (!bus) continue;
      out += this.injectionMarkup(inj, bus, sel, exportMode, ports);
    }
    return out;
  }

  threeWindingMarkup(br, buses, sel, exportMode) {
    const hb = buses.get(br.from);
    const mb = buses.get(br.to);
    const lb = buses.get(br.third);
    if (!hb || !mb || !lb) return '';
    const c = {
      x: (hb.x + hb.width / 2 + mb.x + mb.width / 2 + lb.x + lb.width / 2) / 3,
      y: (hb.y + mb.y + lb.y) / 3
    };
    const busCenters = [hb, mb, lb].map((b) => ({ x: b.x + b.width / 2, y: b.y }));
    const nearest = Math.min(...busCenters.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    if (nearest < 120) {
      const avgX = this.project.buses.reduce((s, b) => s + b.x + b.width / 2, 0) / Math.max(1, this.project.buses.length);
      c.x += c.x < avgX ? -220 : 220;
    }
    const selected = sel?.kind === 'branch' && sel.id === br.id;
    const active = br.status === 'in' && br.fromSwitch !== 'open' && br.toSwitch !== 'open' && br.thirdSwitch !== 'open';
    const color = active ? '#ffc46e' : '#6f7c88';
    const stroke = active ? color : '#586d83';
    const circle = [
      { key: 'H', x: c.x, y: c.y - 28, bus: hb },
      { key: 'M', x: c.x - 20, y: c.y + 12, bus: mb },
      { key: 'L', x: c.x + 20, y: c.y + 12, bus: lb }
    ];
    const anchorFor = (bus) => {
      const dx = c.x - (bus.x + bus.width / 2);
      const dy = c.y - bus.y;
      let f;
      if (Math.abs(dy) > Math.abs(dx) * 0.7) f = dy > 0 ? 0.72 : 0.42;
      else f = dx < 0 ? 0.1 : 0.9;
      return { x: bus.x + bus.width * f, y: bus.y };
    };
    let paths = '';
    for (const item of circle) {
      const anchor = anchorFor(item.bus);
      const dx = anchor.x - item.x;
      const dy = anchor.y - item.y;
      const len = Math.hypot(dx, dy) || 1;
      const edge = { x: item.x + dx / len * 15, y: item.y + dy / len * 15 };
      const pts = routePoints(anchor, edge);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      paths += `<path class="branch-hit" d="${d}"/><path class="branch-line" d="${d}" stroke="${stroke}" stroke-width="${selected ? 4 : 3}" fill="none" ${active ? '' : 'stroke-dasharray="8 7"'}/><circle cx="${anchor.x}" cy="${anchor.y}" r="4" class="terminal-dot"/>`;
    }
    const meta = `${Number(br.sn) || 0} MVA · ${br.vnH || '—'}/${br.vnM || '—'}/${br.vnL || '—'} kV`;
    const rs = this.app.results?.branchResults?.filter((x) => x.parentId === br.id) || [];
    const showFlow = rs.length === 3 && this.ui.showFlow;
    const flow = showFlow ? rs.map((r) => `${r.winding || (String(r.tag).split('-').pop())} ${r.pFrom.toFixed(1)}`).join(' / ') : '';
    const circleColor = (item, on) => on ? (item.key === 'H' ? '#ffd28f' : item.key === 'M' ? '#ffc46e' : '#f0a85c') : '#6f7c88';
    const w = Math.max(130, (br.tag || '').length * 11, (meta.length * 6.4) + 18, flow.length * 6.2 + 18);
    const h = showFlow ? 57 : 41;
    return `<g class="branch-g ${selected ? 'is-selected' : ''}" data-kind="branch" data-id="${esc(br.id)}" opacity="${active ? 1 : .8}">
      ${paths}
      ${circle.map((x) => `<g transform="translate(${x.x} ${x.y})"><circle cx="0" cy="0" r="15" fill="#0a1726" stroke="${circleColor(x, active)}" stroke-width="2.3"/><text x="0" y="4" text-anchor="middle" font-size="10" font-weight="700" fill="${circleColor(x, active)}">${x.key}</text></g>`).join('')}
      <path d="M${circle[0].x} ${circle[0].y + 15} L${circle[1].x} ${circle[1].y - 15} M${circle[0].x} ${circle[0].y + 15} L${circle[2].x} ${circle[2].y - 15} M${circle[1].x + 15} ${circle[1].y} L${circle[2].x - 15} ${circle[2].y}" stroke="${circleColor(circle[0], active)}" stroke-width="1.2" opacity=".55" fill="none"/>
      <g transform="translate(${c.x} ${c.y - 42})" pointer-events="none">
        <rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" rx="5" fill="rgba(8,18,31,.92)" stroke="${selected ? 'rgba(110,255,229,.4)' : 'rgba(47,73,100,.85)'}"/>
        <text class="branch-tag" x="${-w / 2 + 8}" y="${-h + 16}" fill="${color}">${esc(br.tag || '')}</text>
        <text class="branch-meta" x="${-w / 2 + 8}" y="${-h + 32}">${esc(meta)}</text>
        ${showFlow ? `<text class="branch-flow" x="${-w / 2 + 8}" y="${-h + 47}" fill="#8fe4d2">${esc(flow)} MW</text>` : ''}
      </g>
      ${!active ? `<g transform="translate(${c.x} ${c.y})"><rect x="-25" y="42" width="50" height="16" rx="4" fill="rgba(16,12,20,.92)" stroke="rgba(255,125,140,.35)"/><text x="0" y="54" text-anchor="middle" class="branch-open-label">停运</text></g>` : ''}
      ${selected ? `<rect x="${c.x - 58}" y="${c.y - 96}" width="116" height="158" rx="8" fill="none" stroke="#a9fff0" stroke-width="1" stroke-dasharray="4 4" opacity=".55" pointer-events="none"/>` : ''}
    </g>`;
  }

  branchMarkup(br, port, buses, result, sel, exportMode) {
    const a = buses.get(br.from);
    const b = buses.get(br.to);
    if (!a || !b) return '';
    const p1 = { x: port.from?.x ?? a.x + a.width / 2, y: a.y };
    const p2 = { x: port.to?.x ?? b.x + b.width / 2, y: b.y };
    const pts = routePoints(p1, p2);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const selected = sel?.kind === 'branch' && sel.id === br.id;
    const color = br.type === 'transformer' ? '#ffc46e' : br.type === 'line' ? '#8bb7d8' : '#70b8ff';
    const active = br.status === 'in' && br.fromSwitch !== 'open' && br.toSwitch !== 'open' && !(isSwitchType(br.type) && br.closed === false);
    let flowColor = color;
    if (active && result && this.ui.showFlow) flowColor = result.loading > 100 ? '#ff7d8c' : result.loading > 80 ? '#ffbd66' : color;
    const stroke = !active ? '#586d83' : selected ? '#8effe7' : flowColor;
    const dash = !active ? 'stroke-dasharray="8 7"' : '';
    const mid = pointAlong(pts, 0.5);
    const labelPoint = pointAlong(pts, 0.55);
    const normal = this.normalAt(labelPoint.angle);
    const label = this.branchLabelMarkup(br, labelPoint, normal, result, active, selected, exportMode);
    let symbol = '';
    if (br.type === 'transformer') symbol = this.transformerSymbol(mid, active);
    else if (br.type === 'breaker' || br.type === 'recloser') {
      symbol = this.breakerSymbol(mid, br.closed !== false && active, selected, br.type === 'recloser' ? 'REC' : 'QF');
    } else if (br.type === 'switch' || br.type === 'disconnector' || br.type === 'loadSwitch') {
      symbol = this.switchSymbol(mid, br.closed !== false && active, selected, br.type === 'loadSwitch' ? 'QL' : 'QS');
    } else if (br.type === 'sectionalizer') {
      symbol = this.sectionalizerSymbol(mid, br.closed !== false && active, selected);
    } else if (br.type === 'fuse') {
      symbol = this.fuseSymbol(mid, br.closed !== false && active, selected);
    } else if (br.type === 'seriesReactor') {
      symbol = this.seriesReactorSymbol(mid, active);
    } else if (br.type === 'seriesCap') {
      symbol = this.seriesCapSymbol(mid, active);
    } else if (br.type === 'fcl') {
      symbol = this.fclSymbol(mid, active);
    } else {
      // line: a small distributed-parameter marker at 62 % of the route
      const mark = pointAlong(pts, 0.68);
      symbol = `<g transform="translate(${mark.x} ${mark.y}) rotate(${mark.angle * 180 / Math.PI})" opacity="${active ? .65 : .3}">
        <path d="M-7 0h3M-4 -4v8M4 -4v8M7 0h-3" stroke="${stroke}" stroke-width="1.4" fill="none"/>
      </g>`;
    }
    let openMarks = '';
    if (br.fromSwitch === 'open' && !isSwitchType(br.type)) {
      openMarks += this.openMark(pts, 0.14, '首端分闸');
    }
    if (br.toSwitch === 'open' && !isSwitchType(br.type)) {
      openMarks += this.openMark(pts, 0.86, '末端分闸');
    }
    const hit = `<path class="branch-hit" d="${d}"/>`;
    return `<g class="branch-g ${selected ? 'is-selected' : ''}" data-kind="branch" data-id="${esc(br.id)}" opacity="${active ? 1 : .8}">
      <path d="${d}" stroke="#07111e" stroke-width="${selected ? 10 : 8}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>
      <path class="branch-line" d="${d}" stroke="${stroke}" stroke-width="${selected ? 4.2 : 3.2}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${dash}/>
      <circle cx="${p1.x}" cy="${p1.y}" r="4.2" class="terminal-dot"/>
      <circle cx="${p2.x}" cy="${p2.y}" r="4.2" class="terminal-dot"/>
      ${hit}
      ${symbol}
      ${openMarks}
      ${label}
      ${!active ? `<g transform="translate(${mid.x} ${mid.y})"><rect x="-25" y="-41" width="50" height="16" rx="4" fill="rgba(16,12,20,.92)" stroke="rgba(255,125,140,.35)"/><text x="0" y="-29" text-anchor="middle" class="branch-open-label">停运</text></g>` : ''}
    </g>`;
  }

  normalAt(angle) {
    let nx = -Math.sin(angle);
    let ny = Math.cos(angle);
    if (ny > 0.2) { nx = -nx; ny = -ny; }
    if (Math.abs(ny) < 0.15) { nx = Math.cos(angle) >= 0 ? 1 : -1; ny = -0.45; }
    return { x: nx, y: ny };
  }

  branchLabelMarkup(br, point, normal, result, active, selected, exportMode) {
    const tag = esc(br.tag || '');
    let meta = '';
    if (br.type === 'line') {
      const fromBus = this.project.buses.find((b) => b.id === br.from);
      const kv = br.voltageClass || fromBus?.vn || 110;
      meta = `${br.lineKind === 'cable' ? '电缆' : ''}${br.lineKind === 'cable' ? ' · ' : ''}${kv} kV · ${br.paramMode === 'distributed' ? '分布参数' : '集中参数'} · ${Number(br.length) || 0} km`;
      if (result) meta += ` · ${result.loading.toFixed(0)}%`;
    } else if (br.type === 'transformer') {
      meta = `${Number(br.sn) || 0} MVA · Uk ${Number(br.uk) || 0}%`;
      if (result) meta += ` · ${result.loading.toFixed(0)}%`;
    } else if (isSeriesType(br.type)) {
      const x = br.type === 'seriesReactor' ? `X ${Number(br.xOhm) || 0} Ω` : br.type === 'seriesCap' ? `Xc ${Number(br.xcOhm) || 0} Ω` : `X ${Number(br.xNormalOhm) || 0}/${Number(br.xFaultOhm) || 0} Ω`;
      meta = `${x} · ${Number(br.voltageClass) || 110} kV`;
      if (result) meta += ` · ${result.loading.toFixed(0)}%`;
    } else {
      meta = `${br.closed !== false ? '合闸' : '分闸'} · ${Number(br.ratedCurrent) || 0} A`;
    }
    const compact = !!this.ui.compactLabels;
    if (compact) meta = '';
    const showFlow = result && this.ui.showFlow && !result.zeroImpedance && !compact;
    const flowText = showFlow ? `${result.pFrom >= 0 ? '→' : '←'} ${Math.abs(result.pFrom).toFixed(1)} MW · ${result.loading.toFixed(0)}%` : '';
    const tagW = Math.max(40, tag.length * 10.3);
    const metaW = meta.length * 6.7;
    const flowW = flowText.length * 6.8;
    const w = Math.max(tagW, metaW, flowW) + 16;
    const h = compact ? 25 : showFlow ? 59 : 44;
    const x = point.x + normal.x * 44;
    const y = point.y + normal.y * 44;
    const color = br.type === 'transformer' ? '#ffd28f' : isSwitchType(br.type) ? '#a9d7ff' : isSeriesType(br.type) ? '#ffb37a' : '#d8e8f6';
    const flowColor = result && result.loading > 100 ? '#ff9aa5' : result && result.loading > 80 ? '#ffd28f' : '#89e3d1';
    const above = normal.y < -0.2;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" pointer-events="none">
      <rect class="branch-label-bg" x="${-w / 2}" y="${above ? -h - 2 : 2}" width="${w}" height="${h}" rx="5" ${selected ? 'stroke="rgba(110,255,229,.35)"' : ''}/>
      <text class="branch-tag" x="${-w / 2 + 8}" y="${above ? -h + 17 : 21}" fill="${color}">${tag}</text>
      ${!compact ? `<text class="branch-meta" x="${-w / 2 + 8}" y="${above ? -h + 33 : 37}">${esc(meta)}</text>` : ''}
      ${showFlow ? `<text class="branch-flow" x="${-w / 2 + 8}" y="${above ? -h + 50 : 54}" fill="${flowColor}">${esc(flowText)}</text>` : ''}
    </g>`;
  }

  openMark(pts, ratio, label) {
    const p = pointAlong(pts, ratio);
    const deg = p.angle * 180 / Math.PI;
    return `<g transform="translate(${p.x} ${p.y}) rotate(${deg})" pointer-events="none">
      <circle cx="-11" cy="0" r="6" fill="#0a1726" stroke="#ff8c99" stroke-width="1.5"/>
      <circle cx="11" cy="0" r="6" fill="#0a1726" stroke="#ff8c99" stroke-width="1.5"/>
      <path d="M-5 0 8 -9" stroke="#ff8c99" stroke-width="2.4" stroke-linecap="round"/>
      <text x="0" y="-12" text-anchor="middle" font-size="10" fill="#ff9ba7">${esc(label)}</text>
    </g>`;
  }

  transformerSymbol(mid, active) {
    const deg = mid.angle * 180 / Math.PI;
    const col = active ? '#ffc46e' : '#6f7c88';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <circle cx="-19" cy="0" r="17" fill="#0a1726" stroke="${col}" stroke-width="2.6"/>
      <circle cx="19" cy="0" r="17" fill="#0a1726" stroke="${col}" stroke-width="2.6"/>
      <path d="M-5 0h10" stroke="${col}" stroke-width="2"/>
      <path d="M-36 0h-2M36 0h2" stroke="${col}" stroke-width="2"/>
    </g>`;
  }

  breakerSymbol(mid, closed, selected, label = 'QF') {
    const deg = mid.angle * 180 / Math.PI;
    const col = closed ? (selected ? '#b8fff2' : '#75c8ff') : '#ff8c99';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <rect x="-10" y="-10" width="20" height="20" rx="2" transform="rotate(45)" fill="#0a1726" stroke="${col}" stroke-width="2.4"/>
      ${closed ? `<path d="M-5 0h10" stroke="${col}" stroke-width="2.2"/>` : `<path d="M-7 5 7 -5" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>`}
      <path d="M-27 0h-9M27 0h9" stroke="${col}" stroke-width="2"/>
      <text x="0" y="-19" text-anchor="middle" font-size="10" fill="${col}">${closed ? esc(label) : '分闸'}</text>
    </g>`;
  }

  switchSymbol(mid, closed, selected, label = 'QS') {
    const deg = mid.angle * 180 / Math.PI;
    const col = closed ? (selected ? '#b8fff2' : '#75c8ff') : '#ff8c99';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <circle cx="-13" cy="0" r="3.2" fill="#0a1726" stroke="${col}" stroke-width="1.6"/>
      <circle cx="13" cy="0" r="3.2" fill="#0a1726" stroke="${col}" stroke-width="1.6"/>
      <path d="${closed ? 'M-11 0h22' : 'M-11 0 11 -12'}" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M-28 0h-7M28 0h7" stroke="${col}" stroke-width="1.6"/>
      <text x="0" y="-19" text-anchor="middle" font-size="10" fill="${col}">${closed ? esc(label) : '分闸'}</text>
    </g>`;
  }

  seriesReactorSymbol(mid, active) {
    const deg = mid.angle * 180 / Math.PI;
    const col = active ? '#ffb37a' : '#6f7c88';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <path d="M-34 0h10M-24 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0M24 0h10" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>
      <text x="0" y="-14" text-anchor="middle" font-size="9" fill="${col}">SR</text>
    </g>`;
  }

  seriesCapSymbol(mid, active) {
    const deg = mid.angle * 180 / Math.PI;
    const col = active ? '#ffb37a' : '#6f7c88';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <path d="M-34 0h23M11 0h23" stroke="${col}" stroke-width="2.4"/>
      <path d="M-11 -14v28M11 -14v28" stroke="${col}" stroke-width="2.8"/>
      <text x="0" y="-20" text-anchor="middle" font-size="9" fill="${col}">SC</text>
    </g>`;
  }

  fclSymbol(mid, active) {
    const deg = mid.angle * 180 / Math.PI;
    const col = active ? '#ff9a7a' : '#6f7c88';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <rect x="-22" y="-13" width="44" height="26" rx="4" fill="#0a1726" stroke="${col}" stroke-width="2.2"/>
      <path d="M-12 7 2 -7 6 0 13 -6" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round"/>
      <text x="0" y="-17" text-anchor="middle" font-size="8.5" fill="${col}">FCL</text>
      <path d="M-34 0h12M22 0h12" stroke="${col}" stroke-width="2"/>
    </g>`;
  }

  sectionalizerSymbol(mid, closed, selected) {
    const deg = mid.angle * 180 / Math.PI;
    const col = closed ? (selected ? '#b8fff2' : '#75c8ff') : '#ff8c99';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <rect x="-14" y="-9" width="28" height="18" rx="3" fill="#0a1726" stroke="${col}" stroke-width="2"/>
      <path d="${closed ? 'M-9 0h18' : 'M-8 0 8 -7'}" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M-30 0h16M14 0h16" stroke="${col}" stroke-width="1.8"/>
      <text x="0" y="-17" text-anchor="middle" font-size="8.5" fill="${col}">${closed ? 'SEC' : '分闸'}</text>
    </g>`;
  }

  fuseSymbol(mid, closed, selected) {
    const deg = mid.angle * 180 / Math.PI;
    const col = closed ? (selected ? '#b8fff2' : '#75c8ff') : '#ff8c99';
    return `<g transform="translate(${mid.x} ${mid.y}) rotate(${deg})" pointer-events="none">
      <rect x="-18" y="-8" width="36" height="16" rx="7" fill="#0a1726" stroke="${col}" stroke-width="2"/>
      <path d="M-14 0h28M0 -6v12" stroke="${col}" stroke-width="1.7"/>
      <path d="M-30 0h12M18 0h12" stroke="${col}" stroke-width="1.8"/>
      <text x="0" y="-15" text-anchor="middle" font-size="8.5" fill="${col}">${closed ? 'FU' : '熔断'}</text>
    </g>`;
  }

  busMarkup(bus, result, sel, exportMode) {
    const selected = sel?.kind === 'bus' && sel.id === bus.id;
    const color = voltageColor(bus.vn);
    const typeLabel = BUS_TYPES[bus.type] || bus.type;
    const typeShort = BUS_TYPE_SHORT[bus.type] || bus.type;
    const badgeColor = bus.type === 'slack' ? '#ffbd66' : bus.type === 'PV' ? '#5fe2c9' : '#7890a7';
    const typeW = typeShort.length * 7.4 + 12;
    const name = esc(bus.name);
    const tag = esc(bus.tag || '');
    const v = `${bus.vn} kV`;
    const voltageText = result && this.ui.showFlow ? `${result.Vm.toFixed(4)}∠${result.Va.toFixed(2)}°` : v;
    const resultColor = result ? (result.Vm < 0.95 || result.Vm > 1.05 ? '#ffbd66' : '#95d9cb') : '#7f95aa';
    const extraW = Math.max(0, voltageText.length * 8.4 + 12);
    return `<g class="bus-g ${selected ? 'is-selected' : ''}" data-kind="bus" data-id="${esc(bus.id)}">
      ${selected ? `<rect class="bus-sel-ring" x="${bus.x - 10}" y="${bus.y - 32}" width="${bus.width + 20}" height="98" rx="8"/>` : ''}
      <line x1="${bus.x - 4}" y1="${bus.y}" x2="${bus.x + bus.width + 4}" y2="${bus.y}" stroke="#040b13" stroke-width="12" stroke-linecap="round" opacity=".85"/>
      <line class="bus-bar" x1="${bus.x}" y1="${bus.y}" x2="${bus.x + bus.width}" y2="${bus.y}" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
      <line x1="${bus.x + 2}" y1="${bus.y - 6}" x2="${bus.x + 2}" y2="${bus.y + 6}" stroke="${color}" stroke-width="1.5" opacity=".55"/>
      <line x1="${bus.x + bus.width - 2}" y1="${bus.y - 6}" x2="${bus.x + bus.width - 2}" y2="${bus.y + 6}" stroke="${color}" stroke-width="1.5" opacity=".55"/>
      <rect x="${bus.x}" y="${bus.y - 30}" width="${typeW}" height="17" rx="4" fill="${badgeColor}16" stroke="${badgeColor}52" pointer-events="none"/>
      <text x="${bus.x + typeW / 2}" y="${bus.y - 18}" text-anchor="middle" class="bus-type-badge-text" fill="${badgeColor}" font-size="10.5">${typeShort}</text>
      <text x="${bus.x + 1}" y="${bus.y + 34}" class="bus-label-tag" fill="${color}" font-size="23">${tag}</text>
      <text x="${bus.x + bus.width - 1}" y="${bus.y + 34}" text-anchor="end" class="bus-label-kv" fill="${result ? resultColor : '#93a9bd'}" font-size="15.5">${voltageText}</text>
      <text x="${bus.x + 1}" y="${bus.y + 55}" class="bus-label-name" font-size="16.5">${name}</text>
      ${selected ? `<circle cx="${bus.x}" cy="${bus.y}" r="8" fill="#0a1726" stroke="#bafff2" stroke-width="1.4"/><circle cx="${bus.x + bus.width}" cy="${bus.y}" r="8" fill="#0a1726" stroke="#bafff2" stroke-width="1.4"/>` : ''}
    </g>`;
  }

  injectionMarkup(inj, bus, sel, exportMode, ports = new Map()) {
    const selected = sel?.kind === 'injection' && sel.id === inj.id;
    const x = bus.x + bus.width * clamp(Number(inj.pos) || 0.5, 0.04, 0.96);
    const y = bus.y;
    const up = inj.direction !== 'down';
    const sign = up ? -1 : 1;
    const active = inj.status !== 'out' && (inj.type !== 'generator' || inj.switchClosed !== false);
    const op = active ? 1 : 0.44;
    const color = inj.type === 'generator' ? '#ffc46e' : inj.type === 'load' ? '#ff8f9d' : '#bda4ff';
    const tagColor = inj.type === 'generator' ? '#f0d19a' : inj.type === 'load' ? '#ff9da8' : '#bfa8ff';
    const stubEnd = y + sign * 36;
    const symY = y + sign * 70;
    let symbol = '';
    if (inj.type === 'generator') {
      const letter = inj.kind === '风电' ? 'W' : inj.kind === '光伏' ? 'PV' : 'G';
      symbol = `<g class="inj-body" transform="translate(${x} ${symY})">
        <circle r="25" fill="#121f2d" stroke="${color}" stroke-width="2.5"/>
        <text x="0" y="6" text-anchor="middle" font-size="${letter.length > 1 ? 13 : 19}" font-weight="700" fill="${color}">${letter}</text>
        <path d="M-13 15q6.5-6 13 0t13 0" fill="none" stroke="${color}" stroke-width="1.6" opacity=".7"/>
      </g>`;
    } else if (inj.type === 'load') {
      symbol = `<g class="inj-body" transform="translate(${x} ${symY})">
        <path d="M0 -20v22M-7 3 0 12 7 3" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="-15" y="-21" width="30" height="6" rx="2" fill="${color}" opacity=".13"/>
      </g>`;
    } else {
      symbol = inj.kind === 'reactor'
        ? `<g class="inj-body" transform="translate(${x} ${symY})">
            <path d="M0 -22v6c0 0 9 0 9 5s-18 5-18 10 18 5 18 10c0 0 0 3-9 3v3" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          </g>`
        : `<g class="inj-body" transform="translate(${x} ${symY})">
            <path d="M0 -22v10M-15 -10h30M-15 2h30M0 2v12" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>
          </g>`;
    }
    const breaker = inj.type === 'generator' && inj.switchClosed === false
      ? `<g transform="translate(${x} ${y + sign * 27})"><rect x="-5" y="-5" width="10" height="10" rx="1" fill="#0a1726" stroke="#ff8f9d" stroke-width="1.5" transform="rotate(45)"/><path d="M-9 9 9 -9" stroke="#ff8f9d" stroke-width="1.5"/></g>`
      : '';
    const p = Number(inj.p) || 0;
    const q = Number(inj.q) || 0;
    const compact = !!this.ui.compactLabels;
    const centered = inj.labelAlign === 'center' || compact;
    const sidePorts = [];
    for (const port of ports.values()) {
      for (const end of ['from', 'to']) {
        if (port[end]?.busId === bus.id && port[end]?.category === (up ? 'up' : 'down')) sidePorts.push(port[end].x);
      }
    }
    let side = 'right';
    if (!centered) {
      const rightStart = x + 24;
      const rightEnd = x + 34 + 126;
      const crosses = sidePorts.some((px) => px > rightStart && px < rightEnd);
      if (crosses && x - 34 - 126 > bus.x - 90) side = 'left';
    }
    const textX = centered ? x : side === 'right' ? x + 34 : x - 34;
    const textY = compact ? symY + (up ? -38 : 40) : centered ? symY + (up ? -58 : 42) : symY + (up ? -5 : 0);
    const textAnchor = centered ? 'middle' : side === 'right' ? 'start' : 'end';
    const labelW = compact ? 72 : centered ? 136 : 126;
    const labelH = compact ? 22 : 54;
    const labelTop = compact ? symY + (up ? -60 : 26) : centered ? symY + (up ? -81 : 27) : textY - 22;
    const labelX = centered ? textX - labelW / 2 : side === 'right' ? textX - 5 : textX - labelW + 5;
    const result = this.app.results && inj.type === 'generator' ? this.app.results.generatorResults?.find((g) => g.id === inj.id) : null;
    const busResult = this.app.results?.busById?.[bus.id];
    const effectiveBusType = busResult?.type || bus.type;
    const live = !!this.app.results && this.ui.showFlow;
    let line1 = '';
    let line2 = '';
    if (inj.type === 'generator') {
      if (live && result) {
        line1 = `${result.p.toFixed(1)} MW`;
        line2 = `Q ${result.q == null ? '—' : (result.q >= 0 ? '+' : '') + result.q.toFixed(1)} Mvar · ${inj.kind || ''}`;
      } else if (effectiveBusType === 'slack') {
        line1 = '平衡节点电源';
        line2 = 'P/Q 由潮流计算确定';
      } else if (effectiveBusType === 'PV') {
        line1 = `${p.toFixed(p % 1 ? 1 : 0)} MW`;
        line2 = `Q 由潮流计算确定 · ${inj.kind || ''}`;
      } else {
        line1 = `${p.toFixed(p % 1 ? 1 : 0)} MW`;
        line2 = `Q ${q >= 0 ? '+' : ''}${q.toFixed(0)} Mvar · ${inj.kind || ''}`;
      }
    } else if (inj.type === 'load') {
      line1 = `${p.toFixed(p % 1 ? 1 : 0)} + j${q.toFixed(0)} MVA`;
      line2 = inj.loadType || '负荷';
    } else {
      const actualQ = live && busResult ? q * busResult.Vm * busResult.Vm : q;
      line1 = `${actualQ >= 0 ? '+' : ''}${actualQ.toFixed(1)} Mvar`;
      line2 = ({ reactor: '并联电抗器', capacitor: '并联电容器', filter: '无源滤波器', svc: '静止无功补偿器 SVC', statcom: '静止同步补偿器 STATCOM' })[inj.kind] || '并联补偿';
    }
    return `<g class="injection-g ${selected ? 'is-selected' : ''}" data-kind="injection" data-id="${esc(inj.id)}" opacity="${op}">
      <line x1="${x}" y1="${y}" x2="${x}" y2="${symY}" stroke="${color}" stroke-width="2.2" stroke-dasharray="${active ? '' : '5 5'}" opacity=".8"/>
      ${breaker}
      ${symbol}
      <rect class="inj-hit" x="${Math.min(x - 34, textX - labelW / 2)}" y="${Math.min(y, symY - 32, labelTop)}" width="${Math.max(112, labelW + 48)}" height="${Math.max(Math.abs(symY - y) + 64, labelTop + labelH + 4 - Math.min(y, symY - 32))}" rx="4"/>
      <rect x="${labelX}" y="${labelTop}" width="${labelW}" height="${labelH}" rx="4" fill="rgba(5,13,23,.84)" stroke="rgba(46,74,102,.45)" pointer-events="none"/>
      <text x="${textX}" y="${compact ? textY : textY - 6}" text-anchor="${textAnchor}" class="inj-tag ${inj.type}" font-size="${compact ? 12.5 : 16}">${esc(inj.tag || '')}</text>
      ${!compact ? `<text x="${textX}" y="${textY + 11}" text-anchor="${textAnchor}" class="inj-label" font-size="14.5">${esc(line1)}</text>
      <text x="${textX}" y="${textY + 26}" text-anchor="${textAnchor}" class="inj-meta" font-size="11.5">${esc(line2)}</text>` : ''}
      ${selected ? `<rect x="${labelX - 4}" y="${Math.min(y, symY - 35, labelTop - 3)}" width="${labelW + 8}" height="${Math.max(Math.abs(symY - y) + 70, labelTop + labelH + 3 - Math.min(y, symY - 35))}" rx="6" fill="none" stroke="#a9fff0" stroke-width="1" stroke-dasharray="4 4" opacity=".55"/>` : ''}
    </g>`;
  }

  updateStatus() {
    const p = this.project;
    const el = (id) => this.host.querySelector(id);
    if (!el('#status-buses')) return;
    el('#status-buses').textContent = p.buses.length;
    el('#status-branches').textContent = p.branches.length;
    el('#status-injections').textContent = p.injections.length;
    el('#status-relays').textContent = p.relays.filter((r) => r.enabled).length;
    const issues = this.app.issues || [];
    const errors = issues.filter((i) => i.level === 'error').length;
    const warn = issues.filter((i) => i.level === 'warning').length;
    el('#status-health').textContent = errors ? `${errors} 项错误` : warn ? `${warn} 项提示` : '网络就绪';
    el('#health-dot').className = `status-dot ${errors ? 'err' : warn ? 'warn' : ''}`;
  }

  onPointerDown(e) {
    if (e.target.closest('[data-action],.canvas-toolbar,.zoom-chip,.canvas-flow-chip')) return;
    const rect = this.stage.getBoundingClientRect();
    const world = this.screenToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;
    const busEl = e.target.closest('[data-kind="bus"]');
    const branchEl = e.target.closest('[data-kind="branch"]');
    const injEl = e.target.closest('[data-kind="injection"]');

    if (this.spaceDown || e.button === 1 || this.tool === 'pan') {
      this.pan = { startX: e.clientX, startY: e.clientY, vx: this.view.x, vy: this.view.y };
      this.stage.classList.add('is-panning');
      e.preventDefault();
      return;
    }

    if (this.tool === 'add-bus') {
      if (!busEl) {
        this.addBusAt(world);
      } else {
        this.app.select('bus', busEl.dataset.id);
      }
      return;
    }

    if (this.tool === 'add-branch') {
      if (!busEl) {
        this.app.toast('请选择母线', this.branchType === 'transformer3' ? '三绕组变压器需要依次选择三条母线。' : '线路和变压器必须连接在两条母线上。', 'warning');
        return;
      }
      const busId = busEl.dataset.id;
      if (this.branchType === 'transformer3') {
        if (!this.pendingBus) {
          this.pendingBus = busId;
          this.app.select('bus', busId);
          this.updateHint();
          this.render();
        } else if (!this.pendingSecond) {
          if (busId === this.pendingBus) {
            this.app.toast('请选择不同母线', '中压侧母线不能与高压侧相同。', 'warning');
            return;
          }
          this.pendingSecond = busId;
          this.app.select('bus', busId);
          this.updateHint();
          this.render();
        } else if (busId === this.pendingBus || busId === this.pendingSecond) {
          this.app.toast('请选择不同母线', '低压侧母线必须与前两侧不同。', 'warning');
        } else {
          this.addBranch(this.pendingBus, this.pendingSecond, busId);
        }
        return;
      }
      if (!this.pendingBus) {
        this.pendingBus = busId;
        this.app.select('bus', busId);
        this.updateHint();
        this.render();
      } else if (this.pendingBus === busId) {
        this.app.toast('不能连接同一母线', '请选择另一条母线作为终点。', 'warning');
      } else {
        this.addBranch(this.pendingBus, busId);
      }
      return;
    }

    if (this.tool === 'add-injection') {
      if (!busEl) {
        this.app.toast('请选择母线', `请单击一条母线来接入${this.injectionLabel()}。`, 'warning');
        return;
      }
      this.addInjection(busEl.dataset.id, world);
      return;
    }

    if (e.button !== 0) return;
    if (busEl) {
      const id = busEl.dataset.id;
      this.app.select('bus', id);
      const bus = this.project.buses.find((b) => b.id === id);
      if (!bus) return;
      this.drag = {
        kind: 'bus', id, startX: e.clientX, startY: e.clientY,
        wx: world.x, wy: world.y, x0: bus.x, y0: bus.y, moved: false
      };
      this.stage.style.cursor = 'grabbing';
      e.preventDefault();
    } else if (branchEl) {
      this.app.select('branch', branchEl.dataset.id);
    } else if (injEl) {
      this.app.select('injection', injEl.dataset.id);
    } else {
      this.app.select('project', null);
    }
  }

  onPointerMove(e) {
    const world = this.screenToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;
    const coord = this.host.querySelector('#cursor-coord');
    if (coord) coord.textContent = `x ${Math.round(world.x)} · y ${Math.round(world.y)}`;
    if (this.pan) {
      this.view.x = this.pan.vx + (e.clientX - this.pan.startX);
      this.view.y = this.pan.vy + (e.clientY - this.pan.startY);
      this.applyView();
      return;
    }
    if (this.drag) {
      const dx = (e.clientX - this.drag.startX) / this.view.k;
      const dy = (e.clientY - this.drag.startY) / this.view.k;
      if (!this.drag.moved && Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < 3) return;
      this.drag.moved = true;
      const bus = this.project.buses.find((b) => b.id === this.drag.id);
      if (!bus) return;
      bus.x = Math.round((this.drag.x0 + dx) / 5) * 5;
      bus.y = Math.round((this.drag.y0 + dy) / 5) * 5;
      this.render();
      this.app.scheduleSave();
    }
  }

  onPointerUp(e) {
    if (this.pan) {
      this.pan = null;
      this.stage.classList.remove('is-panning');
      this.app.scheduleSave();
      return;
    }
    if (this.drag) {
      const moved = this.drag.moved;
      const id = this.drag.id;
      this.drag = null;
      this.stage.style.cursor = '';
      if (moved) {
        this.app.commit('移动母线');
        this.app.renderInspector();
        this.app.refreshValidation();
      } else {
        this.app.select('bus', id);
      }
    }
  }

  addBusAt(world) {
    const tag = nextTag(this.project, 'bus');
    const count = this.project.buses.length + 1;
    const bus = newBus({
      name: `新建 ${count} 号母线`,
      tag,
      vn: 110,
      type: this.project.buses.some((b) => b.type === 'slack') ? 'PQ' : 'slack',
      x: Math.round((world.x - 150) / 5) * 5,
      y: Math.round(world.y / 5) * 5,
      width: 300,
      vm: 1.0
    });
    this.project.buses.push(bus);
    this.app.select('bus', bus.id);
    this.cancelTool();
    this.app.invalidateResults();
    this.app.commit('添加母线');
    this.app.refreshAll();
    this.app.toast('已添加母线', `${bus.tag} · 在右侧属性面板设置电压等级与节点类型。`);
  }

  addBranch(fromId, toId, thirdId = null) {
    const from = this.project.buses.find((b) => b.id === fromId);
    const to = this.project.buses.find((b) => b.id === toId);
    const third = thirdId ? this.project.buses.find((b) => b.id === thirdId) : null;
    if (!from || !to) return;
    if (this.branchType === 'transformer3' && !third) return;
    const requestedType = this.branchType;
    const type = requestedType === 'cable' ? 'line' : requestedType;
    const typeLabel = this.branchLabel();
    const tag = nextTag(this.project, type);
    const dist = Math.hypot((to.x + to.width / 2) - (from.x + from.width / 2), to.y - from.y);
    const opts = {
      tag,
      name: `${from.name.replace(/\s*\d+\s*kV.*$/, '') || from.tag}—${to.name.replace(/\s*\d+\s*kV.*$/, '') || to.tag} ${type === 'transformer' ? '主变' : type === 'transformer3' ? '三绕组主变' : type === 'line' ? '线路' : type === 'breaker' ? '母联断路器' : '隔离开关'}`
    };
    if (requestedType === 'cable') {
      opts.lineKind = 'cable';
      opts.length = Math.max(0.2, Number((dist / 18).toFixed(2)));
      opts.voltageClass = from.vn;
      opts.rPerKm = 0.08; opts.xPerKm = 0.12; opts.bPerKm = 78;
      opts.r0PerKm = 0.4; opts.x0PerKm = 0.4; opts.b0PerKm = 60;
      opts.conductor = 'YJV-3×240';
      opts.insulation = 'XLPE';
      opts.ampacity = 400;
      opts.ratingMVA = Math.max(40, Math.round(Math.sqrt(3) * from.vn * 400 / 1000));
      opts.name = `${from.tag}—${to.tag} 电缆`;
    } else if (type === 'line') {
      opts.length = Math.max(1, Math.round(dist / 12));
      opts.voltageClass = from.vn;
      opts.ratingMVA = Math.max(60, Math.round(from.vn * 0.9));
      opts.name = `${from.tag}—${to.tag} 线路`;
    } else if (type === 'transformer') {
      opts.vn1 = from.vn;
      opts.vn2 = to.vn;
      opts.sn = from.vn >= 220 ? 240 : 120;
      opts.ratingMVA = opts.sn;
      opts.name = `${from.tag}—${to.tag} 主变`;
    } else if (type === 'transformer3') {
      opts.third = thirdId;
      opts.vnH = from.vn;
      opts.vnM = to.vn;
      opts.vnL = third.vn;
      opts.sn = from.vn >= 220 ? 180 : 90;
      opts.ratingMVA = opts.sn;
      opts.name = `${from.tag}—${to.tag}—${third.tag} 三绕组主变`;
      opts.ukHM = 12.5;
      opts.ukHL = 18.5;
      opts.ukML = 7.5;
      opts.pk = 480;
      opts.p0 = 90;
      opts.i0 = 0.25;
      opts.tapH = 0; opts.tapM = 0; opts.tapL = 0;
      opts.zeroMode = 'block';
    } else if (isSeriesType(type)) {
      opts.voltageClass = from.vn;
      opts.ratingMVA = Math.max(60, Math.round(from.vn * 0.7));
      opts.ratedCurrent = Math.max(400, Math.round(opts.ratingMVA * 1000 / (Math.sqrt(3) * from.vn)));
      if (type === 'seriesReactor') { opts.rOhm = 0.05; opts.xOhm = 2; opts.zeroXOhm = 6; opts.name = `${from.tag}—${to.tag} 串联电抗器`; }
      else if (type === 'seriesCap') { opts.rOhm = 0.02; opts.xcOhm = 2; opts.name = `${from.tag}—${to.tag} 串联电容器`; }
      else { opts.rOhm = 0.01; opts.xNormalOhm = 0.02; opts.xFaultOhm = 2; opts.name = `${from.tag}—${to.tag} 故障电流限制器`; }
    } else {
      opts.closed = true;
      opts.ratingMVA = 0;
      const label = { breaker: '母联断路器', loadSwitch: '负荷开关', disconnector: '隔离开关', switch: '隔离开关', recloser: '重合器', sectionalizer: '分段器', fuse: '熔断器' }[type] || '开关';
      opts.name = `${from.tag}—${to.tag} ${label}`;
    }
    const br = newBranch(type, fromId, toId, opts);
    this.project.branches.push(br);
    if (type === 'line' || type === 'transformer') {
      if (!this.project.relays.some((r) => r.branchId === br.id)) this.project.relays.push(newRelay(br));
    }
    this.app.select('branch', br.id);
    this.pendingBus = null;
    this.pendingSecond = null;
    this.cancelTool();
    this.app.commit(`添加${typeLabel}`);
    this.app.invalidateResults();
    this.app.refreshAll();
    this.app.toast(`已添加${typeLabel}`, type === 'transformer3' ? `${br.tag} 已连接 ${from.tag}、${to.tag} 与 ${third.tag}。` : `${br.tag} 已连接 ${from.tag} 与 ${to.tag}。`);
  }

  addInjection(busId, world) {
    const bus = this.project.buses.find((b) => b.id === busId);
    if (!bus) return;
    const type = this.injType;
    const typeLabel = this.injectionLabel();
    const tag = nextTag(this.project, type === 'generator' ? 'generator' : type === 'load' ? 'load' : 'shunt');
    const pos = clamp((world.x - bus.x) / bus.width, 0.08, 0.92);
    const direction = world.y < bus.y ? 'up' : 'down';
    const opts = { tag, pos, direction };
    if (type === 'generator') {
      opts.name = `新建发电机 ${tag}`;
      opts.p = 50;
      opts.ratedMVA = Math.max(60, Math.round(bus.vn * 0.55));
      opts.qMin = -Math.round(opts.ratedMVA * 0.35);
      opts.qMax = Math.round(opts.ratedMVA * 0.5);
    } else if (type === 'load') {
      opts.name = '新建负荷';
      opts.p = Math.max(5, Math.round(bus.vn * 0.4));
      opts.q = Math.round(opts.p * 0.3);
      opts.direction = 'down';
    } else {
      opts.name = '新建并联补偿';
      opts.q = 10;
      opts.ratedKV = bus.vn;
    }
    const inj = newInjection(type, busId, opts);
    this.project.injections.push(inj);
    this.app.select('injection', inj.id);
    this.cancelTool();
    this.app.commit(`添加${typeLabel}`);
    this.app.invalidateResults();
    this.app.refreshAll();
    this.app.toast('设备已接入', `${inj.tag} 已连接到 ${bus.tag}。`);
  }

  duplicateSelected() {
    const sel = this.app.selection;
    if (!sel || sel.kind === 'project') return;
    if (sel.kind === 'bus') {
      const bus = this.project.buses.find((b) => b.id === sel.id);
      if (!bus) return;
      const copy = newBus({ ...bus, x: bus.x + 40, y: bus.y + 40, name: `${bus.name} 副本`, tag: nextTag(this.project, 'bus') });
      this.project.buses.push(copy);
      this.app.select('bus', copy.id);
    } else if (sel.kind === 'branch') {
      const br = this.project.branches.find((b) => b.id === sel.id);
      if (!br) return;
      const created = newBranch(br.type, br.from, br.to, { ...br, tag: nextTag(this.project, br.type), name: `${br.name} 副本` });
      created.id = `${br.id}-copy-${Date.now().toString(36)}`;
      this.project.branches.push(created);
      if (['line', 'transformer'].includes(created.type) && !this.project.relays.some((r) => r.branchId === created.id)) {
        this.project.relays.push(newRelay(created));
      }
      this.app.select('branch', created.id);
    } else {
      const inj = this.project.injections.find((x) => x.id === sel.id);
      if (!inj) return;
      const copy = newInjection(inj.type, inj.bus, { ...inj, id: undefined, tag: nextTag(this.project, inj.type), name: `${inj.name} 副本`, pos: clamp((inj.pos || 0.5) + 0.08, 0.08, 0.92) });
      copy.id = `${inj.id}-copy-${Date.now().toString(36)}`;
      this.project.injections.push(copy);
      this.app.select('injection', copy.id);
    }
    this.app.commit('复制设备');
    this.app.invalidateResults();
    this.app.refreshAll();
  }

  exportSVG(download = true) {
    if (!this.world) return '';
    const bbox = this.world.getBBox();
    const pad = 80;
    const x = bbox.x - pad;
    const y = bbox.y - pad;
    const w = Math.max(600, bbox.width + pad * 2);
    const h = Math.max(400, bbox.height + pad * 2);
    const content = this.buildWorldMarkup(true);
    const style = `
      .branch-hit{display:none}
      text{font-family:'Microsoft YaHei','PingFang SC','Segoe UI',sans-serif;user-select:none}
      .branch-line{fill:none;stroke-linecap:round;stroke-linejoin:round}
      .branch-tag{font-size:17px;font-weight:700;letter-spacing:.03em}
      .branch-meta{font-size:12.8px;fill:#7892a9}
      .branch-flow{font-size:12.5px;font-family:Consolas,monospace;font-weight:600}
      .branch-label-bg{fill:rgba(8,18,31,.9);stroke:rgba(47,73,100,.8);stroke-width:1}
      .bus-label-tag{font-size:23px;font-weight:700;letter-spacing:.03em}
      .bus-label-name{font-size:16.5px;fill:#aabdd0}
      .bus-label-kv{font-size:15px;font-family:Consolas,monospace}
      .bus-type-badge-text{font-size:10.5px;font-weight:700}
      .terminal-dot{fill:#08131f;stroke:#97b2cb;stroke-width:1.2}
      .inj-tag{font-size:15px;font-weight:700;fill:#f0d19a}
      .inj-label{font-size:14.5px;fill:#ccd9e7}
      .inj-meta{font-size:11.5px;fill:#7992aa;font-family:Consolas,monospace}
      .flow-badge-text{font-size:10.5px;font-family:Consolas,monospace}
      .branch-open-label{fill:#ff8e9b;font-size:11px;font-weight:650}
      .bus-sel-ring,.inj-hit{display:none}
    `;
    const svg = `<svg xmlns="${SVG_NS}" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#07111e"/>
      <defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#6f94ba" opacity=".18"/></pattern></defs>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#grid)"/>
      <style>${style}</style>
      <g transform="translate(0 0)">${content}</g>
    </svg>`;
    if (download) {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.project.meta?.name || '主接线图'}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.app.toast('已导出 SVG', '矢量单线图已下载，可直接插入设计说明书。');
    }
    return svg;
  }

  async exportPNG() {
    const svg = this.exportSVG(false);
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#07111e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${this.project.meta?.name || '主接线图'}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        this.app.toast('已导出 PNG', '2× 分辨率位图已下载。');
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.app.toast('导出失败', '浏览器无法渲染当前 SVG。', 'error');
    };
    img.src = url;
  }
}

export { SchematicEditor };
