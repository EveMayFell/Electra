const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function voltageProfileChart(busResults, opts = {}) {
  if (!busResults?.length) return emptyChart('暂无母线电压数据');
  const W = 760;
  const H = opts.height || 205;
  const pad = { l: 42, r: 16, t: 20, b: 38 };
  const VMIN = 0.9;
  const VMAX = 1.1;
  const x = (i) => pad.l + (W - pad.l - pad.r) * (busResults.length === 1 ? 0.5 : i / (busResults.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - VMIN) / (VMAX - VMIN));
  const grid = [0.9, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.1];
  let g = '';
  for (const v of grid) {
    const yy = y(v);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="${v === 0.95 || v === 1.05 ? 'rgba(76,224,195,.26)' : 'rgba(87,119,149,.16)'}" stroke-width="${v === 0.95 || v === 1.05 ? 1.2 : 0.8}" ${v === 0.95 || v === 1.05 ? 'stroke-dasharray="3 3"' : ''}/>`;
    g += `<text x="${pad.l - 8}" y="${yy + 3}" text-anchor="end" fill="#66809a" font-size="8.5" font-family="Consolas,monospace">${v.toFixed(3)}</text>`;
  }
  g += `<rect x="${pad.l}" y="${y(1.05)}" width="${W - pad.l - pad.r}" height="${Math.max(0, y(0.95) - y(1.05))}" fill="rgba(76,224,195,.035)" />`;
  const points = busResults.map((b, i) => ({ x: x(i), y: y(b.Vm), b }));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)} ${H - pad.b} L${points[0].x.toFixed(1)} ${H - pad.b} Z`;
  g += `<path d="${area}" fill="url(#volt-area)"/>`;
  g += `<path d="${line}" fill="none" stroke="#5fe2c9" stroke-width="2.2" stroke-linejoin="round"/>`;
  points.forEach((p, i) => {
    const bad = p.b.Vm < 0.95 || p.b.Vm > 1.05;
    const col = bad ? '#ffbd66' : '#7bf0d6';
    g += `<circle cx="${p.x}" cy="${p.y}" r="3.6" fill="#0b1a29" stroke="${col}" stroke-width="2"/>`;
    if (points.length <= 10) {
      g += `<text x="${p.x}" y="${H - 19}" text-anchor="middle" fill="#7891a8" font-size="8" font-family="Consolas,monospace">${esc(p.b.tag || `B${i + 1}`)}</text>`;
    }
  });
  const min = Math.min(...busResults.map((b) => b.Vm));
  const max = Math.max(...busResults.map((b) => b.Vm));
  g += `<text x="${W - pad.r}" y="13" text-anchor="end" fill="#697f95" font-size="8" font-family="Consolas,monospace">Vmin ${min.toFixed(4)} / Vmax ${max.toFixed(4)} pu</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:100%">
    <defs>
      <linearGradient id="volt-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ce0c3" stop-opacity=".22"/><stop offset="1" stop-color="#4ce0c3" stop-opacity="0"/></linearGradient>
    </defs>${g}</svg>`;
}

export function convergenceChart(history, opts = {}) {
  if (!history?.length) return emptyChart('暂无迭代数据');
  const W = 760;
  const H = opts.height || 205;
  const pad = { l: 42, r: 16, t: 20, b: 32 };
  const maxIter = Math.max(1, history[history.length - 1].iter);
  const vals = history.map((h) => Math.max(1e-12, h.max));
  const top = Math.max(1e-2, Math.ceil(Math.log10(Math.max(...vals))) * 1);
  const bottom = -10;
  const x = (i) => pad.l + (W - pad.l - pad.r) * (maxIter ? i / maxIter : 0.5);
  const y = (m) => pad.t + (H - pad.t - pad.b) * (1 - (Math.log10(Math.max(1e-12, m)) - bottom) / (top - bottom));
  let g = '';
  for (let e = Math.ceil(bottom); e <= Math.floor(top); e++) {
    const yy = y(10 ** e);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="rgba(87,119,149,.15)" stroke-width=".8"/>`;
    if (e % 2 === 0 || e === Math.floor(top)) g += `<text x="${pad.l - 8}" y="${yy + 3}" text-anchor="end" fill="#66809a" font-size="8" font-family="Consolas,monospace">1e${e}</text>`;
  }
  const line = history.map((h, i) => `${i ? 'L' : 'M'}${x(h.iter).toFixed(1)} ${y(h.max).toFixed(1)}`).join(' ');
  g += `<path d="${line}" fill="none" stroke="#ffbd66" stroke-width="2.1" stroke-linejoin="round"/>`;
  history.forEach((h) => {
    g += `<circle cx="${x(h.iter)}" cy="${y(h.max)}" r="2.8" fill="#0b1a29" stroke="#ffbd66" stroke-width="1.6"/>`;
  });
  g += `<text x="${pad.l}" y="${H - 10}" fill="#66809a" font-size="8" font-family="Consolas,monospace">迭代次数</text>`;
  g += `<text x="${W - pad.r}" y="${H - 10}" text-anchor="end" fill="#66809a" font-size="8" font-family="Consolas,monospace">最大不平衡量 (pu)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:100%">${g}</svg>`;
}

export function relayCurveChart(relay, opts = {}) {
  if (!relay) return emptyChart('请选择一套保护');
  const W = 420;
  const H = 220;
  const pad = { l: 42, r: 14, t: 16, b: 34 };
  const pickup = Number(relay.overcurrent?.pickup) || 100;
  const maxCurrent = Math.max(pickup * 12, Number(opts.faultCurrentA) || 0, Number(opts.maxCurrentA) || 0);
  const minCurrent = Math.max(10, pickup * 0.6);
  const x = (i) => pad.l + (W - pad.l - pad.r) * (Math.log10(Math.max(i, 1) / minCurrent) / Math.log10(maxCurrent / minCurrent));
  const y = (t) => pad.t + (H - pad.t - pad.b) * (1 - (Math.log10(Math.max(0.005, t)) - Math.log10(0.01)) / (Math.log10(20) - Math.log10(0.01)));
  let g = '';
  for (const t of [0.01, 0.03, 0.1, 0.3, 1, 3, 10]) {
    const yy = y(t);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" class="grid-line"/>`;
    g += `<text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" fill="#66809a" font-size="7" font-family="Consolas,monospace">${t < 1 ? t.toFixed(2) : t.toFixed(0)}</text>`;
  }
  const tickCount = 5;
  for (let i = 0; i < tickCount; i++) {
    const val = minCurrent * Math.pow(maxCurrent / minCurrent, i / (tickCount - 1));
    const xx = x(val);
    g += `<line x1="${xx}" x2="${xx}" y1="${pad.t}" y2="${H - pad.b}" class="grid-line"/>`;
    g += `<text x="${xx}" y="${H - 13}" text-anchor="middle" fill="#66809a" font-size="7" font-family="Consolas,monospace">${(val / 1000).toFixed(1)}</text>`;
  }
  g += `<text x="${W - pad.r}" y="${H - 1}" text-anchor="end" fill="#5e758c" font-size="7.5">电流 (kA)</text>`;
  g += `<text x="${pad.l - 30}" y="${pad.t + 5}" fill="#5e758c" font-size="7.5">t(s)</text>`;
  // inverse-time curve
  const points = [];
  for (let i = 0; i <= 80; i++) {
    const cur = minCurrent * Math.pow(maxCurrent / minCurrent, i / 80);
    let t = null;
    if (relay.overcurrent.instPickup > 0 && cur >= relay.overcurrent.instPickup) t = Math.max(0.01, relay.overcurrent.instTime || 0.05);
    else {
      const m = cur / pickup;
      if (m <= 1.02) t = null;
      else if (relay.overcurrent.curve === 'definite') t = relay.overcurrent.tms;
      else {
        const co = { standard: [0.14, 0.02], very: [13.5, 1], extreme: [80, 2], long: [120, 1] }[relay.overcurrent.curve] || [0.14, 0.02];
        t = relay.overcurrent.tms * co[0] / (Math.pow(m, co[1]) - 1);
      }
    }
    if (t != null) points.push({ x: x(cur), y: y(t) });
  }
  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    g += `<path class="relay-curve" d="${d}"/>`;
  }
  const fc = Number(opts.faultCurrentA) || 0;
  if (fc > 0) {
    const xx = x(Math.min(fc, maxCurrent));
    g += `<line class="fault-line" x1="${xx}" x2="${xx}" y1="${pad.t}" y2="${H - pad.b}"/>`;
    g += `<text class="fault-label" x="${xx - 3}" y="${pad.t + 9}" text-anchor="end">Ik ${(fc / 1000).toFixed(2)} kA</text>`;
    // trip time marker
    const m = fc / pickup;
    let t = null;
    if (relay.overcurrent.instPickup > 0 && fc >= relay.overcurrent.instPickup) t = relay.overcurrent.instTime;
    else if (m > 1.02) {
      const co = { standard: [0.14, 0.02], very: [13.5, 1], extreme: [80, 2], long: [120, 1] }[relay.overcurrent.curve] || [0.14, 0.02];
      t = relay.overcurrent.curve === 'definite' ? relay.overcurrent.tms : relay.overcurrent.tms * co[0] / (Math.pow(m, co[1]) - 1);
    }
    if (t != null) g += `<circle class="trip-marker" cx="${xx}" cy="${y(t)}" r="4"/>`;
  }
  return `<svg class="curve-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}

export function emptyChart(text = '暂无数据') {
  return `<div class="chart-empty">${esc(text)}</div>`;
}
