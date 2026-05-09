import { describe, it, expect } from 'vitest';
import { selectBest, shouldKeep } from '../scripts/logo/ratchet.js';
import type { IterationResult } from '../scripts/logo/types.js';

const makeIter = (iteration: number, lqi: number): IterationResult => ({
  iteration,
  lqi,
  scores: {
    Composition: lqi, ColorAccuracy: lqi, ChartClarity: lqi,
    NeonGlow: lqi, Scalability: lqi, Polish: lqi, fixes: [],
  },
  imagePath: `/tmp/iter-${iteration}.png`,
  prompt: 'test',
  elapsedMs: 1000,
});

describe('selectBest', () => {
  it('returns iteration with highest LQI', () => {
    const iters = [makeIter(0, 0.5), makeIter(1, 0.8), makeIter(2, 0.6)];
    const best = selectBest(iters);
    expect(best.iteration).toBe(1);
    expect(best.lqi).toBe(0.8);
  });

  it('returns first on tie', () => {
    const iters = [makeIter(0, 0.7), makeIter(1, 0.7)];
    const best = selectBest(iters);
    expect(best.iteration).toBe(0);
  });

  it('handles single iteration', () => {
    const best = selectBest([makeIter(0, 0.5)]);
    expect(best.iteration).toBe(0);
  });
});

describe('shouldKeep', () => {
  it('keeps when new LQI is higher', () => {
    expect(shouldKeep(0.7, 0.5)).toBe(true);
  });

  it('rejects when new LQI is lower', () => {
    expect(shouldKeep(0.4, 0.5)).toBe(false);
  });

  it('keeps on equal (not strictly worse)', () => {
    expect(shouldKeep(0.5, 0.5)).toBe(true);
  });
});
