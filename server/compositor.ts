import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { COLORS } from './design-tokens.js';
import type { Frame } from './types.js';

const CHROME_URL = 'http://127.0.0.1:9222';

const CONTROL_ROOM_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${COLORS.bg}; width: 100vw; height: 100vh; overflow: hidden; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    width: 100%;
    height: 100%;
    gap: 2px;
    background: ${COLORS.border};
  }
  .grid iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: ${COLORS.surface};
  }
</style>
</head>
<body>
<div class="grid">
  <iframe id="panel-0" sandbox="allow-scripts"></iframe>
  <iframe id="panel-1" sandbox="allow-scripts"></iframe>
  <iframe id="panel-2" sandbox="allow-scripts"></iframe>
  <iframe id="panel-3" sandbox="allow-scripts"></iframe>
</div>
</body>
</html>`;

export class Compositor {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private agentFrames: Map<string, Frame[]> = new Map();
  private agentSlots: Map<string, number> = new Map();
  private userPositions: Map<string, number> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    this.browser = await puppeteer.connect({ browserURL: CHROME_URL });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 2560, height: 1440 });
    await this.page.setContent(CONTROL_ROOM_HTML, { waitUntil: 'load' });
  }

  registerAgentPage(agentId: string, slotIndex: number): void {
    this.agentSlots.set(agentId, slotIndex);
    this.agentFrames.set(agentId, []);
  }

  pushFrame(agentId: string, frame: Frame): void {
    const frames = this.agentFrames.get(agentId) ?? [];
    frames.push(frame);
    this.agentFrames.set(agentId, frames);

    const latestIdx = frames.length - 1;
    const userPos = this.userPositions.get(agentId);
    const slotIndex = this.getSlotIndex(agentId);

    if (slotIndex === undefined) return;

    // Auto-advance if user hasn't navigated or is already at the previous latest
    if (userPos === undefined || userPos === latestIdx - 1) {
      this.userPositions.set(agentId, latestIdx);
      this.updatePanel(slotIndex, frame.html).catch((err: unknown) => {
        console.error(`[compositor] updatePanel error for ${agentId}:`, err);
      });
    }
  }

  private async updatePanel(slotIndex: number, html: string): Promise<void> {
    if (!this.page) return;
    await this.page.evaluate(
      (slot: number, content: string) => {
        const iframe = document.getElementById(`panel-${slot}`) as HTMLIFrameElement | null;
        if (iframe) iframe.srcdoc = content;
      },
      slotIndex,
      html,
    );
  }

  startPolling(intervalMs: number = 1000): void {
    this.pollInterval = setInterval(() => {
      void (async () => {
        try {
          for (const [agentId, frames] of this.agentFrames) {
            if (frames.length === 0) continue;
            const slotIndex = this.getSlotIndex(agentId);
            if (slotIndex === undefined) continue;

            const latestIdx = frames.length - 1;
            const userPos = this.userPositions.get(agentId);

            // Only auto-advance if user is at latest position or hasn't navigated
            if (userPos === undefined || userPos === latestIdx - 1) {
              this.userPositions.set(agentId, latestIdx);
              const frame = frames[latestIdx];
              if (frame) {
                await this.updatePanel(slotIndex, frame.html);
              }
            }
          }
        } catch (err: unknown) {
          console.error('[compositor] polling error:', err);
        }
      })();
    }, intervalMs);
  }

  async getScreenshot(path: string): Promise<void> {
    if (this.page) {
      await this.page.screenshot({ path, type: 'png', fullPage: true });
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.browser) {
      this.browser.disconnect();
      this.browser = null;
    }
  }

  private getSlotIndex(agentId: string): number | undefined {
    return this.agentSlots.get(agentId);
  }
}
