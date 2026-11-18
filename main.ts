// Token Radar v4 (model "radar-4"): a fitted, out-of-sample-validated token launch radar.
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits
// its value model and launch-odds curve on the snapshot's own traded protocols in lib/model.ts,
// writes the ranked board to /output/board.json, writes the dashboard's data to /output/data.js,
// copies this repository's dashboard/ and screenshots/ to /output, and writes /output/dossier.json
// with the vendored make.fun library.
//
// Before anything is written, the program checks its own work: the board must pass the gate's
// checks (boardIssue), every watchlist slug must be ranked, no row may expect more than its
// TVL, and the top row's expected value is recomputed by a second path and compared. A board
// that fails any of these is refused here, not at the gate.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, recomputeEv } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);

// Self-checks, run before a single byte is written: the gate's own board rules, the coverage
// accounting, and an independent recomputation of two rows' expected values.
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
const cov = radar.coverage;
if (cov.ranked + cov.traded + cov.set_aside !== cov.total) {
  process.stderr.write(`token radar: coverage does not account for the universe: ${cov.ranked} + ${cov.traded} + ${cov.set_aside} != ${cov.total}\n`);
  process.exit(1);
}
if (cov.watchlist_ranked !== cov.watchlist) {
  process.stderr.write(`token radar: watchlist coverage ${cov.watchlist_ranked}/${cov.watchlist}\n`);
  process.exit(1);
}
for (const probe of [board[0]!.slug, snapshot.watchlist[0]!]) {
  const row = board.find((r) => r.slug === probe)!;
  const again = recomputeEv(snapshot, probe);
  if (again === null || again !== row.implied_value_usd) {
    process.stderr.write(`token radar: self-check failed on ${probe}: board says ${row.implied_value_usd}, recomputation says ${again}\n`);
    process.exit(1);
  }
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board, meta: { model: radar.version, as_of: radar.as_of, coverage: cov, validation: radar.model.candidates, base_rate: radar.model.base_rate } })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const chosen = radar.model.candidates.find((c) => c.chosen)!;
const farms = board.filter((r) => r.verdict_25000 === 'FARM').length;
const candidateLines = radar.model.candidates
  .map((c) => `token radar: candidate "${c.label}": held-out miss x${c.holdout_miss.toFixed(2)}, leave-one-out x${c.loo_miss.toFixed(2)}${c.chosen ? ' (kept)' : ' (not kept)'}`)
  .join('\n');
process.stdout.write(
  `token radar ${radar.version}: ${cov.total} protocols accounted for (${cov.ranked} ranked, ${cov.traded} already trade, ${cov.set_aside} set aside), watchlist ${cov.watchlist_ranked}/${cov.watchlist}\n` +
    `${candidateLines}\n` +
    `token radar: model "${chosen.label}" fitted on ${radar.model.train_n} traded protocols; ${farms} rows verdict FARM at a $25,000 deposit (a $5,000 deposit honestly farms none of them)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} and ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
