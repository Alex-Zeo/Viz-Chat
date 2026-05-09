export interface LqiScores {
  Composition: number;
  ColorAccuracy: number;
  ChartClarity: number;
  NeonGlow: number;
  Scalability: number;
  Polish: number;
  fixes: string[];
}

export const LQI_WEIGHTS: Record<keyof Omit<LqiScores, 'fixes'>, number> = {
  Composition: 0.25,
  ColorAccuracy: 0.25,
  ChartClarity: 0.20,
  NeonGlow: 0.15,
  Scalability: 0.10,
  Polish: 0.05,
};

export function computeLqi(scores: LqiScores): number {
  let total = 0;
  for (const [key, weight] of Object.entries(LQI_WEIGHTS)) {
    total += weight * (scores[key as keyof typeof LQI_WEIGHTS] ?? 0);
  }
  return total;
}

export interface IterationResult {
  iteration: number;
  lqi: number;
  scores: LqiScores;
  imagePath: string;
  prompt: string;
  elapsedMs: number;
}

export interface CandidateResult {
  variant: VariantId;
  candidateIndex: number;
  iterations: IterationResult[];
  bestIteration: number;
  bestLqi: number;
  bestImagePath: string;
}

export interface GenerationLog {
  timestamp: string;
  model: string;
  variants: CandidateResult[];
  totalElapsedMs: number;
  totalApiCalls: number;
}

export type VariantId = 'A' | 'B-vert' | 'B-horiz';

export interface VariantConfig {
  id: VariantId;
  label: string;
  aspectHint: string;
  promptSuffix: string;
}
