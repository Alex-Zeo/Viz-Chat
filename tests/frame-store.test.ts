import { describe, it, expect, beforeEach } from 'vitest';
import { FrameStore } from '../server/frame-store.js';
import type { Frame, PanelEval } from '../server/types.js';

function makeEval(pqi: number): PanelEval {
  return {
    pqi,
    pillars: { Q: pqi, D: pqi, F: pqi, I: pqi, A: pqi, P: pqi },
    fixes: [],
    mechanicalScore: pqi,
    tier: 'dom',
  };
}

function makeFrame(iteration: number, pqi: number): Frame {
  return {
    iteration,
    timestamp: Date.now(),
    html: `<html>iter ${iteration}</html>`,
    echartsOption: { series: [] },
    eval: makeEval(pqi),
    screenshotPath: `/screenshots/agent-0-iter${iteration}.png`,
  };
}

describe('FrameStore', () => {
  let store: FrameStore;

  beforeEach(() => {
    store = new FrameStore();
  });

  it('stores and retrieves frames', () => {
    store.push('agent-0', makeFrame(1, 0.5));
    expect(store.getFrames('agent-0')).toHaveLength(1);
  });

  it('returns empty array for unknown agent', () => {
    expect(store.getFrames('unknown')).toHaveLength(0);
  });

  it('frames are immutable after push', () => {
    const frame = makeFrame(1, 0.5);
    store.push('agent-0', frame);
    frame.iteration = 999; // mutate original
    expect(store.getFrames('agent-0')[0].iteration).toBe(1); // stored copy unchanged
  });

  it('getBestFrame returns highest PQI', () => {
    store.push('agent-0', makeFrame(1, 0.3));
    store.push('agent-0', makeFrame(2, 0.7));
    store.push('agent-0', makeFrame(3, 0.5));
    expect(store.getBestFrame('agent-0')?.iteration).toBe(2);
  });

  it('getBestFrame returns undefined for unknown agent', () => {
    expect(store.getBestFrame('unknown')).toBeUndefined();
  });

  it('getLatestFrame returns most recent', () => {
    store.push('agent-0', makeFrame(1, 0.3));
    store.push('agent-0', makeFrame(2, 0.7));
    expect(store.getLatestFrame('agent-0')?.iteration).toBe(2);
  });

  it('getFrame returns specific iteration', () => {
    store.push('agent-0', makeFrame(1, 0.3));
    store.push('agent-0', makeFrame(2, 0.7));
    expect(store.getFrame('agent-0', 1)?.eval.pqi).toBe(0.3);
    expect(store.getFrame('agent-0', 2)?.eval.pqi).toBe(0.7);
    expect(store.getFrame('agent-0', 3)).toBeUndefined();
  });

  it('detects 5% regression', () => {
    store.push('agent-0', makeFrame(1, 0.80));
    store.push('agent-0', makeFrame(2, 0.85));
    store.push('agent-0', makeFrame(3, 0.78)); // drop of 0.07 from best (0.85) > 0.05 threshold
    expect(store.hasRegression('agent-0')).toBe(true);
  });

  it('no regression when score improves', () => {
    store.push('agent-0', makeFrame(1, 0.60));
    store.push('agent-0', makeFrame(2, 0.70));
    expect(store.hasRegression('agent-0')).toBe(false);
  });

  it('no regression with single frame', () => {
    store.push('agent-0', makeFrame(1, 0.50));
    expect(store.hasRegression('agent-0')).toBe(false);
  });

  it('tracks multiple agents independently', () => {
    store.push('agent-0', makeFrame(1, 0.5));
    store.push('agent-1', makeFrame(1, 0.8));
    expect(store.getFrames('agent-0')).toHaveLength(1);
    expect(store.getFrames('agent-1')).toHaveLength(1);
    expect(store.getBestFrame('agent-0')?.eval.pqi).toBe(0.5);
    expect(store.getBestFrame('agent-1')?.eval.pqi).toBe(0.8);
  });

  it('getAgentIds returns all registered agents', () => {
    store.push('agent-0', makeFrame(1, 0.5));
    store.push('agent-1', makeFrame(1, 0.8));
    expect(store.getAgentIds()).toEqual(expect.arrayContaining(['agent-0', 'agent-1']));
    expect(store.getAgentIds()).toHaveLength(2);
  });

  it('clear removes specific agent', () => {
    store.push('agent-0', makeFrame(1, 0.5));
    store.push('agent-1', makeFrame(1, 0.8));
    store.clear('agent-0');
    expect(store.getFrames('agent-0')).toHaveLength(0);
    expect(store.getFrames('agent-1')).toHaveLength(1);
  });
});
