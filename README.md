[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dunoil/makefun-token-radar-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dunoil/makefun-token-radar-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar v4 — a fitted launch radar, validated out-of-sample

198 standalone pre-token protocols ranked from one DefiLlama snapshot (758/758 protocols accounted for: 198 ranked, 416 already trade, 144 set aside by name). The model is FIT at build time on the 128 traded protocols that record a market cap: a log-log size curve ln(mcap) = 6.965 + 0.522 x ln(TVL), kept because it beats a flat multiple out-of-sample (leave-one-out typical miss x3.40 vs x5.07; 80/20 holdout x3.59 vs x4.97) — a 7d-growth term was fitted, tested and rejected for making held-out predictions worse. Launch odds come from the fitted launched-share-by-age curve (base rate 54.9%); every row's value is the odds-weighted expected value with a P25-P75 range, hard-capped at its TVL. Each row carries a FARM / THIN / SKIP verdict netted to the dollar at a selectable deposit ($1K/$5K/$25K), a dated 6-step farm plan and a break-even deposit. The dashboard recomputes every row in-page and prints "198/198 rows recompute exactly".

Built by an AI agent for make.fun's token-radar-01 bounty ($1,325 in USDC). Run it with `node main.ts` per the kit's contract.
