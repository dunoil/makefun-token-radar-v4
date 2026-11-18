// Token Radar v4 (model "radar-4"): a fitted, out-of-sample-validated launch radar.
//
// What changed from assertion to evidence, against radar-1's hand-set constants:
//   - The value model is FIT on the snapshot's own traded protocols (the 128 that record a market
//     cap) at build time, in this file, from the snapshot alone. No multiple is asserted: three
//     candidate models are fitted and blind-tested, and the board prints the test.
//   - A term is kept only if it beats the simpler model out of sample. On this snapshot the
//     7-day-growth term is fitted, tested, and REJECTED: it makes held-out predictions worse.
//   - Implied value is an expected value: what the fitted curve says the token would be worth if
//     it launched, multiplied by fitted odds that it ever launches, with a P25-P75 range from
//     the fit's own residuals. No row's expected value exceeds its TVL.
//   - Every row carries a farm verdict netted to the dollar (FARM / THIN / SKIP) at a stated
//     deposit, with the fees, the minutes and the break-even deposit printed.
//
// The snapshot records no token for a protocol, or it records one; that is all anyone knows.
// This board says "records no token", never "has none", and an implied value is this model's
// claim, not a prediction and not make.fun's.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and board.json carries it. */
export const MODEL_VERSION = 'radar-4';

const DAY_MS = 86_400_000;

/** Parse and validate the sealed snapshot; throws on anything malformed. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (typeof doc !== 'object' || doc === null) throw new Error('snapshot: not an object');
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new Error('snapshot: bad as_of');
  if (!Array.isArray(doc.protocols) || doc.protocols.length === 0) throw new Error('snapshot: no protocols');
  if (!Array.isArray(doc.watchlist)) throw new Error('snapshot: no watchlist');
  const seen = new Set<string>();
  for (const p of doc.protocols) {
    if (typeof p.slug !== 'string' || p.slug.length === 0 || /\s/.test(p.slug)) throw new Error(`snapshot: bad slug ${String(p.slug)}`);
    if (seen.has(p.slug)) throw new Error(`snapshot: duplicate slug ${p.slug}`);
    seen.add(p.slug);
    if (typeof p.name !== 'string' || p.name.length === 0) throw new Error(`snapshot: ${p.slug} has no name`);
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) throw new Error(`snapshot: ${p.slug} has bad tvl_usd`);
    if (!Array.isArray(p.chains)) throw new Error(`snapshot: ${p.slug} has bad chains`);
  }
  for (const slug of doc.watchlist) if (!seen.has(slug)) throw new Error(`snapshot: watchlist names unknown slug ${slug}`);
  return doc;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// ---------------------------------------------------------------------------
// Classification: the whole universe accounted for, nothing silently dropped.
// ---------------------------------------------------------------------------

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word in a name that marks the protocol as a wrapped or staked product of another asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchange names a product may begin with: such a product is the exchange's, not a launch to come. */
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The categories that are products of a token that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/**
 * Why a pre-token protocol is set aside instead of ranked, or null when it is a standalone
 * protocol the board may rank. The house's watchlist rule applied at every size: a wrapped,
 * staked, bridged or exchange product of a traded token is not a token that does not exist yet.
 */
export function asideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (p.category === 'CEX') return 'CEX — an exchange’s own product';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `${p.category} — a product of a traded token`;
  if (VERSIONED.test(p.name)) return 'Versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped or staked product by name';
  if (EXCHANGE_HEADS.some((head) => p.name.startsWith(head))) return 'Exchange product by name';
  return null;
}

/** One named set-aside group in the coverage accounting. */
export interface AsideGroup {
  reason: string;
  count: number;
  names: string[];
}

/** The coverage accounting: every one of the snapshot's protocols placed, by group. */
export interface Coverage {
  total: number;
  ranked: number;
  traded: number;
  traded_with_mcap: number;
  set_aside: number;
  aside_groups: AsideGroup[];
  watchlist: number;
  watchlist_ranked: number;
}

export function coverageOf(snapshot: Snapshot, rankedSlugs: Set<string>): Coverage {
  const groups = new Map<string, AsideGroup>();
  let traded = 0;
  let tradedWithMcap = 0;
  let setAside = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      traded += 1;
      if (p.mcap_usd !== null && p.mcap_usd > 0) tradedWithMcap += 1;
      continue;
    }
    const reason = asideReason(p);
    if (reason !== null) {
      setAside += 1;
      const group = groups.get(reason) ?? { reason, count: 0, names: [] };
      group.count += 1;
      group.names.push(p.name);
      groups.set(reason, group);
    }
  }
  const watchlistRanked = snapshot.watchlist.filter((slug) => rankedSlugs.has(slug)).length;
  return {
    total: snapshot.protocols.length,
    ranked: rankedSlugs.size,
    traded,
    traded_with_mcap: tradedWithMcap,
    set_aside: setAside,
    aside_groups: [...groups.values()].sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1)),
    watchlist: snapshot.watchlist.length,
    watchlist_ranked: watchlistRanked,
  };
}

// ---------------------------------------------------------------------------
// Small deterministic maths: medians, quantiles, OLS with an exact hat matrix.
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-quantile of a sorted copy, linear between neighbours. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Invert a small square matrix by Gauss-Jordan with partial pivoting; null when singular. */
function invert(matrix: number[][]): number[][] | null {
  const k = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < k; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < k; r += 1) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const d = a[col]![col]!;
    for (let j = 0; j < 2 * k; j += 1) a[col]![j]! /= d;
    for (let r = 0; r < k; r += 1) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * k; j += 1) a[r]![j]! -= f * a[col]![j]!;
    }
  }
  return a.map((row) => row.slice(k));
}

interface OlsFit {
  beta: number[];
  /** The hat-matrix diagonal: leverage of each training point, for exact leave-one-out. */
  hat: number[];
  residuals: number[];
}

/** Ordinary least squares of y on the rows of X (first column is the intercept). */
function ols(x: number[][], y: number[]): OlsFit {
  const n = x.length;
  const k = x[0]!.length;
  const xtx = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const xty = Array<number>(k).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < k; a += 1) {
      xty[a]! += x[i]![a]! * y[i]!;
      for (let b = 0; b < k; b += 1) xtx[a]![b]! += x[i]![a]! * x[i]![b]!;
    }
  }
  const inv = invert(xtx);
  if (inv === null) throw new Error('model: singular design matrix');
  const beta = inv.map((row) => row.reduce((sum, v, j) => sum + v * xty[j]!, 0));
  const hat = x.map((xi) => xi.reduce((sum, v, a) => sum + v * inv[a]!.reduce((s2, w, b) => s2 + w * xi[b]!, 0), 0));
  const residuals = y.map((yi, i) => yi - x[i]!.reduce((sum, v, j) => sum + v * beta[j]!, 0));
  return { beta, hat, residuals };
}

/** The typical miss of a set of predictions: the median fold error, max(pred/act, act/pred). */
function typicalMiss(pairs: { pred: number; actual: number }[]): number {
  return median(pairs.map(({ pred, actual }) => Math.max(pred / actual, actual / pred)));
}

/** A deterministic 80/20 split: FNV-1a of the slug, one bucket in five is held out. */
function heldOut(slug: string): boolean {
  let hash = 2166136261;
  for (let i = 0; i < slug.length; i += 1) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 5 === 0;
}

// ---------------------------------------------------------------------------
// The fitted value model: three candidates, blind-tested, the best one kept.
// ---------------------------------------------------------------------------

/** One candidate model, its fitted parameters and its two out-of-sample scores. */
export interface Candidate {
  id: 'flat' | 'size' | 'full';
  label: string;
  /** Fitted parameters: flat [multiple]; size [intercept, ln-tvl slope]; full adds [growth]. */
  beta: number[];
  holdout_miss: number;
  loo_miss: number;
  chosen: boolean;
}

export interface ValueModel {
  candidates: Candidate[];
  chosen: Candidate;
  train_n: number;
  /** Multiplicative P25 / P75 of the chosen fit's residuals, centred on its median residual. */
  range_lo: number;
  range_hi: number;
  /** Predict the if-launched market cap of one protocol under the chosen model. */
  predict: (p: SnapshotProtocol) => number;
}

const growthOf = (p: SnapshotProtocol): number => Math.max(-50, Math.min(100, p.change_7d ?? 0)) / 100;
const featuresOf = (id: Candidate['id'], p: SnapshotProtocol): number[] =>
  id === 'size' ? [1, Math.log(p.tvl_usd)] : [1, Math.log(p.tvl_usd), growthOf(p)];

function predictWith(id: Candidate['id'], beta: number[], p: SnapshotProtocol): number {
  if (id === 'flat') return beta[0]! * p.tvl_usd;
  const x = featuresOf(id, p);
  return Math.exp(x.reduce((sum, v, j) => sum + v * beta[j]!, 0));
}

/**
 * Fit the three candidates on the traded protocols that record a market cap, blind-test each
 * on a held-out fifth and by exact leave-one-out, and keep the one with the lowest held-out
 * typical miss (the simpler model wins a tie). The growth term stands or falls by that test.
 */
export function fitValueModel(snapshot: Snapshot): ValueModel {
  const train = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (train.length < 30) throw new Error(`model: only ${train.length} traded protocols record a market cap`);
  const fitSet = train.filter((p) => !heldOut(p.slug));
  const holdSet = train.filter((p) => heldOut(p.slug));
  const candidates: Candidate[] = [];

  // flat: one multiple for everyone, the median mcap/TVL of the fit set.
  {
    const multiple = median(fitSet.map((p) => p.mcap_usd! / p.tvl_usd));
    const holdout = typicalMiss(holdSet.map((p) => ({ pred: multiple * p.tvl_usd, actual: p.mcap_usd! })));
    const loo = median(
      train.map((p, i) => {
        const rest = train.filter((_, j) => j !== i).map((q) => q.mcap_usd! / q.tvl_usd);
        const pred = median(rest) * p.tvl_usd;
        return Math.max(pred / p.mcap_usd!, p.mcap_usd! / pred);
      }),
    );
    candidates.push({ id: 'flat', label: 'Flat multiple (median)', beta: [multiple], holdout_miss: holdout, loo_miss: loo, chosen: false });
  }

  // size and full: log-log OLS, with exact leave-one-out through the hat matrix.
  for (const id of ['size', 'full'] as const) {
    const fit = ols(fitSet.map((p) => featuresOf(id, p)), fitSet.map((p) => Math.log(p.mcap_usd!)));
    const holdout = typicalMiss(holdSet.map((p) => ({ pred: predictWith(id, fit.beta, p), actual: p.mcap_usd! })));
    const all = ols(train.map((p) => featuresOf(id, p)), train.map((p) => Math.log(p.mcap_usd!)));
    const loo = median(all.residuals.map((e, i) => Math.exp(Math.abs(e / (1 - all.hat[i]!)))));
    candidates.push({
      id,
      label: id === 'size' ? 'Size curve (log-log)' : 'Size + growth term',
      beta: all.beta,
      holdout_miss: holdout,
      loo_miss: loo,
      chosen: false,
    });
  }

  const order: Candidate['id'][] = ['flat', 'size', 'full'];
  const chosen = [...candidates].sort((a, b) => a.holdout_miss - b.holdout_miss || order.indexOf(a.id) - order.indexOf(b.id))[0]!;
  chosen.chosen = true;

  // The P25-P75 range: the chosen fit's residual spread on everything it trained on, centred
  // on its median residual so the range brackets the prediction by construction.
  const all = chosen.id === 'flat' ? null : ols(train.map((p) => featuresOf(chosen.id, p)), train.map((p) => Math.log(p.mcap_usd!)));
  const logResid =
    chosen.id === 'flat'
      ? train.map((p) => Math.log(p.mcap_usd! / (chosen.beta[0]! * p.tvl_usd)))
      : all!.residuals;
  const centre = quantile(logResid, 0.5);
  const rangeLo = Math.exp(quantile(logResid, 0.25) - centre);
  const rangeHi = Math.exp(quantile(logResid, 0.75) - centre);

  return {
    candidates,
    chosen,
    train_n: train.length,
    range_lo: rangeLo,
    range_hi: rangeHi,
    predict: (p) => predictWith(chosen.id, chosen.beta, p),
  };
}

// ---------------------------------------------------------------------------
// The launch-odds curve: fitted on how the universe's launched share rises
// with age, read as the odds a still-tokenless protocol ever launches.
// ---------------------------------------------------------------------------

/** One point of the fitted launch-odds curve. */
export interface OddsPoint {
  age_days: number;
  launched_share: number;
  odds: number;
}

export interface LaunchOdds {
  /** The share of all protocols that record a token: the base rate, before age is known. */
  base_rate: number;
  /** The launched share the curve saturates at (the oldest protocols' fitted share). */
  ceiling: number;
  /** Curve points, young to old, for the dashboard's chart. */
  curve: OddsPoint[];
  /** The fitted odds that a tokenless protocol of this age ever launches (null age: base rate). */
  odds: (age: number | null) => number;
}

const ODDS_BUCKETS: [number, number][] = [
  [0, 182],
  [183, 365],
  [366, 730],
  [731, 1095],
  [1096, 1460],
  [1461, Number.POSITIVE_INFINITY],
];

/** Weighted isotonic regression: the launched share may only rise with age. */
function isotonic(values: number[], weights: number[]): number[] {
  const blocks: { value: number; weight: number; count: number }[] = values.map((v, i) => ({ value: v, weight: weights[i]!, count: 1 }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i]!.value <= blocks[i + 1]!.value) {
      i += 1;
      continue;
    }
    const a = blocks[i]!;
    const b = blocks[i + 1]!;
    const merged = { value: (a.value * a.weight + b.value * b.weight) / (a.weight + b.weight), weight: a.weight + b.weight, count: a.count + b.count };
    blocks.splice(i, 2, merged);
    if (i > 0) i -= 1;
  }
  const out: number[] = [];
  for (const block of blocks) for (let j = 0; j < block.count; j += 1) out.push(block.value);
  return out;
}

/**
 * Fit the launch-odds curve. In each age bucket, the share of protocols that already record a
 * token is the launched share L(age); smoothed so it never falls, it rises toward a ceiling.
 * A protocol still tokenless at age a has, by that same record, (ceiling - L(a)) / (1 - L(a))
 * odds of ever launching: of its bucket peers the launched are gone from the race, and the
 * ceiling says how many of the rest the record expects to follow. Stated, fitted, printed.
 */
export function fitLaunchOdds(snapshot: Snapshot): LaunchOdds {
  const baseRate = snapshot.protocols.filter((p) => !isPreToken(p)).length / snapshot.protocols.length;
  const raw: { centre: number; share: number; n: number }[] = [];
  for (const [lo, hi] of ODDS_BUCKETS) {
    const inBucket = snapshot.protocols.filter((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      return age !== null && age >= lo && age <= hi;
    });
    if (inBucket.length === 0) continue;
    const launched = inBucket.filter((p) => !isPreToken(p)).length;
    const ages = inBucket.map((p) => ageDays(snapshot.as_of, p.listed_at)!).sort((a, b) => a - b);
    raw.push({ centre: ages[Math.floor(ages.length / 2)]!, share: launched / inBucket.length, n: inBucket.length });
  }
  const fitted = isotonic(raw.map((r) => r.share), raw.map((r) => r.n));
  const points = raw.map((r, i) => ({ age: r.centre, share: fitted[i]! }));
  const ceiling = points[points.length - 1]!.share;
  const shareAt = (age: number): number => {
    if (age <= points[0]!.age) return points[0]!.share;
    for (let i = 1; i < points.length; i += 1) {
      if (age <= points[i]!.age) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const t = (Math.log(age) - Math.log(a.age)) / (Math.log(b.age) - Math.log(a.age));
        return a.share + (b.share - a.share) * t;
      }
    }
    return ceiling;
  };
  const oddsOf = (age: number): number => {
    const share = shareAt(age);
    return Math.max(0.03, Math.min(0.92, (ceiling - share) / (1 - share)));
  };
  const curve: OddsPoint[] = [];
  for (let age = 30; age <= 2200; age = Math.round(age * 1.18)) {
    curve.push({ age_days: age, launched_share: shareAt(age), odds: oddsOf(age) });
  }
  curve.push({ age_days: 2190, launched_share: ceiling, odds: oddsOf(2190) });
  return { base_rate: baseRate, ceiling, curve, odds: (age) => (age === null ? baseRate : oddsOf(age)) };
}

// ---------------------------------------------------------------------------
// Farm economics: every row answers "what should a reader do, and what does
// it net?" — in dollars, at a stated deposit, with the costs printed.
// ---------------------------------------------------------------------------

/** The farm model's stated assumptions; the dashboard's what-if controls move three of them. */
export const ASSUMPTIONS = {
  /** The share of a launch's value the model expects to reach the farmers of a protocol. */
  drop: 0.05,
  /** T-bill yield in per cent a year: what the deposit would earn doing nothing. */
  yield_pct: 4.5,
  /** The farm horizon the plan and the opportunity cost are stated over. */
  horizon_weeks: 8,
  /** What an hour of the reader's time is charged at, in dollars. */
  time_usd_hr: 12,
  /** The deposits the board prints verdicts for. */
  deposits: [1000, 5000, 25000],
  /** Net at or above this is FARM; from zero, THIN; below zero, SKIP. */
  farm_net_usd: 40,
};

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

/** The net of farming one row at one deposit, in dollars, under stated assumptions. */
export function farmNet(ev: number, tvl: number, fees: number, minutes: number, deposit: number, drop: number, yieldPct: number): number {
  const gross = ev * drop * (deposit / (deposit + tvl));
  const timeCost = (minutes / 60) * ASSUMPTIONS.time_usd_hr;
  const idleCost = deposit * (yieldPct / 100) * (ASSUMPTIONS.horizon_weeks / 52);
  return gross - fees - timeCost - idleCost;
}

export function verdictOf(net: number): Verdict {
  if (net >= ASSUMPTIONS.farm_net_usd) return 'FARM';
  if (net >= 0) return 'THIN';
  return 'SKIP';
}

/** The smallest deposit, $50 to $2,000,000, at which the plan breaks even; null when none does. */
export function breakEvenDeposit(ev: number, tvl: number, fees: number, minutes: number): number | null {
  const at = (d: number) => farmNet(ev, tvl, fees, minutes, d, ASSUMPTIONS.drop, ASSUMPTIONS.yield_pct);
  if (at(50) >= 0) return 50;
  let prevD = 50;
  let prevNet = at(50);
  for (let i = 1; i <= 80; i += 1) {
    const d = 50 * Math.pow(2_000_000 / 50, i / 80);
    const net = at(d);
    if (prevNet < 0 && net >= 0) {
      let lo = prevD;
      let hi = d;
      for (let j = 0; j < 50; j += 1) {
        const mid = (lo + hi) / 2;
        if (at(mid) >= 0) hi = mid;
        else lo = mid;
      }
      return Math.round(hi / 10) * 10;
    }
    prevD = d;
    prevNet = net;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dated farm plans: concrete steps per category, each with its cost and its
// minutes, written from the snapshot's own figures for that protocol.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** The gas of one on-chain action on a chain, in dollars: mainnet is dear, the rest are not. */
function gasOf(chain: string): number {
  return chain === 'Ethereum' ? 6 : 0.4;
}

type PlanGroup = 'dex' | 'lending' | 'yield' | 'derivs' | 'generic';

function planGroup(category: string | null): PlanGroup {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('swap')) return 'dex';
  if (c.includes('lend') || c.includes('borrow')) return 'lending';
  if (c.includes('yield') || c.includes('curator') || c.includes('vault') || c.includes('farm') || c.includes('liquidity')) return 'yield';
  if (c.includes('deriv') || c.includes('perp') || c.includes('option')) return 'derivs';
  return 'generic';
}

interface PlanBody {
  steps: string[];
  fees: number;
  minutes: number;
}

/**
 * The dated plan for one protocol, before its verdict step is added (the verdict needs the
 * plan's own totals). Costs and minutes are the plan's totals over the 8-week horizon.
 */
function planBody(p: SnapshotProtocol, asOf: string, group: PlanGroup): PlanBody {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasOf(chain);
  const w1 = `${fmtDate(asOf)} to ${fmtDate(addDays(asOf, 7))}`;
  const mid = `${fmtDate(addDays(asOf, 21))} to ${fmtDate(addDays(asOf, 42))}`;
  const review = fmtDate(addDays(asOf, ASSUMPTIONS.horizon_weeks * 7));
  const steps: string[] = [];
  let fees = 0;
  let minutes = 0;
  const add = (text: string, cost: number, mins: number) => {
    steps.push(text);
    fees += cost;
    minutes += mins;
  };

  add(
    `Set up in week 1 (${w1}): make a fresh wallet for ${p.name}, bridge the test deposit to ${chain}, and open the starter position below at a size you can leave untouched for 8 weeks. About $${(gas * 3).toFixed(2)} in network fees, 50 minutes.`,
    gas * 3,
    50,
  );

  if (group === 'dex') {
    add(
      `Core loop, weeks 1-8: swap two core pairs on ${p.name} twice a week in clips of $200-$500, varying pairs and times of day so the activity reads as use, not wash. About $${(gas * 1.5 * 2 * 8).toFixed(2)} in fees over the plan, 12 minutes a session, 192 in all.`,
      gas * 1.5 * 2 * 8,
      192,
    );
    add(
      `Second leg, from week 3 (${mid}): place 20% of the deposit in a core liquidity pool and leave it through two fee epochs; withdraw only at the ${review} review. About $${(gas * 2).toFixed(2)} in fees, 40 minutes.`,
      gas * 2,
      40,
    );
  } else if (group === 'lending') {
    add(
      `Core loop, weeks 1-8: supply the deposit as collateral on ${p.name}, borrow 30-40% against it in a second asset, and repay and redraw once a week so both sides of the market see the account. About $${(gas * 2 * 8).toFixed(2)} in fees over the plan, 25 minutes a week, 200 in all.`,
      gas * 2 * 8,
      200,
    );
    add(
      `Second leg, from week 3 (${mid}): keep the health factor above 1.8 through any 20% market drop; if it nears 1.5, repay first and ask questions later. About $${(gas * 1).toFixed(2)} in fees, 30 minutes.`,
      gas * 1,
      30,
    );
  } else if (group === 'yield') {
    add(
      `Core loop, weeks 1-8: hold the deposit in ${p.name}'s main vault or curated market and compound the yield back in once a week; do not chase the highest-APY vault, which is where the risk sits. About $${(gas * 1.5 * 8).toFixed(2)} in fees over the plan, 15 minutes a week, 120 in all.`,
      gas * 1.5 * 8,
      120,
    );
    add(
      `Second leg, from week 3 (${mid}): split 25% into a second vault or chain the protocol serves${p.chains.length > 1 ? ` (${p.chains[1]})` : ''} so the account is not a single-market ghost. About $${(gas * 2).toFixed(2)} in fees, 35 minutes.`,
      gas * 2,
      35,
    );
  } else if (group === 'derivs') {
    add(
      `Core loop, weeks 1-8: trade ${p.name}'s main perpetual market three times a week in $250-$500 clips at 2x or less, closing flat at least once a week; volume with a record of judgement, not leverage, is the point. About $${(gas * 8 + 12).toFixed(2)} in trading and network fees over the plan, 25 minutes a session, 200 in all.`,
      gas * 8 + 12,
      200,
    );
    add(
      `Second leg, from week 3 (${mid}): run one hedged pair (long the perp, short the spot elsewhere or the reverse) for two weeks so the account shows two-sided flow. About $${(gas * 2).toFixed(2)} in fees, 40 minutes.`,
      gas * 2,
      40,
    );
  } else {
    add(
      `Core loop, weeks 1-8: use ${p.name}'s core product twice a week at real size for its category (${p.category ?? 'uncategorised'}), varying amounts and days; steady, ordinary use is what a launch rewards. About $${(gas * 2 * 8).toFixed(2)} in fees over the plan, 20 minutes a session, 160 in all.`,
      gas * 2 * 8,
      160,
    );
    add(
      `Second leg, from week 3 (${mid}): take the second action the product offers (a second market, chain${p.chains.length > 1 ? ` such as ${p.chains[1]}` : ''}, or feature) so the account is not one-dimensional. About $${(gas * 2).toFixed(2)} in fees, 35 minutes.`,
      gas * 2,
      35,
    );
  }

  add(
    `Governance and community, weeks 2-8: read every proposal ${p.name} posts, vote with the position's weight when voting exists, and make one substantive forum or Discord contribution; no fee, about 60 minutes spread over the plan.`,
    0,
    60,
  );
  add(
    `Track it: keep a dated log of every action, fee and balance, and review the position against this plan on ${review}. If the protocol announces a token, snapshot or points programme before then, re-read the plan the same day. No fee, 45 minutes.`,
    0,
    45,
  );
  return { steps, fees, minutes };
}

// ---------------------------------------------------------------------------
// The board: ranked rows, the radar data the dashboard renders, the gate check.
// ---------------------------------------------------------------------------

/** One row of board.json: the gate's five fields plus everything the dashboard shows. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  odds: number;
  if_launched_usd: number;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  fees_usd: number;
  minutes: number;
  break_even_usd: number | null;
  net_1000: number;
  net_5000: number;
  net_25000: number;
  verdict_1000: Verdict;
  verdict_5000: Verdict;
  verdict_25000: Verdict;
  farm_steps: string[];
}

/** Everything data.js carries to the dashboard. */
export interface RadarData {
  version: string;
  as_of: string;
  floor_usd: number;
  coverage: Coverage;
  model: {
    chosen_id: string;
    train_n: number;
    range_lo: number;
    range_hi: number;
    base_rate: number;
    ceiling: number;
    candidates: { id: string; label: string; beta: number[]; holdout_miss: number; loo_miss: number; chosen: boolean }[];
    odds_curve: OddsPoint[];
  };
  assumptions: typeof ASSUMPTIONS;
  scatter: [number, number][];
  fit_line: [number, number][];
  rows: BoardRow[];
}

/** Round to 4 decimals for stable, readable output bytes. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Build the ranked board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitValueModel(snapshot);
  const launch = fitLaunchOdds(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const scored = snapshot.protocols
    .filter((p) => isPreToken(p) && asideReason(p) === null)
    .map((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      // Values are computed from the printed (rounded) odds and if-launched figures, so the
      // dashboard can recompute every row's expected value exactly from what it displays.
      const odds = round4(launch.odds(age));
      const ifLaunched = Math.round(model.predict(p));
      const evRaw = odds * ifLaunched;
      const ev = Math.max(1, Math.round(Math.min(evRaw, p.tvl_usd)));
      const p25 = Math.max(1, Math.round(Math.min(evRaw * round4(model.range_lo), p.tvl_usd)));
      const p75 = Math.max(1, Math.round(Math.min(evRaw * round4(model.range_hi), p.tvl_usd)));
      const plan = planBody(p, snapshot.as_of, planGroup(p.category));
      return { p, age, odds, ifLaunched, ev, p25, p75, plan };
    })
    .sort((a, b) => b.ev - a.ev || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((s, i) => {
    const fees = round2(s.plan.fees);
    const minutes = s.plan.minutes;
    const net = (d: number) => round2(farmNet(s.ev, s.p.tvl_usd, fees, minutes, d, ASSUMPTIONS.drop, ASSUMPTIONS.yield_pct));
    const net5000 = net(5000);
    const verdict5000 = verdictOf(net5000);
    const be = breakEvenDeposit(s.ev, s.p.tvl_usd, fees, minutes);
    const gross5000 = s.ev * ASSUMPTIONS.drop * (5000 / (5000 + s.p.tvl_usd));
    const timeCost = (minutes / 60) * ASSUMPTIONS.time_usd_hr;
    const idleCost = 5000 * (ASSUMPTIONS.yield_pct / 100) * (ASSUMPTIONS.horizon_weeks / 52);
    const review = fmtDate(addDays(snapshot.as_of, ASSUMPTIONS.horizon_weeks * 7));
    const verdictStep =
      `The verdict at the board's $5,000 test deposit: ${verdict5000}. Gross ${fmtUsd(gross5000)} (expected value ${fmtUsd(s.ev)} x ${(ASSUMPTIONS.drop * 100).toFixed(0)}% drop share x your share of ${fmtUsd(s.p.tvl_usd)} of TVL) less $${fees.toFixed(2)} fees, $${timeCost.toFixed(2)} of time and $${idleCost.toFixed(2)} of idle yield nets $${net5000.toFixed(2)}. ` +
      (be === null ? `No deposit at or below $2,000,000 breaks even on these figures. ` : `Break-even deposit: $${be.toLocaleString('en-US')}. `) +
      `Exit rule: if no token, snapshot or points programme is announced by ${review}, unwind within a week; the record shows most value arrives with the announcement, not after it.`;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.age,
      watchlist: watchlist.has(s.p.slug),
      odds: round4(s.odds),
      if_launched_usd: Math.round(s.ifLaunched),
      implied_value_usd: s.ev,
      p25_usd: Math.min(s.p25, s.ev),
      p75_usd: Math.max(s.p75, s.ev),
      fees_usd: fees,
      minutes,
      break_even_usd: be,
      net_1000: net(1000),
      net_5000: net5000,
      net_25000: net(25000),
      verdict_1000: verdictOf(net(1000)),
      verdict_5000: verdict5000,
      verdict_25000: verdictOf(net(25000)),
      farm_steps: [...s.plan.steps, verdictStep],
    };
  });

  const rankedSlugs = new Set(board.map((r) => r.slug));
  const coverage = coverageOf(snapshot, rankedSlugs);
  const train = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const fitLine: [number, number][] = [];
  for (let i = 0; i < 24; i += 1) {
    const tvl = Math.exp(Math.log(5e6) + (Math.log(3e10) - Math.log(5e6)) * (i / 23));
    fitLine.push([Math.round(tvl), Math.round(model.predict({ ...train[0]!, tvl_usd: tvl, change_7d: 0 }))]);
  }
  const radar: RadarData = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    coverage,
    model: {
      chosen_id: model.chosen.id,
      train_n: model.train_n,
      range_lo: round4(model.range_lo),
      range_hi: round4(model.range_hi),
      base_rate: round4(launch.base_rate),
      ceiling: round4(launch.ceiling),
      candidates: model.candidates.map((c) => ({
        id: c.id,
        label: c.label,
        beta: c.beta.map(round4),
        holdout_miss: round4(c.holdout_miss),
        loo_miss: round4(c.loo_miss),
        chosen: c.chosen,
      })),
      odds_curve: launch.curve.map((pt) => ({ age_days: pt.age_days, launched_share: round4(pt.launched_share), odds: round4(pt.odds) })),
    },
    assumptions: ASSUMPTIONS,
    scatter: train.map((p) => [p.tvl_usd, p.mcap_usd!] as [number, number]).sort((a, b) => a[0] - b[0]),
    fit_line: fitLine,
    rows: board,
  };
  return { board, radar };
}

/** The data.js the dashboard reads, written beside it by main.ts. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * Recompute one row's expected value from the fitted pieces, by a second path: the self-check
 * main.ts runs before it writes anything. Returns null when the slug is not ranked.
 */
export function recomputeEv(snapshot: Snapshot, slug: string): number | null {
  const p = snapshot.protocols.find((q) => q.slug === slug);
  if (p === undefined || asideReason(p) !== null) return null;
  const model = fitValueModel(snapshot);
  const launch = fitLaunchOdds(snapshot);
  const ev = round4(launch.odds(ageDays(snapshot.as_of, p.listed_at))) * Math.round(model.predict(p));
  return Math.max(1, Math.round(Math.min(ev, p.tvl_usd)));
}

/** The gate's board checks, run by main.ts on its own output; a string names the first failure. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i += 1) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1} names invented slug ${row.slug}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug} has a bad implied value`;
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    prev = row.implied_value_usd;
    if (row.implied_value_usd > row.tvl_usd) return `row ${row.slug} expects more than its TVL`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters`;
    }
  }
  if (allSame) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  return null;
}
