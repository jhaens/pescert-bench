<p align="center">
  <img src="docs/pescert.svg" width="68" alt="pescert">
</p>
<h1 align="center">pescert-bench</h1>
<p align="center"><b>Reference-free certification benchmark for universal machine-learning interatomic potentials.</b></p>

<p align="center">
  <a href="https://arxiv.org/abs/2609.XXXXX"><img src="https://img.shields.io/badge/arXiv-2609.XXXXX-b31b1b?logo=arxiv&logoColor=white" alt="arXiv"></a>
</p>

**⇨ [jhaens.github.io/pescert-bench](https://jhaens.github.io/pescert-bench)**

Every model is scored with [pescert](https://github.com/jhaens/pescert): 14 probes, each
checking an identity the exact Born–Oppenheimer surface satisfies, so no DFT reference is
needed.

`docs/` is the site. `index.json` holds every run and per-probe score, with one folder per
checkpoint.
