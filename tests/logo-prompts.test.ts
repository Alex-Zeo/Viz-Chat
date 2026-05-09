import { describe, it, expect } from 'vitest';
import { computeLqi, LQI_WEIGHTS } from '../scripts/logo/types.js';
import { VARIANTS, buildGenerationPrompt, ASSESSMENT_PROMPT } from '../scripts/logo/prompts.js';

describe('LQI computation', () => {
  it('perfect scores produce 1.0', () => {
    const scores = {
      Composition: 1, ColorAccuracy: 1, ChartClarity: 1,
      NeonGlow: 1, Scalability: 1, Polish: 1, fixes: [],
    };
    expect(computeLqi(scores)).toBeCloseTo(1.0, 5);
  });

  it('zero scores produce 0.0', () => {
    const scores = {
      Composition: 0, ColorAccuracy: 0, ChartClarity: 0,
      NeonGlow: 0, Scalability: 0, Polish: 0, fixes: [],
    };
    expect(computeLqi(scores)).toBe(0);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(LQI_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('partial scores compute correctly', () => {
    const scores = {
      Composition: 0.8, ColorAccuracy: 0.6, ChartClarity: 0.7,
      NeonGlow: 0.5, Scalability: 0.9, Polish: 0.4, fixes: [],
    };
    const expected = 0.25*0.8 + 0.25*0.6 + 0.20*0.7 + 0.15*0.5 + 0.10*0.9 + 0.05*0.4;
    expect(computeLqi(scores)).toBeCloseTo(expected, 5);
  });
});

describe('Prompt construction', () => {
  it('all 3 variants defined', () => {
    expect(VARIANTS).toHaveLength(3);
    expect(VARIANTS.map(v => v.id)).toEqual(['A', 'B-vert', 'B-horiz']);
  });

  it('base prompt includes key color hex values', () => {
    const prompt = buildGenerationPrompt(VARIANTS[0]);
    expect(prompt).toContain('#00FF41');
    expect(prompt).toContain('#00E5FF');
    expect(prompt).toContain('#FF2EC4');
    expect(prompt).toContain('#7B2FFF');
    expect(prompt).toContain('#FFB627');
    expect(prompt).toContain('#0A0E12');
  });

  it('logomark variant ends with 1:1 square', () => {
    const prompt = buildGenerationPrompt(VARIANTS[0]);
    expect(prompt).toContain('1:1 square');
    expect(prompt).not.toContain('wordmark');
  });

  it('vertical lockup includes wordmark and 4:5', () => {
    const prompt = buildGenerationPrompt(VARIANTS[1]);
    expect(prompt).toContain('Viz-Chat');
    expect(prompt).toContain('4:5 vertical');
    expect(prompt).toContain('JetBrains Mono');
  });

  it('horizontal lockup includes wordmark and 16:9', () => {
    const prompt = buildGenerationPrompt(VARIANTS[2]);
    expect(prompt).toContain('Viz-Chat');
    expect(prompt).toContain('16:9 horizontal');
  });

  it('fixes are appended to prompt', () => {
    const prompt = buildGenerationPrompt(VARIANTS[0], ['Make background darker', 'Add more glow']);
    expect(prompt).toContain('IMPROVEMENTS REQUIRED');
    expect(prompt).toContain('1. Make background darker');
    expect(prompt).toContain('2. Add more glow');
  });

  it('no fixes means no suffix appended', () => {
    const prompt = buildGenerationPrompt(VARIANTS[0]);
    expect(prompt).not.toContain('IMPROVEMENTS REQUIRED');
    const promptEmptyFixes = buildGenerationPrompt(VARIANTS[0], []);
    expect(promptEmptyFixes).not.toContain('IMPROVEMENTS REQUIRED');
  });

  it('assessment prompt includes all 6 pillar names', () => {
    expect(ASSESSMENT_PROMPT).toContain('Composition');
    expect(ASSESSMENT_PROMPT).toContain('Color Accuracy');
    expect(ASSESSMENT_PROMPT).toContain('Chart Clarity');
    expect(ASSESSMENT_PROMPT).toContain('Neon Glow');
    expect(ASSESSMENT_PROMPT).toContain('Scalability');
    expect(ASSESSMENT_PROMPT).toContain('Polish');
  });
});
