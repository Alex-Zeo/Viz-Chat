import { mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { VariantConfig, IterationResult, CandidateResult } from './types.js';
import { computeLqi } from './types.js';
import { buildGenerationPrompt } from './prompts.js';
import { generateImage, saveImage } from './openrouter.js';
import { assessLogo } from './assessor.js';

const MAX_ITERATIONS = 3;
const CONVERGENCE_LQI = 0.80;

export function selectBest(iterations: IterationResult[]): IterationResult {
  return iterations.reduce((best, cur) => cur.lqi > best.lqi ? cur : best);
}

export function shouldKeep(newLqi: number, bestLqi: number): boolean {
  return newLqi >= bestLqi;
}

export async function runCandidateRatchet(
  apiKey: string,
  variant: VariantConfig,
  candidateIndex: number,
  outDir: string,
): Promise<CandidateResult> {
  const candidateDir = join(outDir, `${variant.id}-${candidateIndex}`);
  mkdirSync(candidateDir, { recursive: true });

  const iterations: IterationResult[] = [];
  let accumulatedFixes: string[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const prompt = buildGenerationPrompt(variant, iter === 0 ? undefined : accumulatedFixes);
    const imagePath = join(candidateDir, `iter-${iter}.png`);

    console.log(`  [${variant.id}-${candidateIndex}] iter ${iter}: generating...`);
    const { imageBuf, elapsedMs } = await generateImage(apiKey, prompt, variant.aspectHint);
    saveImage(imageBuf, imagePath);

    console.log(`  [${variant.id}-${candidateIndex}] iter ${iter}: assessing...`);
    const scores = await assessLogo(apiKey, imagePath);
    const lqi = computeLqi(scores);

    const result: IterationResult = {
      iteration: iter,
      lqi,
      scores,
      imagePath,
      prompt,
      elapsedMs,
    };
    iterations.push(result);

    const pillars = `C=${scores.Composition.toFixed(2)} Col=${scores.ColorAccuracy.toFixed(2)} Ch=${scores.ChartClarity.toFixed(2)} G=${scores.NeonGlow.toFixed(2)} S=${scores.Scalability.toFixed(2)} P=${scores.Polish.toFixed(2)}`;
    console.log(`  [${variant.id}-${candidateIndex}] iter ${iter}: LQI=${lqi.toFixed(3)} [${pillars}]`);

    if (lqi >= CONVERGENCE_LQI) {
      console.log(`  [${variant.id}-${candidateIndex}] CONVERGED at iter ${iter}`);
      break;
    }

    const best = selectBest(iterations);
    if (!shouldKeep(lqi, best.lqi) && iter > 0) {
      console.log(`  [${variant.id}-${candidateIndex}] iter ${iter}: regression (${lqi.toFixed(3)} < ${best.lqi.toFixed(3)}), carrying forward best fixes`);
      accumulatedFixes = [...best.scores.fixes, ...scores.fixes.filter(f => !best.scores.fixes.includes(f))];
    } else {
      accumulatedFixes = scores.fixes;
    }
  }

  const best = selectBest(iterations);
  const bestPath = join(candidateDir, 'best.png');
  copyFileSync(best.imagePath, bestPath);

  writeFileSync(
    join(candidateDir, 'scores.json'),
    JSON.stringify({ bestIteration: best.iteration, bestLqi: best.lqi, iterations }, null, 2) + '\n',
  );

  return {
    variant: variant.id,
    candidateIndex,
    iterations,
    bestIteration: best.iteration,
    bestLqi: best.lqi,
    bestImagePath: bestPath,
  };
}
