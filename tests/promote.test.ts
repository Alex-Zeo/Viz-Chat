import { describe, it, expect } from 'vitest';
import { promoteVizTypes } from '../server/promote.js';
import { getVizById } from '../server/viz-catalog.js';
import type { VizScore, DataProfile, ParsedQuery } from '../server/types.js';

function makeQuery(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return { intents: [], entities: [], rawQuery: '', ...overrides };
}

function makeProfile(overrides: Partial<DataProfile> = {}): DataProfile {
  return {
    tables: ['time_series'],
    columns: {
      'time_series.value': { dtype: 'REAL', cardinality: 50, nullable: false },
    },
    rows: 50,
    ...overrides,
  };
}

function makeScore(vizId: string): VizScore {
  const vt = getVizById(vizId)!;
  return { vizType: vt, relevance: 0.8, fit: 0.7, diversity: 1, total: 0.8, dimensionId: vizId, dimensionGoal: 'test' };
}

describe('promoteVizTypes() — line promotions', () => {
  it('line → stacked-area when composition intent + segments >= 2', () => {
    const ranked = [makeScore('line')];
    const data = makeProfile({ segments: ['a', 'b'] });
    const query = makeQuery({ intents: ['composition'] });
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('stacked-area');
  });

  it('line → area when segments <= 1 and rows >= 6', () => {
    const ranked = [makeScore('line')];
    const data = makeProfile({ rows: 10 });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('area');
  });

  it('line → step-line when query mentions discrete/step keywords', () => {
    const ranked = [makeScore('line')];
    const data = makeProfile({ rows: 2 });
    const query = makeQuery({ rawQuery: 'show tier changes over time' });
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('step-line');
  });

  it('line stays line when rows < 6 and no keyword match', () => {
    const ranked = [makeScore('line')];
    const data = makeProfile({ rows: 3 });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('line');
  });
});

describe('promoteVizTypes() — bar promotions', () => {
  it('bar → horizontal-bar when category cardinality > 10', () => {
    const ranked = [makeScore('bar')];
    const data = makeProfile({
      columns: { 'breakdowns.category': { dtype: 'TEXT', cardinality: 15, nullable: false } },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('horizontal-bar');
  });

  it('bar → stacked-bar when composition intent', () => {
    const ranked = [makeScore('bar')];
    const data = makeProfile();
    const query = makeQuery({ intents: ['composition'] });
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('stacked-bar');
  });

  it('bar → grouped-bar when 2-5 segments', () => {
    const ranked = [makeScore('bar')];
    const data = makeProfile({ segments: ['a', 'b', 'c'] });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('grouped-bar');
  });
});

describe('promoteVizTypes() — pie promotions', () => {
  it('pie → sunburst when 2+ category/subcategory columns', () => {
    const ranked = [makeScore('pie')];
    const data = makeProfile({
      columns: {
        'breakdowns.category': { dtype: 'TEXT', cardinality: 5, nullable: false },
        'breakdowns.subcategory': { dtype: 'TEXT', cardinality: 10, nullable: false },
      },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('sunburst');
  });

  it('pie → donut as default fallthrough', () => {
    const ranked = [makeScore('pie')];
    const data = makeProfile();
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('donut');
  });
});

describe('promoteVizTypes() — scatter promotions', () => {
  it('scatter → bubble when 3+ numeric columns', () => {
    const ranked = [makeScore('scatter')];
    const data = makeProfile({
      columns: {
        'entities.x': { dtype: 'REAL', cardinality: 50, nullable: false },
        'entities.y': { dtype: 'REAL', cardinality: 50, nullable: false },
        'entities.size': { dtype: 'INTEGER', cardinality: 20, nullable: false },
      },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('bubble');
  });

  it('scatter stays scatter when < 3 numeric columns', () => {
    const ranked = [makeScore('scatter')];
    const data = makeProfile({
      columns: {
        'entities.x': { dtype: 'REAL', cardinality: 50, nullable: false },
        'entities.y': { dtype: 'TEXT', cardinality: 10, nullable: false },
      },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('scatter');
  });
});

describe('promoteVizTypes() — histogram promotions', () => {
  it('histogram → box-plot when segments >= 3', () => {
    const ranked = [makeScore('histogram')];
    const data = makeProfile({ segments: ['a', 'b', 'c'] });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('box-plot');
  });

  it('histogram → violin when rows >= 50 and segments >= 2', () => {
    const ranked = [makeScore('histogram')];
    const data = makeProfile({ rows: 60, segments: ['a', 'b'] });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('violin');
  });

  it('histogram → density when rows >= 30 and no segments', () => {
    const ranked = [makeScore('histogram')];
    const data = makeProfile({ rows: 35 });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('density');
  });
});

describe('promoteVizTypes() — funnel promotions', () => {
  it('funnel → sankey when flows table present', () => {
    const ranked = [makeScore('funnel')];
    const data = makeProfile({ tables: ['flows'] });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('sankey');
  });

  it('funnel → waterfall on bridge/incremental keywords', () => {
    const ranked = [makeScore('funnel')];
    const data = makeProfile();
    const query = makeQuery({ rawQuery: 'show the incremental contributions' });
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('waterfall');
  });
});

describe('promoteVizTypes() — heatmap promotions', () => {
  it('heatmap → calendar-heatmap when timeRange present and rows >= 28', () => {
    const ranked = [makeScore('heatmap')];
    const data = makeProfile({ timeRange: { start: '2025-01', end: '2025-12' }, rows: 30 });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('calendar-heatmap');
  });

  it('heatmap → matrix when 2+ TEXT columns and no timeRange', () => {
    const ranked = [makeScore('heatmap')];
    const data = makeProfile({
      columns: {
        'breakdowns.category': { dtype: 'TEXT', cardinality: 5, nullable: false },
        'breakdowns.metric': { dtype: 'TEXT', cardinality: 8, nullable: false },
      },
      rows: 10,
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('matrix');
  });

  it('heatmap → cluster-heatmap when rows >= 20 and no other match', () => {
    const ranked = [makeScore('heatmap')];
    const data = makeProfile({
      columns: { 'breakdowns.value': { dtype: 'REAL', cardinality: 20, nullable: false } },
      rows: 25,
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('cluster-heatmap');
  });
});

describe('promoteVizTypes() — kpi-card promotions', () => {
  it('kpi-card → gauge when query mentions threshold/range', () => {
    const ranked = [makeScore('kpi-card')];
    const data = makeProfile();
    const query = makeQuery({ rawQuery: 'show the threshold ranges' });
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('gauge');
  });

  it('kpi-card → bullet when target column present', () => {
    const ranked = [makeScore('kpi-card')];
    const data = makeProfile({
      columns: {
        'time_series.value': { dtype: 'REAL', cardinality: 12, nullable: false },
        'time_series.target': { dtype: 'REAL', cardinality: 12, nullable: false },
      },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('bullet');
  });

  it('kpi-card → progress on progress/completion keywords', () => {
    const ranked = [makeScore('kpi-card')];
    const data = makeProfile();
    const query = makeQuery({ rawQuery: 'show goal completion progress' });
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('progress');
  });
});

describe('promoteVizTypes() — choropleth promotions', () => {
  it('choropleth → bubble-map when geo_metrics.region cardinality > 10', () => {
    const ranked = [makeScore('choropleth')];
    const data = makeProfile({
      tables: ['geo_metrics'],
      columns: { 'geo_metrics.region': { dtype: 'TEXT', cardinality: 15, nullable: false } },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('bubble-map');
  });

  it('choropleth → flow-map when flows table present', () => {
    const ranked = [makeScore('choropleth')];
    const data = makeProfile({ tables: ['flows'] });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('flow-map');
  });

  it('choropleth → point-map when lat column present', () => {
    const ranked = [makeScore('choropleth')];
    const data = makeProfile({
      columns: { 'geo_metrics.lat': { dtype: 'REAL', cardinality: 30, nullable: false } },
    });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.vizType.id).toBe('point-map');
  });
});

describe('promoteVizTypes() — passthrough behavior', () => {
  it('standalone base types pass through unchanged', () => {
    for (const id of ['radar', 'treemap', 'chord']) {
      const ranked = [makeScore(id)];
      const data = makeProfile();
      const query = makeQuery();
      const [result] = promoteVizTypes(ranked, data, query);
      expect(result.vizType.id).toBe(id);
    }
  });

  it('preserves scores and metadata from input', () => {
    const ranked = [makeScore('line')];
    const data = makeProfile({ rows: 10 });
    const query = makeQuery();
    const [result] = promoteVizTypes(ranked, data, query);
    expect(result.relevance).toBe(0.8);
    expect(result.fit).toBe(0.7);
    expect(result.diversity).toBe(1);
    expect(result.dimensionId).toBe('line');
  });

  it('handles multiple ranked entries independently', () => {
    const ranked = [makeScore('line'), makeScore('bar'), makeScore('radar')];
    const data = makeProfile({ rows: 10 });
    const query = makeQuery();
    const results = promoteVizTypes(ranked, data, query);
    expect(results[0].vizType.id).toBe('area');
    expect(results[2].vizType.id).toBe('radar');
  });
});
