import { readFileSync } from 'fs';
import type { LqiScores } from './types.js';
import { ASSESSMENT_PROMPT } from './prompts.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ASSESSOR_MODEL = 'anthropic/claude-sonnet-4';

export async function assessLogo(apiKey: string, imagePath: string): Promise<LqiScores> {
  const imageData = readFileSync(imagePath).toString('base64');
  const mediaType = imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg')
    ? 'image/jpeg' : 'image/png';

  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ASSESSOR_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${imageData}` },
          },
          { type: 'text', text: ASSESSMENT_PROMPT },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Assessment API ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '{}';
  return parseLqiResponse(text);
}

function parseLqiResponse(text: string): LqiScores {
  const clean = text.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();

  const clamp = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0.3;
    return Math.min(1, Math.max(0, v));
  };

  try {
    const parsed = JSON.parse(clean);
    return {
      Composition: clamp(parsed.Composition),
      ColorAccuracy: clamp(parsed.ColorAccuracy),
      ChartClarity: clamp(parsed.ChartClarity),
      NeonGlow: clamp(parsed.NeonGlow),
      Scalability: clamp(parsed.Scalability),
      Polish: clamp(parsed.Polish),
      fixes: Array.isArray(parsed.fixes)
        ? parsed.fixes.filter((f: unknown) => typeof f === 'string')
        : [],
    };
  } catch {
    return {
      Composition: 0.3, ColorAccuracy: 0.3, ChartClarity: 0.3,
      NeonGlow: 0.3, Scalability: 0.3, Polish: 0.3,
      fixes: ['assessment parse error'],
    };
  }
}
