import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import type { PanelEval } from './types.js';

function claudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn('/Users/pluto/.nvm/versions/node/v22.22.1/bin/claude', ['-p', '--dangerously-skip-permissions', '--effort', 'max', '--model', 'claude-opus-4-6'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
    });
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    const errChunks: Buffer[] = [];
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString();
      const err = Buffer.concat(errChunks).toString();
      if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function runVisionEval(
  screenshotPath: string,
  query: string,
  vizTypeName: string,
  mechanicalScore: number
): Promise<PanelEval> {
  const imageData = readFileSync(screenshotPath);
  const base64Image = imageData.toString('base64');
  const prompt = buildEvalPrompt(query, vizTypeName);

  const responseText = await claudeCli(`[Image at ${screenshotPath}]\n\n${prompt}`);

  const parsed = parseEvalResponse(responseText);

  // 5. Calculate PQI
  const pqi = 0.25 * parsed.Q + 0.20 * parsed.D + 0.20 * parsed.F
            + 0.15 * parsed.I + 0.10 * parsed.A + 0.10 * parsed.P;

  return {
    pqi,
    pillars: { Q: parsed.Q, D: parsed.D, F: parsed.F, I: parsed.I, A: parsed.A, P: parsed.P },
    fixes: parsed.fixes,
    mechanicalScore,
    tier: 'vision',
  };
}

function buildEvalPrompt(query: string, vizTypeName: string): string {
  return `You are evaluating a ${vizTypeName} chart rendered in headless Chrome (no user interaction possible in screenshot).

The user asked: "${query}"

CRITICAL: Before scoring, VERIFY the chart actually shows data. Look for visible bars, lines, points, slices, or other data-ink marks in the image. Do NOT claim "chart contains no data" if you can see data points — count them. If the chart area is completely empty/white/black with no marks, THEN it is blank.

FAILURE CLASS CHECKLIST — check each BEFORE scoring. If any apply, enforce the ceiling:
- Is function code visible as literal text in labels, axes, or tooltips (e.g., "function(v){return...}" rendered as a string)? → Q and F scores MUST be ≤ 0.1
- Is the chart completely blank — no data-ink at all, just axes/grid/background? → ALL scores MUST be ≤ 0.1
- Does the title echo the user query verbatim or just name the chart type (e.g., "Bar Chart" or "Show me revenue trends") instead of describing a data insight? → Q score MUST be ≤ 0.4
- In a grouped/stacked/multi-series chart, are all series the SAME color? → A and P scores MUST be ≤ 0.3
- Is there NO legend on a chart with 2+ series? → F score MUST be ≤ 0.4

Score this visualization on 6 pillars (0.0 to 1.0 each):

Q — Question Relevance (weight 0.25): Does this viz help answer the user's query? Is the right data shown? Does the title describe the data insight (e.g., "Revenue Grew 23% YoY"), not the chart type or the query? Does the subtitle provide a key takeaway number?

D — Data Density (weight 0.20): Data-ink ratio. Information per pixel. Is screen space used efficiently? Are labels and legends earning their space?

F — Fidelity (weight 0.20): Axes labeled with units? Title present and descriptive? Legend clear and present for multi-series? Numbers formatted with K/M/B suffixes (not raw like 2800000000)? No clipping?

I — Interactivity (weight 0.15): Does the config include tooltip, emphasis, and legend? (These exist in config but may not be visible in a static screenshot — score 0.7 if structure is correct even without hover state.)

A — Accessibility (weight 0.10): Colorblind-safe palette? Each series a DISTINCT color? Readable font size? Sufficient contrast against dark background?

P — Polish (weight 0.10): Grid margins adequate? Series styling polished? Bar corners rounded? Line widths appropriate?

CALIBRATION ANCHORS — use these to calibrate your scores:
- 0.9-1.0: Publication quality — descriptive insight title, formatted numbers ($2.8B not 2800000000), multi-color series with distinct palette, tooltips visible, legend present, polished styling
- 0.6-0.8: Good chart with minor issues — title is decent, data is correct, colors work but could be better
- 0.4-0.5: Usable but flawed — generic title, missing legend, raw unformatted numbers, minor layout issues
- 0.1-0.3: Broken — blank chart area, function code visible as text, wrong data shown, unreadable labels
- 0.0: Catastrophic — no chart rendered at all, completely white/black image

If you are uncertain about a score, round DOWN not up.

Your response must be ONLY a JSON object. No markdown fences, no backticks, no explanation, no text before or after the JSON.
{
  "Q": <number>,
  "D": <number>,
  "F": <number>,
  "I": <number>,
  "A": <number>,
  "P": <number>,
  "fixes": ["<specific fix 1>", "<specific fix 2>", ...]
}`;
}

interface ParsedPillars {
  Q: number;
  D: number;
  F: number;
  I: number;
  A: number;
  P: number;
  fixes: string[];
}

function parseEvalResponse(rawResponse: string): ParsedPillars {
  const rawText = rawResponse.trim();

  if (!rawText) {
    return defaultPillars('Empty response');
  }

  // Strip potential markdown code fences (```json ... ```)
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return defaultPillars(`JSON parse failed: ${rawText.slice(0, 120)}`);
  }

  // Clamp a value to [0, 1], defaulting to 0.3 if not a valid number
  const clamp = (key: string): number => {
    const v = parsed[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0.3;
    return Math.min(1, Math.max(0, v));
  };

  const fixes: string[] = Array.isArray(parsed['fixes'])
    ? (parsed['fixes'] as unknown[])
        .filter((f): f is string => typeof f === 'string')
    : [];

  return {
    Q: clamp('Q'),
    D: clamp('D'),
    F: clamp('F'),
    I: clamp('I'),
    A: clamp('A'),
    P: clamp('P'),
    fixes,
  };
}

function defaultPillars(reason: string): ParsedPillars {
  return {
    Q: 0.3,
    D: 0.3,
    F: 0.3,
    I: 0.3,
    A: 0.3,
    P: 0.3,
    fixes: [`Vision eval parse error: ${reason}`],
  };
}
