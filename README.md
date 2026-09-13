# pescert-bench

Ground-truth-free certification of universal machine-learning interatomic potentials:
every probe compares a model against a value the exact Born–Oppenheimer surface
satisfies by construction, so no DFT reference is needed.

### → **[jhaens.github.io/pescert-bench](https://jhaens.github.io/pescert-bench)**

56 checkpoints across 20 families, plus an analytic reference that marks the
suite's own numerical floor · 14 exact-identity probes · one sortable table.

`docs/` is the whole site: `index.json` carries every run and every per-probe score, with
one folder per checkpoint beside it. The suite that produces them is
[pescert](https://github.com/jhaens/pescert).
