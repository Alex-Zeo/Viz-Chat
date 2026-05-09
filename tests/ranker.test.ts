import { describe, it, expect } from 'vitest';
import {
  scoreRelevance,
  scoreFit,
  scoreDiversity,
  rankVizTypes,
} from '../server/ranker.js';
import type { VizType, ParsedQuery, DataProfile } from '../server/types.js';
import { getVizById } from '../server/viz-catalog.js';

// ─── Shared fixtures ───────────────────────────────────────────────────────

const lineChart = getVizById('line')!;
const barChart = getVizById('bar')!;
const choropleth = getVizById('choropleth')!;
const pie = getVizById('pie')!;

const trendQuery: ParsedQuery = {
  intents: ['trend'],
  entities: [],
  rawQuery: 'show me trends over time',
};

const geoQuery: ParsedQuery = {
  intents: ['geographic'],
  entities: [],
  rawQuery: 'show sales by region on a map',
};

const comparisonQuery: ParsedQuery = {
  intents: ['comparison'],
  entities: [],
  rawQuery: 'compare values across categories',
};

const emptyQuery: ParsedQuery = {
  intents: [],
  entities: [],
  rawQuery: '',
};

const timeSeriesData: DataProfile = {
  tables: ['time_series'],
  columns: {
    'time_series.id': { dtype: 'INTEGER', cardinality: 365, nullable: false },
    'time_series.period': { dtype: 'TEXT', cardinality: 12, nullable: false },
    'time_series.metric': { dtype: 'TEXT', cardinality: 5, nullable: false },
    'time_series.value': { dtype: 'REAL', cardinality: 365, nullable: false },
  },
  rows: 365,
  timeRange: { start: '2024-01-01', end: '2024-12-31' },
};

const categoricalData: DataProfile = {
  tables: ['breakdowns'],
  columns: {
    'breakdowns.id': { dtype: 'INTEGER', cardinality: 100, nullable: false },
    'breakdowns.category': { dtype: 'TEXT', cardinality: 8, nullable: false },
    'breakdowns.value': { dtype: 'REAL', cardinality: 100, nullable: false },
  },
  rows: 100,
};

const numericOnlyData: DataProfile = {
  tables: ['time_series'],
  columns: {
    'time_series.id': { dtype: 'INTEGER', cardinality: 50, nullable: false },
    'time_series.value': { dtype: 'REAL', cardinality: 50, nullable: false },
  },
  rows: 50,
};

const tinyData: DataProfile = {
  tables: ['time_series'],
  columns: {
    'time_series.id': { dtype: 'INTEGER', cardinality: 2, nullable: false },
    'time_series.value': { dtype: 'REAL', cardinality: 2, nullable: false },
  },
  rows: 2,
};

// ─── scoreRelevance ────────────────────────────────────────────────────────

describe('scoreRelevance()', () => {
  it('scores high relevance when intent matches viz whenToUse (trend → line chart)', () => {
    const score = scoreRelevance(trendQuery, lineChart);
    // "trend" intent keywords appear in line chart's whenToUse
    expect(score).toBeGreaterThan(0.5);
  });

  it('scores low relevance for completely mismatched intents (geographic → line chart)', () => {
    const score = scoreRelevance(geoQuery, lineChart);
    // "geographic" keywords don't appear in line chart's whenToUse
    expect(score).toBeLessThan(0.3);
  });

  it('scores high relevance when geographic intent matches choropleth', () => {
    const score = scoreRelevance(geoQuery, choropleth);
    expect(score).toBeGreaterThan(0.5);
  });

  it('scores neutral baseline when intents are empty', () => {
    const score = scoreRelevance(emptyQuery, lineChart);
    expect(score).toBe(0.3);
  });

  it('returns value between 0 and 1 inclusive', () => {
    const score = scoreRelevance(trendQuery, lineChart);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('entity match adds bonus relevance', () => {
    const withEntities: ParsedQuery = {
      intents: ['trend'],
      entities: ['time'],   // 'time' appears in line chart whenToUse
      rawQuery: 'show time trends',
    };
    const withoutEntities: ParsedQuery = {
      intents: ['trend'],
      entities: [],
      rawQuery: 'show trends',
    };
    const scoreWith = scoreRelevance(withEntities, lineChart);
    const scoreWithout = scoreRelevance(withoutEntities, lineChart);
    expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout);
  });

  it('multiple intents: partial match scores between 0 and 1', () => {
    const multiQuery: ParsedQuery = {
      intents: ['trend', 'geographic'],  // only 'trend' matches line chart
      entities: [],
      rawQuery: 'trend on map',
    };
    const score = scoreRelevance(multiQuery, lineChart);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ─── scoreFit ─────────────────────────────────────────────────────────────

describe('scoreFit()', () => {
  it('scores high when time series data matches line chart', () => {
    const score = scoreFit(timeSeriesData, lineChart);
    expect(score).toBeGreaterThan(0.6);
  });

  it('scores below 1.0 when time requirement is missing (no timeRange → line chart)', () => {
    const score = scoreFit(categoricalData, lineChart);
    // Line chart requiresTime but categoricalData has no timeRange — at most 3/4 checks pass
    expect(score).toBeLessThanOrEqual(0.75);
    expect(score).toBeLessThan(1.0);
  });

  it('scores bar chart with categorical + numeric data', () => {
    const score = scoreFit(categoricalData, barChart);
    expect(score).toBeGreaterThan(0.3);
  });

  it('scores low when data has far fewer rows than minDataPoints', () => {
    const score = scoreFit(tinyData, getVizById('histogram')!);
    // Histogram requires minDataPoints:20, tinyData has rows:2
    expect(score).toBeLessThan(0.8);
  });

  it('returns value between 0 and 1 inclusive', () => {
    const score = scoreFit(numericOnlyData, lineChart);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores gauge chart with numeric data present', () => {
    const score = scoreFit(numericOnlyData, getVizById('gauge')!);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── scoreDiversity ────────────────────────────────────────────────────────

describe('scoreDiversity()', () => {
  it('returns 1.0 when no same-category viz is already selected', () => {
    // lineChart is 'trends'; pass a 'comparison' viz as already selected
    const score = scoreDiversity(lineChart, [barChart]);
    expect(score).toBe(1.0);
  });

  it('penalizes when one same-category viz is already selected', () => {
    const areaChart = getVizById('area')!;
    const score = scoreDiversity(lineChart, [areaChart]);
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0);
  });

  it('penalizes more for two same-category vizzes', () => {
    const area = getVizById('area')!;
    const stackedArea = getVizById('stacked-area')!;
    const scoreOne = scoreDiversity(lineChart, [area]);
    const scoreTwo = scoreDiversity(lineChart, [area, stackedArea]);
    expect(scoreTwo).toBeLessThan(scoreOne);
  });

  it('floors at 0.0 when penalty exceeds 1.0', () => {
    const area = getVizById('area')!;
    const stackedArea = getVizById('stacked-area')!;
    const stepLine = getVizById('step-line')!;
    const anotherLine: VizType = { ...lineChart, id: 'fake-trend' };
    const score = scoreDiversity(lineChart, [area, stackedArea, stepLine, anotherLine]);
    expect(score).toBe(0);
  });

  it('returns 1.0 when alreadySelected is empty', () => {
    const score = scoreDiversity(lineChart, []);
    expect(score).toBe(1.0);
  });
});

// ─── rankVizTypes ─────────────────────────────────────────────────────────

describe('rankVizTypes()', () => {
  it('returns exactly topN results by default (4)', () => {
    const results = rankVizTypes(trendQuery, timeSeriesData);
    expect(results).toHaveLength(4);
  });

  it('returns exactly topN results when explicitly specified', () => {
    const results = rankVizTypes(trendQuery, timeSeriesData, undefined, 3);
    expect(results).toHaveLength(3);
  });

  it('returns fewer results than topN when catalog is smaller', () => {
    const smallCatalog = [lineChart, barChart];
    const results = rankVizTypes(trendQuery, timeSeriesData, smallCatalog, 5);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('diversifies across categories — top 4 should not all be from the same category', () => {
    const results = rankVizTypes(trendQuery, timeSeriesData);
    const categories = new Set(results.map((r) => r.vizType.category));
    expect(categories.size).toBeGreaterThan(1);
  });

  it('handles empty intents — still returns topN results', () => {
    const results = rankVizTypes(emptyQuery, categoricalData);
    expect(results).toHaveLength(4);
  });

  it('total score includes relevance, fit, and diversity components', () => {
    const results = rankVizTypes(comparisonQuery, categoricalData);
    for (const r of results) {
      expect(r.relevance).toBeGreaterThanOrEqual(0);
      expect(r.fit).toBeGreaterThanOrEqual(0);
      expect(r.diversity).toBeGreaterThanOrEqual(0);
      expect(typeof r.total).toBe('number');
    }
  });

  it('component scores are in [0, 1]', () => {
    const results = rankVizTypes(geoQuery, timeSeriesData);
    for (const r of results) {
      expect(r.relevance).toBeGreaterThanOrEqual(0);
      expect(r.relevance).toBeLessThanOrEqual(1);
      expect(r.fit).toBeGreaterThanOrEqual(0);
      expect(r.fit).toBeLessThanOrEqual(1);
      expect(r.diversity).toBeGreaterThanOrEqual(0);
      expect(r.diversity).toBeLessThanOrEqual(1);
    }
  });

  it('no duplicate viz types in results', () => {
    const results = rankVizTypes(trendQuery, timeSeriesData);
    const ids = results.map((r) => r.vizType.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('accepts a custom catalog subset', () => {
    const customCatalog = [lineChart, barChart, pie];
    const results = rankVizTypes(trendQuery, timeSeriesData, customCatalog, 2);
    expect(results).toHaveLength(2);
    const allFromCatalog = results.every((r) =>
      customCatalog.some((v) => v.id === r.vizType.id)
    );
    expect(allFromCatalog).toBe(true);
  });

  it('trend query on time-series data puts line/area chart in top results', () => {
    const results = rankVizTypes(trendQuery, timeSeriesData);
    const topIds = results.map((r) => r.vizType.id);
    const hasTrendViz = topIds.some((id) =>
      ['line', 'area', 'stacked-area', 'step-line'].includes(id)
    );
    expect(hasTrendViz).toBe(true);
  });

  it('each result has a unique dimensionId (hard dimension constraint)', () => {
    const results = rankVizTypes(trendQuery, timeSeriesData);
    const dimIds = results.map((r) => r.dimensionId);
    expect(dimIds.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    const unique = new Set(dimIds);
    expect(unique.size).toBe(results.length);
  });

  it('each result has a non-empty dimensionGoal string', () => {
    const results = rankVizTypes(comparisonQuery, categoricalData);
    expect(results.every(r => typeof r.dimensionGoal === 'string' && r.dimensionGoal.length > 0)).toBe(true);
  });

  it('dimensionId uniqueness holds across multiple query types', () => {
    for (const [query, data] of [
      [trendQuery, timeSeriesData],
      [comparisonQuery, categoricalData],
      [geoQuery, timeSeriesData],
      [emptyQuery, categoricalData],
    ] as const) {
      const results = rankVizTypes(query, data);
      const dimIds = results.map(r => r.dimensionId);
      const unique = new Set(dimIds);
      expect(unique.size).toBe(results.length);
    }
  });
});
