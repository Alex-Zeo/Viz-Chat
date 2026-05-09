import type { VariantConfig } from './types.js';

const BASE_PROMPT = `Professional logo for "Viz-Chat" data viz chat app. Cyberpunk neon aesthetic. Top third: vertical cascading matrix ASCII rain in glowing #00FF41 green, glyphs dissolving into geometric particles at the dissolution boundary. Bottom two-thirds: 2x2 isometric 3D arrangement of four small charts on a dark floor plane. Top-left: glowing cyan #00E5FF 3D line chart. Top-right: amber #FFB627 and green isometric bullet chart. Bottom-right: magenta #FF2EC4 to violet #7B2FFF 3D sunburst with extruded concentric rings. Bottom-left: isometric GitHub-style heatmap grid with varying square heights in green #00FF41 tones. Background #0A0E12, soft neon underglow, sharp geometric edges, high fidelity, vector style, balanced composition, centered`;

export const VARIANTS: VariantConfig[] = [
  {
    id: 'A',
    label: 'Logomark (1:1)',
    aspectHint: '1:1 square',
    promptSuffix: ', 1:1 square, 4K.',
  },
  {
    id: 'B-vert',
    label: 'Lockup Vertical (4:5)',
    aspectHint: '4:5 vertical',
    promptSuffix: `. Below the logomark, centered wordmark "Viz-Chat" in monospace font (JetBrains Mono style), weight 600, white #FFFFFF with subtle green glow, tracking +20. Gap between logo and text equals 0.6x logomark height. Aspect ratio 4:5 vertical, 4K.`,
  },
  {
    id: 'B-horiz',
    label: 'Lockup Horizontal (16:9)',
    aspectHint: '16:9 horizontal',
    promptSuffix: `. To the right of the logomark, wordmark "Viz-Chat" in monospace font (JetBrains Mono style), weight 600, white #FFFFFF with subtle green glow, tracking +20. Wordmark cap-height approximately 22% of logomark height. Aspect ratio 16:9 horizontal, 4K.`,
  },
];

export function buildGenerationPrompt(variant: VariantConfig, fixes?: string[]): string {
  let prompt = BASE_PROMPT + variant.promptSuffix;
  if (fixes && fixes.length > 0) {
    prompt += `\n\nIMPROVEMENTS REQUIRED from previous iteration:\n${fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
  }
  return prompt;
}

export const ASSESSMENT_PROMPT = `You are evaluating a logo for "Viz-Chat", a cyberpunk-themed data visualization app.

Score on 6 pillars (0.0 to 1.0 each):

Composition (0.25): Matrix ASCII rain in top third dissolving into 2x2 isometric chart grid in bottom two-thirds. Clear dissolution boundary.
Color Accuracy (0.25): Matrix green #00FF41, cyan line chart #00E5FF, magenta sunburst #FF2EC4, violet outer #7B2FFF, amber bullet #FFB627, dark background #0A0E12.
Chart Clarity (0.20): Four distinct chart types identifiable — line ribbon, bullet bar, sunburst rings, heatmap grid. Isometric 30-degree tilt.
Neon Glow (0.15): Bloom/glow halos around elements, neon underglow on chart platforms, cyberpunk atmosphere.
Scalability (0.10): Would charts remain distinguishable at 128px? Are shapes clean enough for small sizes?
Polish (0.05): Sharp geometric edges, no artifacts, no text rendering issues, professional finish.

Respond with ONLY this JSON:
{"Composition": <number>, "ColorAccuracy": <number>, "ChartClarity": <number>, "NeonGlow": <number>, "Scalability": <number>, "Polish": <number>, "fixes": ["<specific fix 1>", "<specific fix 2>"]}`;
