# ELECTRA Power System Studio — v1.0.0

**Release date:** 2026-10-19  
**License:** MIT  
**Runtime:** modern Chrome / Edge / Firefox; Python 3 or any static HTTP server for local hosting.

ELECTRA is a zero-backend, browser-based power engineering workstation. The entire
application is vanilla JavaScript ES modules and SVG; there is no build step and no
runtime dependency.

## Highlights

- **51 protection functions** — 18 line, 20 transformer and 13 bus functions,
  including distance, pilot differential, directional/zero-sequence, transformer
  differential and harmonics, bus differential, breaker failure, dead-zone, arc,
  PT/CT supervision, under-frequency load shedding, backup transfer and interlock.
- **Bus protection objects** with CT/PT, bus voltage, short-circuit current and
  function-level configuration/assessment.
- **Cable and overhead line** models; series reactor, series capacitor and FCL.
- **Auto-reclosing sequence** for transient and permanent line faults.
- **Voltage balance** and **frequency balance** regulation pages with AGC.
- Power flow, Ybus/Jacobian, short circuit, N-1, stability, optimization,
  scenarios, Excel/CIM/BPA exchange and A4 report.

## Quick start

```bash
cd ELECTRA-Power-Studio-v1.0.0
python -m http.server 5188 --bind 127.0.0.1
# open http://127.0.0.1:5188/
```

Or run `start.bat` on Windows, `./start.sh` on Linux/macOS.

## Verification

```bash
node --test tests/engine.test.mjs
# 25 tests, 25 pass
```

The release was smoke-tested in a headless Chromium browser: default regional
network loads, all seven views render, no console errors, and protection/regulation
calculations run.

## Package contents

- `index.html`, `styles.css`, `js/` — application source
- `tests/engine.test.mjs` — engine regression suite
- `screenshots/` — UI reference screenshots
- `README.md`, `CHANGELOG.md`, `LICENSE`, `VERSION`
- `start.bat`, `start.sh`
- `.github/workflows/pages.yml` — optional GitHub Pages deployment
- `release/` — this release artifact and checksums

## Known limitations

- Protection is a scheme-level settings/assessment framework, not vendor relay
  firmware or full EMT protection algorithms.
- Frequency response uses an aggregate centre-of-inertia model and does not model
  boiler/reheat, ramp limits, governor dead-band or UFLS stages.
- Reclosing is a protection/breaker sequence evaluator, not an electromagnetic
  transient or synchronism-check simulation.
- Voltage balance is a steady-state heuristic, not a global optimum.

## SHA-256

See `SHA256SUMS.txt` in this folder.
