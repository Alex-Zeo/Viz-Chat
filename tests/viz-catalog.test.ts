import { describe, it, expect } from 'vitest';
import {
  VIZ_CATALOG,
  getVizById,
  getVizByCategory,
  getCategories,
} from '../server/viz-catalog.js';

const EXPECTED_CATEGORIES = [
  'trends',
  'comparison',
  'distribution',
  'composition',
  'relationship',
  'flow',
  'heatmap',
  'gauge',
  'geographic',
  'geo',
];

describe('VIZ_CATALOG — catalog integrity', () => {
  it('has exactly 36 entries', () => {
    expect(VIZ_CATALOG).toHaveLength(36);
  });

  it('has no duplicate IDs', () => {
    const ids = VIZ_CATALOG.map((v) => v.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every entry has all required fields present', () => {
    for (const v of VIZ_CATALOG) {
      expect(v.id, `${v.id} missing id`).toBeTruthy();
      expect(v.name, `${v.id} missing name`).toBeTruthy();
      expect(v.category, `${v.id} missing category`).toBeTruthy();
      expect(v.echartsType, `${v.id} missing echartsType`).toBeTruthy();
      expect(v.whenToUse, `${v.id} missing whenToUse`).toBeTruthy();
      expect(v.whenToAvoid, `${v.id} missing whenToAvoid`).toBeTruthy();
      expect(v.dataRequirements, `${v.id} missing dataRequirements`).toBeDefined();
      expect(typeof v.base, `${v.id} missing base field`).toBe('boolean');
    }
  });

  it('has exactly 12 base types', () => {
    const bases = VIZ_CATALOG.filter(v => v.base);
    expect(bases).toHaveLength(12);
  });

  it('promotesTo references only valid viz IDs', () => {
    const allIds = new Set(VIZ_CATALOG.map(v => v.id));
    for (const v of VIZ_CATALOG) {
      if (v.promotesTo) {
        for (const target of v.promotesTo) {
          expect(allIds.has(target), `${v.id} promotesTo "${target}" which does not exist`).toBe(true);
        }
      }
    }
  });

  it('has exactly 10 categories totaling 36 types', () => {
    const byCat = new Map<string, number>();
    for (const v of VIZ_CATALOG) {
      byCat.set(v.category, (byCat.get(v.category) ?? 0) + 1);
    }
    expect(byCat.size).toBe(10);
    let total = 0;
    for (const [, count] of byCat) total += count;
    expect(total).toBe(36);
  });

  it('every category matches one of the 9 expected categories', () => {
    for (const v of VIZ_CATALOG) {
      expect(
        EXPECTED_CATEGORIES,
        `"${v.id}" has unexpected category "${v.category}"`
      ).toContain(v.category);
    }
  });
});

describe('VIZ_CATALOG — data quality', () => {
  it('every entry has non-empty whenToUse (>= 10 chars)', () => {
    for (const v of VIZ_CATALOG) {
      expect(
        v.whenToUse.length,
        `${v.id} whenToUse is too short`
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it('every entry has non-empty whenToAvoid (>= 10 chars)', () => {
    for (const v of VIZ_CATALOG) {
      expect(
        v.whenToAvoid.length,
        `${v.id} whenToAvoid is too short`
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it('every entry has valid dataRequirements (minSeries >= 1)', () => {
    for (const v of VIZ_CATALOG) {
      expect(
        v.dataRequirements.minSeries,
        `${v.id} dataRequirements.minSeries must be >= 1`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('when maxSeries is set, it is >= minSeries', () => {
    for (const v of VIZ_CATALOG) {
      if (v.dataRequirements.maxSeries !== undefined) {
        expect(
          v.dataRequirements.maxSeries,
          `${v.id} maxSeries must be >= minSeries`
        ).toBeGreaterThanOrEqual(v.dataRequirements.minSeries);
      }
    }
  });

  it('all IDs are valid kebab-case strings', () => {
    const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
    for (const v of VIZ_CATALOG) {
      expect(
        kebabPattern.test(v.id),
        `"${v.id}" is not valid kebab-case`
      ).toBe(true);
    }
  });
});

describe('getVizById()', () => {
  it('returns the correct viz type for a known ID', () => {
    const viz = getVizById('line');
    expect(viz).toBeDefined();
    expect(viz!.id).toBe('line');
    expect(viz!.category).toBe('trends');
    expect(viz!.name).toBe('Line Chart');
  });

  it('returns undefined for an unknown ID', () => {
    const viz = getVizById('does-not-exist');
    expect(viz).toBeUndefined();
  });

  it('returns correct type for each category representative', () => {
    const representatives: Record<string, string> = {
      'stacked-area': 'trends',
      'grouped-bar': 'comparison',
      'box-plot': 'distribution',
      treemap: 'composition',
      scatter: 'relationship',
      sankey: 'flow',
      heatmap: 'heatmap',
      gauge: 'gauge',
      choropleth: 'geographic',
      'bubble-map': 'geo',
    };
    for (const [id, expectedCat] of Object.entries(representatives)) {
      const viz = getVizById(id);
      expect(viz, `getVizById("${id}") should not be undefined`).toBeDefined();
      expect(viz!.category).toBe(expectedCat);
    }
  });
});

describe('getVizByCategory()', () => {
  it('returns entries for each known category', () => {
    for (const cat of EXPECTED_CATEGORIES) {
      const results = getVizByCategory(cat);
      expect(
        results.length,
        `getVizByCategory("${cat}") should return at least 1 entry`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns empty array for unknown category', () => {
    const results = getVizByCategory('unknown-category');
    expect(results).toHaveLength(0);
  });

  it('all returned entries have the correct category', () => {
    for (const cat of EXPECTED_CATEGORIES) {
      const results = getVizByCategory(cat);
      for (const v of results) {
        expect(v.category).toBe(cat);
      }
    }
  });
});

describe('getCategories()', () => {
  it('returns exactly 10 categories', () => {
    const cats = getCategories();
    expect(cats).toHaveLength(10);
  });

  it('includes all expected category names', () => {
    const cats = getCategories();
    for (const expected of EXPECTED_CATEGORIES) {
      expect(cats, `categories should include "${expected}"`).toContain(expected);
    }
  });

  it('returns no duplicates', () => {
    const cats = getCategories();
    const unique = new Set(cats);
    expect(unique.size).toBe(cats.length);
  });
});
