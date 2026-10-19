// Dense linear algebra with partial pivoting. Matrices are row-major arrays.

const EPS = 1e-14;

export function solveReal(Ain, bin) {
  const n = bin.length;
  if (!n) return [];
  const A = Ain.map((row) => row.slice());
  const x = bin.slice();
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > best) { best = v; pivot = r; }
    }
    if (best < EPS) throw new Error(`矩阵奇异（第 ${col + 1} 列主元接近 0），请检查孤岛、零阻抗支路或平衡节点设置`);
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [x[col], x[pivot]] = [x[pivot], x[col]];
    }
    const piv = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / piv;
      if (f === 0) continue;
      A[r][col] = 0;
      for (let c = col + 1; c < n; c++) A[r][c] -= f * A[col][c];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
    if (!Number.isFinite(x[r])) throw new Error('线性方程求解失败：出现非有限值');
  }
  return x;
}

export function solveComplex(Ain, bin) {
  const n = bin.length;
  if (!n) return [];
  const A = Ain.map((row) => row.map((v) => ({ re: v.re, im: v.im })));
  const b = bin.map((v) => ({ re: v.re, im: v.im }));
  const abs = (v) => Math.hypot(v.re, v.im);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = abs(A[r][col]);
      if (v > best) { best = v; pivot = r; }
    }
    if (best < EPS) throw new Error(`导纳矩阵奇异（第 ${col + 1} 列主元接近 0），请检查网络连通性`);
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    const pr = A[col][col].re;
    const pi = A[col][col].im;
    const den = pr * pr + pi * pi;
    for (let r = col + 1; r < n; r++) {
      const ar = A[r][col].re;
      const ai = A[r][col].im;
      const fr = (ar * pr + ai * pi) / den;
      const fi = (ai * pr - ar * pi) / den;
      if (Math.abs(fr) + Math.abs(fi) < 1e-30) continue;
      A[r][col] = { re: 0, im: 0 };
      for (let c = col + 1; c < n; c++) {
        const vr = A[col][c].re;
        const vi = A[col][c].im;
        A[r][c].re -= fr * vr - fi * vi;
        A[r][c].im -= fr * vi + fi * vr;
      }
      const br = b[col].re;
      const bi = b[col].im;
      b[r].re -= fr * br - fi * bi;
      b[r].im -= fr * bi + fi * br;
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sr = b[r].re;
    let si = b[r].im;
    for (let c = r + 1; c < n; c++) {
      const ar = A[r][c].re;
      const ai = A[r][c].im;
      sr -= ar * x[c].re - ai * x[c].im;
      si -= ar * x[c].im + ai * x[c].re;
    }
    const pr = A[r][r].re;
    const pi = A[r][r].im;
    const den = pr * pr + pi * pi;
    x[r] = { re: (sr * pr + si * pi) / den, im: (si * pr - sr * pi) / den };
    if (!Number.isFinite(x[r].re) || !Number.isFinite(x[r].im)) throw new Error('复数方程求解失败：出现非有限值');
  }
  return x;
}

export function inverseComplex(A) {
  const n = A.length;
  const cols = [];
  for (let k = 0; k < n; k++) {
    const e = Array.from({ length: n }, (_, r) => ({ re: r === k ? 1 : 0, im: 0 }));
    cols.push(solveComplex(A, e));
  }
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => cols[c][r]));
}

export function matVec(A, x) {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

export function zeros(n, m = n) {
  return Array.from({ length: n }, () => new Array(m).fill(0));
}
