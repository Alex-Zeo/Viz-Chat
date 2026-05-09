import { describe, it, expect } from 'vitest';
import { buildDimensions, assignDimensions } from '../server/dimension-partitioner.js';
import type { ParsedQuery, VizScore } from '../server/types.js';
import { getVizById } from '../server/viz-catalog.js';

const lineChart = getVizById('line')!;
const barChart = getVizById('bar')!;
const gauge = getVizById('gauge')!;
const pie = getVizById('pie')!;

describe('buildDimensions', () => {
  it('crosses multiple entities with categories', () => {
    const query: ParsedQuery = {
      intents: ['trend', 'performance'],
      entities: ['revenue', 'churn'],
      rawQuery: 'revenue and churn',
    };
    const dims = buildDimensions(query);
    expect(dims.length).toBeGreaterThanOrEqual(4);
    const ids = dims.map(d => d.id);
    expect(ids).toContain('revenue:trends');
    expect(ids).toContain('churn:trends');
    expect(ids).toContain('revenue:gauge');
    expect(ids).toContain('churn:gauge');
  });

  it('creates cross-entity dimensions', () => {
    const query: ParsedQuery = {
      intents: ['comparison'],
      entities: ['revenue', 'churn'],
      rawQuery: 'compare revenue and churn',
    };
    const dims = buildDimensions(query);
    const crossDims = dims.filter(d => d.entity.includes(' vs '));
    expect(crossDims.length).toBeGreaterThan(0);
  });

  it('uses category spread for single-entity queries', () => {
    const query: ParsedQuery = {
      intents: ['performance'],
      entities: ['revenue'],
      rawQuery: 'show me revenue',
    };
    const dims = buildDimensions(query);
    const categories = new Set(dims.map(d => d.category));
    expect(categories.size).toBeGreaterThanOrEqual(3);
  });
});

describe('assignDimensions', () => {
  it('assigns unique dimensions to each ranked viz', () => {
    const query: ParsedQuery = {
      intents: ['trend', 'performance'],
      entities: ['revenue', 'churn'],
      rawQuery: 'revenue and churn',
    };
    const ranked: VizScore[] = [
      { vizType: lineChart, relevance: 0.9, fit: 0.8, diversity: 1, total: 0.85 },
      { vizType: barChart, relevance: 0.8, fit: 0.7, diversity: 0.8, total: 0.75 },
      { vizType: gauge, relevance: 0.6, fit: 0.9, diversity: 1, total: 0.7 },
      { vizType: pie, relevance: 0.5, fit: 0.6, diversity: 1, total: 0.55 },
    ];
    const result = assignDimensions(ranked, query);
    const assignedIds = result.map(r => r.dimensionId);
    const uniqueIds = new Set(assignedIds);
    expect(uniqueIds.size).toBe(4);
  });

  it('populates goals with dimension-specific text', () => {
    const query: ParsedQuery = {
      intents: ['trend'],
      entities: ['revenue'],
      rawQuery: 'show me revenue',
    };
    const ranked: VizScore[] = [
      { vizType: lineChart, relevance: 0.9, fit: 0.8, diversity: 1, total: 0.85 },
      { vizType: barChart, relevance: 0.8, fit: 0.7, diversity: 0.8, total: 0.75 },
    ];
    const result = assignDimensions(ranked, query);
    expect(result[0].dimensionId).toBeDefined();
    expect(result[0].dimensionId).not.toBe(result[1].dimensionId);
  });
});
