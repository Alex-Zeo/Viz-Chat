import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CandidateResult, GenerationLog } from './logo/types.js';
import { VARIANTS } from './logo/prompts.js';
import { loadApiKey } from './logo/openrouter.js';
import { runCandidateRatchet } from './logo/ratchet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'logo', 'candidates');
const CANDIDATES_PER_VARIANT = 3;

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  Viz-Chat Logo Generator — RALPH Ratchet Loop     ║');
  console.log('║  3 variants × 3 candidates × 3 iterations         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const apiKey = loadApiKey();
  mkdirSync(OUT_DIR, { recursive: true });

  const t0 = Date.now();
  const allResults: CandidateResult[] = [];
  let totalApiCalls = 0;

  for (const variant of VARIANTS) {
    console.log(`\n── ${variant.label} ──────────────────────────────────────`);

    const candidates = Array.from({ length: CANDIDATES_PER_VARIANT }, (_, i) => i + 1);
    const results = await Promise.all(
      candidates.map(i => runCandidateRatchet(apiKey, variant, i, OUT_DIR)),
    );

    for (const r of results) {
      allResults.push(r);
      totalApiCalls += r.iterations.length * 2;
    }

    const best = results.reduce((a, b) => a.bestLqi > b.bestLqi ? a : b);
    console.log(`  Best for ${variant.id}: candidate ${best.candidateIndex}, LQI=${best.bestLqi.toFixed(3)}`);
  }

  const totalElapsedMs = Date.now() - t0;

  const log: GenerationLog = {
    timestamp: new Date().toISOString(),
    model: 'openai/gpt-5.4-image-2',
    variants: allResults,
    totalElapsedMs,
    totalApiCalls,
  };
  writeFileSync(
    join(OUT_DIR, '..', 'generation.json'),
    JSON.stringify(log, null, 2) + '\n',
  );

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  GENERATION COMPLETE                               ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  Total time: ${(totalElapsedMs / 1000).toFixed(0)}s`);
  console.log(`  API calls:  ${totalApiCalls}`);
  console.log(`  Output:     ${OUT_DIR}`);
  console.log('\n  RESULTS:');

  for (const r of allResults) {
    const bar = '█'.repeat(Math.round(r.bestLqi * 20)).padEnd(20, '░');
    console.log(`    ${bar} ${r.bestLqi.toFixed(3)} ${r.variant}-${r.candidateIndex} (iter ${r.bestIteration})`);
  }

  console.log(`\n  → Review candidates in: ${OUT_DIR}`);
}

main().catch(err => {
  console.error('Logo generation failed:', err);
  process.exit(1);
});
