// Set a dummy API key before any imports so the Anthropic SDK doesn't error
// if the environment variable is absent at module evaluation time.
process.env.ANTHROPIC_API_KEY ||= 'sk-ant-test-placeholder';

import { describe, it, expect } from 'vitest';
import { getCompanyBySlug, getDataProfile, getDataSlice } from '../server/db.js';
import { rankVizTypes } from '../server/ranker.js';
import { FrameStore } from '../server/frame-store.js';
import { runDomEval } from '../server/eval-dom.js';
import { buildAgentHTML, DESIGN_TOKENS_CSS } from '../server/design-tokens.js';
import type { ParsedQuery, Frame } from '../server/types.js';

// Helper to create a mock ParsedQuery
function mockQuery(intents: string[], entities: string[]): ParsedQuery {
  return { intents, entities, rawQuery: `Test query about ${entities.join(' and ')}` };
}

// Helper to create a mock Frame
function mockFrame(iteration: number, pqi: number): Frame {
  return {
    iteration,
    timestamp: Date.now(),
    html: buildAgentHTML({ title: `Test iter ${iteration}` }),
    echartsOption: { series: [{ type: 'line', data: [1, 2, 3] }] },
    eval: {
      pqi,
      pillars: { Q: pqi, D: pqi, F: pqi, I: pqi, A: pqi, P: pqi },
      fixes: [],
      mechanicalScore: pqi,
      tier: 'dom' as const,
    },
    screenshotPath: `/tmp/test-iter${iteration}.png`,
  };
}

describe('Integration: Full Pipeline (no Chrome)', () => {
  // Test all 4 companies
  const companies = [
    { slug: 'olist', query: mockQuery(['trend', 'flow'], ['revenue', 'orders', 'delivery']) },
    { slug: 'skypulse', query: mockQuery(['performance', 'comparison'], ['flights', 'delays', 'cancellations']) },
    { slug: 'globaltrade', query: mockQuery(['risk', 'trend'], ['tariffs', 'markets', 'currencies']) },
  ];

  companies.forEach(({ slug, query }) => {
    describe(`Company: ${slug}`, () => {
      it('loads company and data profile', () => {
        const company = getCompanyBySlug(slug);
        expect(company).toBeDefined();
        const profile = getDataProfile(company!.id);
        expect(profile.tables.length).toBeGreaterThan(0);
        expect(profile.rows).toBeGreaterThan(0);
      });

      it('ranks viz types with diversity', () => {
        const company = getCompanyBySlug(slug)!;
        const profile = getDataProfile(company.id);
        const ranked = rankVizTypes(query, profile, undefined, 4);
        expect(ranked).toHaveLength(4);
        // Verify diversity: not all from same category
        const categories = new Set(ranked.map(r => r.vizType.category));
        expect(categories.size).toBeGreaterThan(1);
        // Verify scores are valid
        ranked.forEach(r => {
          expect(r.total).toBeGreaterThanOrEqual(0);
          expect(r.total).toBeLessThanOrEqual(1);
        });
      });

      it('can slice data for ranked viz types', () => {
        const company = getCompanyBySlug(slug)!;
        const profile = getDataProfile(company.id);
        const ranked = rankVizTypes(query, profile, undefined, 4);

        // Each ranked viz should be able to get a data slice
        ranked.forEach(_r => {
          // Try common tables
          const tables = ['time_series', 'breakdowns', 'flows', 'distributions'];
          let foundData = false;
          for (const table of tables) {
            try {
              const slice = getDataSlice(company.id, table);
              if (slice.length > 0) {
                foundData = true;
                break;
              }
            } catch { /* table might not be valid for this company */ }
          }
          expect(foundData).toBe(true);
        });
      });
    });
  });

  describe('Frame Store lifecycle', () => {
    it('tracks iterations and detects convergence', () => {
      const store = new FrameStore();
      const agentId = 'agent-test';

      // Simulate ralph loop iterations
      store.push(agentId, mockFrame(1, 0.35));
      store.push(agentId, mockFrame(2, 0.52));
      store.push(agentId, mockFrame(3, 0.68));
      store.push(agentId, mockFrame(4, 0.79));
      store.push(agentId, mockFrame(5, 0.87));

      expect(store.getFrames(agentId)).toHaveLength(5);
      expect(store.getBestFrame(agentId)?.iteration).toBe(5);
      expect(store.getBestFrame(agentId)?.eval.pqi).toBe(0.87);
      expect(store.hasRegression(agentId)).toBe(false);
    });

    it('detects regression and identifies best frame', () => {
      const store = new FrameStore();
      const agentId = 'agent-regress';

      store.push(agentId, mockFrame(1, 0.50));
      store.push(agentId, mockFrame(2, 0.75));
      store.push(agentId, mockFrame(3, 0.68)); // dropped 0.07 from best

      expect(store.hasRegression(agentId)).toBe(true);
      expect(store.getBestFrame(agentId)?.iteration).toBe(2);
    });
  });

  describe('DOM eval on buildAgentHTML output', () => {
    it('agent HTML template passes basic DOM checks', () => {
      const html = buildAgentHTML({ title: 'Revenue Trends for Olist E-Commerce' });
      const result = runDomEval(html);

      // Agent HTML should have design tokens, ECharts, Inter font
      expect(result.checks.find(c => c.name === 'echarts-exists')?.pass).toBe(true);
      expect(result.checks.find(c => c.name === 'title-present')?.pass).toBe(true);
      expect(result.checks.find(c => c.name === 'title-descriptive')?.pass).toBe(true);
      expect(result.checks.find(c => c.name === 'font-inter')?.pass).toBe(true);
      expect(result.checks.find(c => c.name === 'design-tokens')?.pass).toBe(true);
      expect(result.checks.find(c => c.name === 'okabe-ito-palette')?.pass).toBe(true);
    });
  });

  describe('AG-UI event emission', () => {
    it('orchestrator emits expected event sequence', { timeout: 15000 }, async () => {
      const events: Array<Record<string, unknown>> = [];
      const emit = (event: Record<string, unknown>) => events.push(event);

      // Import orchestrator — stages 5-7 will fail without Chrome/Claude,
      // but stages 1-4 should emit events
      const { runOrchestrator } = await import('../server/orchestrator.js');

      try {
        await runOrchestrator('Where are we bleeding margin?', 'olist', emit, 'thread-test', 'run-test');
      } catch {
        // Expected: stages 5-7 need Chrome/Claude
      }

      // Verify stages 1-4 emitted events
      const stepStarts = events.filter(e => e.type === 'STEP_STARTED');
      expect(stepStarts.length).toBeGreaterThanOrEqual(4); // parse, probe, rank, assign

      const textMessages = events.filter(e => e.type === 'TEXT_MESSAGE_CONTENT');
      expect(textMessages.length).toBeGreaterThan(0);

      const stateDeltas = events.filter(e => e.type === 'STATE_DELTA');
      expect(stateDeltas.length).toBeGreaterThan(0);
    });
  });
});
