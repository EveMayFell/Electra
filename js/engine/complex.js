// Minimal complex-number helpers used by the power-flow engine.
// Complex values are plain objects: { re, im }.

export const C = (re = 0, im = 0) => ({ re, im });
export const ZERO = C(0, 0);
export const ONE = C(1, 0);
export const I = C(0, 1);

export const add = (a, b) => C(a.re + b.re, a.im + b.im);
export const sub = (a, b) => C(a.re - b.re, a.im - b.im);
export const neg = (a) => C(-a.re, -a.im);
export const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a, s) => C(a.re * s, a.im * s);
export const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  if (d < 1e-30) throw new Error('复数除零');
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const conj = (a) => C(a.re, -a.im);
export const abs = (a) => Math.hypot(a.re, a.im);
export const abs2 = (a) => a.re * a.re + a.im * a.im;
export const arg = (a) => Math.atan2(a.im, a.re);
export const fromPolar = (r, theta) => C(r * Math.cos(theta), r * Math.sin(theta));
export const inv = (a) => div(ONE, a);

export const exp = (a) => {
  const e = Math.exp(a.re);
  return C(e * Math.cos(a.im), e * Math.sin(a.im));
};
export const sinh = (a) => {
  const ep = exp(a);
  const en = exp(neg(a));
  return scale(sub(ep, en), 0.5);
};
export const cosh = (a) => {
  const ep = exp(a);
  const en = exp(neg(a));
  return scale(add(ep, en), 0.5);
};
export const tanh = (a) => div(sinh(a), cosh(a));
export const sqrt = (a) => {
  const r = abs(a);
  if (r === 0) return ZERO;
  const re = Math.sqrt(Math.max((r + a.re) / 2, 0));
  let im = Math.sqrt(Math.max((r - a.re) / 2, 0));
  if (a.im < 0) im = -im;
  return C(re, im);
};

export const fmt = (a, digits = 5) => {
  if (!a) return '0';
  const re = Math.abs(a.re) < 5e-10 ? 0 : a.re;
  const im = Math.abs(a.im) < 5e-10 ? 0 : a.im;
  const n = (x) => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
  if (im === 0) return n(re);
  if (re === 0) return `${n(im)}j`;
  return `${n(re)} ${im >= 0 ? '+' : '−'} ${n(Math.abs(im))}j`;
};

export const matrixToComplex = (rows) => rows.map((row) => row.map((v) => (typeof v === 'object' ? v : C(v, 0))));
