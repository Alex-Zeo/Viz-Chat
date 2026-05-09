import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_ID = 'openai/gpt-5.4-image-2';

export function loadApiKey(): string {
  const configPath = join(homedir(), '.dakka', 'config.json');
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const key = cfg?.ai_services?.openrouter_api_key;
  if (!key) throw new Error('No openrouter_api_key in ~/.dakka/config.json');
  return key;
}

interface GenerateImageResult {
  imageBuf: Buffer;
  elapsedMs: number;
}

export async function generateImage(
  apiKey: string,
  prompt: string,
  aspectHint: string,
): Promise<GenerateImageResult> {
  const fullPrompt = `${prompt}\n\nOutput image aspect ratio: ${aspectHint}.`;

  const body = {
    model: MODEL_ID,
    modalities: ['image', 'text'],
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: fullPrompt }],
    }],
  };

  const t0 = Date.now();
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - t0;

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) {
    throw new Error(`No message in OpenRouter response. Body: ${JSON.stringify(data).slice(0, 1000)}`);
  }

  const imageUrl = extractImageUrl(msg);
  if (!imageUrl) throw new Error(`No image in response. Keys: ${Object.keys(msg).join(', ')}`);

  const imageBuf = await fetchImageBuffer(imageUrl);
  return { imageBuf, elapsedMs };
}

function extractImageUrl(msg: Record<string, unknown>): string | null {
  const images = msg.images as Array<Record<string, unknown>> | undefined;
  if (images?.length) {
    const entry = images[0];
    const nested = entry.image_url as Record<string, string> | undefined;
    return nested?.url ?? (entry.url as string) ?? null;
  }
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'image_url') {
        return part.image_url?.url ?? null;
      }
    }
  }
  return null;
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return Buffer.from(match[1], 'base64');
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

export function saveImage(buf: Buffer, path: string): void {
  writeFileSync(path, buf);
}
