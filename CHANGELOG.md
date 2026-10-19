# Changelog

All notable changes to ELECTRA Power System Studio are documented here.
The format follows Keep a Changelog; versions use Semantic Versioning.

## [1.0.0] — 2026-10-19

### Added

- Browser-based SVG single-line editor with buses, lines, cables, two-winding and
  three-winding transformers, generators, loads, shunts and switchgear.
- Per-unit power flow: Newton–Raphson polar, fast-decoupled XB/BX, Gauss–Seidel,
  DC power flow, PV→PQ reactive-limit conversion and island detection.
- Ybus in complex / G / B / |Y| / ∠Y forms; Jacobian H/N/M/L blocks; B′/B″ and
  DC B matrices; TSV/CSV export.
- Distributed long-line equivalent π model, cable model with insulation and
  ampacity data, transformer tap and magnetizing branch.
- Three-winding transformer star equivalent with H/M/L winding results.
- Zero-sequence network and three-phase / two-phase / single-line-to-ground
  short-circuit calculation, motor contribution, withstand checks and bus scan.
- 51 mainstream protection functions across line (18), transformer (20) and bus
  (13) categories; core distance / differential / overcurrent cards and a unified
  function library with enable/disable, settings and scheme-level checks.
- Automatic protection setting, time grading, sensitivity/distance scan and
  auto-reclosing sequence for transient and permanent faults.
- Series reactor, series capacitor and fault-current limiter with normal/fault
  impedance behaviour; SVC, STATCOM, filter, capacitor and reactor shunts.
- Extended switchgear: breaker, load switch, disconnector, recloser,
  sectionalizer and fuse.
- N-1 static-security scan, heuristic loss/cost optimization, scenarios,
  classical transient stability with CCT bisection.
- Voltage-balance regulation and centre-of-inertia frequency response with
  droop, load damping, AGC and reserve allocation.
- Excel SpreadsheetML, CSV, CIM/RDF and PSD-BPA style exchange; A4 engineering
  report with print/PDF.
- Three example networks: 7-bus regional, 10-bus industrial and 25-bus large grid.
- GitHub Pages workflow, release packaging and 25 engine tests.

### Known limitations

- Protection functions are scheme-level settings/checks, not vendor-specific
  relay firmware or full electromagnetic-transient algorithms.
- Frequency response is an aggregate centre-of-inertia model; it does not include
  boiler/reheat, ramp limits, dead-band or under-frequency load-shedding stages.
- Voltage balance is a steady-state heuristic, not a global optimum or
  three-phase unbalance calculation.
- Reclosing is a protection/breaker sequence evaluator, not an EMT or
  synchronism-check simulation.
