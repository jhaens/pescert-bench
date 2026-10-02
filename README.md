<p align="center">
  <img src="docs/pescert.svg" width="68" alt="pescert">
</p>
<h1 align="center">pescert-bench</h1>
<p align="center"><b>Reference-free certification benchmark for universal machine-learning interatomic potentials.</b></p>

<p align="center">
  <a href="https://arxiv.org/abs/2610.00585"><img src="https://img.shields.io/badge/arXiv-2610.00585-b31b1b?logo=arxiv&logoColor=white" alt="arXiv"></a>
  <a href="https://github.com/jhaens/pescert"><img src="https://img.shields.io/badge/pescert-code-7b6ef0?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI%2BPGRlZnM%2BPGxpbmVhckdyYWRpZW50IGlkPSJwZXNjLW1hcmsiIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM1YjljZjUiLz48c3RvcCBvZmZzZXQ9Ii41NSIgc3RvcC1jb2xvcj0iIzdiNmVmMCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2EwNjFlZSIvPjwvbGluZWFyR3JhZGllbnQ%2BPC9kZWZzPjxwYXRoIGQ9Ik0xNiAyLjJsMTIgNi45djEzLjhsLTEyIDYuOS0xMi02LjlWOS4xeiIgZmlsbD0idXJsKCNwZXNjLW1hcmspIi8%2BPHBhdGggZD0iTTEwLjQgOS4yYzIuMyAwIDIuMSAxMS45IDUuMyAxMS45IDMuNCAwIDMuMS02LjggOC41LTYuOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjMuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8%2BPC9zdmc%2B" alt="pescert"></a>
  <a href="https://jhaens.github.io/pescert-bench"><img src="https://img.shields.io/badge/pescert-benchmark-5b9cf5?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI%2BPGRlZnM%2BPGxpbmVhckdyYWRpZW50IGlkPSJwZXNjLW1hcmsiIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM1YjljZjUiLz48c3RvcCBvZmZzZXQ9Ii41NSIgc3RvcC1jb2xvcj0iIzdiNmVmMCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2EwNjFlZSIvPjwvbGluZWFyR3JhZGllbnQ%2BPC9kZWZzPjxwYXRoIGQ9Ik0xNiAyLjJsMTIgNi45djEzLjhsLTEyIDYuOS0xMi02LjlWOS4xeiIgZmlsbD0idXJsKCNwZXNjLW1hcmspIi8%2BPHBhdGggZD0iTTEwLjQgOS4yYzIuMyAwIDIuMSAxMS45IDUuMyAxMS45IDMuNCAwIDMuMS02LjggOC41LTYuOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjMuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8%2BPC9zdmc%2B" alt="pescert benchmark"></a>
</p>

Every model is scored with [pescert](https://github.com/jhaens/pescert): 14 probes, each
checking an identity the exact Born–Oppenheimer surface satisfies, so no DFT reference is
needed.

`docs/` is the site. `index.json` holds every run and per-probe score, with one folder per
checkpoint.