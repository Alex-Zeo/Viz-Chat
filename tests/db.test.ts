import { describe, it, expect, beforeAll } from 'vitest';
import {
  getCompanies,
  getCompanyBySlug,
  getDataProfile,
  getDataSlice,
} from '../server/db.js';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/demo.db');

const EXPECTED_TABLES = [
  'companies',
  'time_series',
  'breakdowns',
  'flows',
  'entities',
  'distributions',
  'events',
  'geo_metrics',
];

const EXPECTED_INDEXES = [
  'idx_ts_company_metric',
  'idx_bd_company_dimension',
  'idx_fl_company_type',
  'idx_en_company_type',
  'idx_di_company_metric',
  'idx_ev_company_type',
  'idx_gm_company_metric',
  'idx_co_slug',
];

const EXPECTED_SLUGS = [
  'olist',
  'skypulse',
  'globaltrade',
];

describe('demo.db — schema and seed data', () => {
  let db: Database.Database;

  beforeAll(() => {
    if (!existsSync(DB_PATH)) {
      throw new Error(
        `demo.db not found at ${DB_PATH}. Run: npx tsx data/seed.ts`
      );
    }
    db = new Database(DB_PATH, { readonly: true });
  });

  it('all 8 tables exist', () => {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    for (const t of EXPECTED_TABLES) {
      expect(names, `table ${t} should exist`).toContain(t);
    }
  });

  it('all 8 indexes exist', () => {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    for (const idx of EXPECTED_INDEXES) {
      expect(names, `index ${idx} should exist`).toContain(idx);
    }
  });

  it('3 companies with correct slugs', () => {
    const rows = db
      .prepare(`SELECT slug FROM companies ORDER BY slug`)
      .all() as Array<{ slug: string }>;
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toHaveLength(3);
    for (const s of EXPECTED_SLUGS) {
      expect(slugs, `slug ${s} should exist`).toContain(s);
    }
  });

  it('total row count across data tables > 2000', () => {
    let total = 0;
    for (const table of EXPECTED_TABLES.filter((t) => t !== 'companies')) {
      const row = db
        .prepare(`SELECT COUNT(*) as cnt FROM ${table}`)
        .get() as { cnt: number };
      total += row.cnt;
    }
    expect(total).toBeGreaterThan(2000);
  });

  it('time_series has 12 months of data', () => {
    const rows = db
      .prepare(
        `SELECT DISTINCT period FROM time_series WHERE company_id=1 ORDER BY period`
      )
      .all() as Array<{ period: string }>;
    // periods are like '2025-01', '2025-02', ..., '2025-12'
    const periods = rows.map((r) => r.period);
    expect(periods.length).toBeGreaterThanOrEqual(12);
  });

  it('each company has data in all 7 data tables', () => {
    const dataTables = EXPECTED_TABLES.filter((t) => t !== 'companies');
    const companies = db
      .prepare(`SELECT id, slug FROM companies`)
      .all() as Array<{ id: number; slug: string }>;
    expect(companies).toHaveLength(3);

    for (const company of companies) {
      for (const table of dataTables) {
        const row = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM ${table} WHERE company_id = ?`
          )
          .get(company.id) as { cnt: number };
        expect(
          row.cnt,
          `${company.slug} should have rows in ${table}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('time_series rows have valid metric values', () => {
    const rows = db
      .prepare(
        `SELECT metric, value FROM time_series LIMIT 100`
      )
      .all() as Array<{ metric: string; value: number }>;
    for (const row of rows) {
      expect(typeof row.metric).toBe('string');
      expect(row.metric.length).toBeGreaterThan(0);
      expect(typeof row.value).toBe('number');
      expect(isFinite(row.value)).toBe(true);
    }
  });

  it('events table has status and severity fields populated', () => {
    const rows = db
      .prepare(
        `SELECT status, event_type FROM events LIMIT 20`
      )
      .all() as Array<{ status: string; event_type: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.status).toBe('string');
    }
  });
});

describe('DB Access Layer', () => {
  it('getCompanies() returns all 4 companies', () => {
    const companies = getCompanies();
    expect(companies).toHaveLength(3);
    const slugs = companies.map((c) => c.slug);
    for (const s of EXPECTED_SLUGS) {
      expect(slugs, `slug ${s} should exist`).toContain(s);
    }
  });

  it('getCompanyBySlug() returns correct company', () => {
    const company = getCompanyBySlug('olist');
    expect(company).toBeDefined();
    expect(company!.name).toBe('Olist E-Commerce');
    expect(company!.id).toBe(1);
  });

  it('getCompanyBySlug() returns undefined for unknown slug', () => {
    const company = getCompanyBySlug('nonexistent');
    expect(company).toBeUndefined();
  });

  it('getDataProfile() returns valid profile for company 1', () => {
    const profile = getDataProfile(1);
    expect(Array.isArray(profile.tables)).toBe(true);
    expect(profile.tables.length).toBeGreaterThan(0);
    expect(profile.rows).toBeGreaterThan(0);
    expect(profile.timeRange).toBeDefined();
    expect(typeof profile.timeRange!.start).toBe('string');
    expect(typeof profile.timeRange!.end).toBe('string');
    expect(Array.isArray(profile.segments)).toBe(true);
    expect(profile.segments!.length).toBeGreaterThan(0);
    // Columns should be namespaced as "table.column"
    const colKeys = Object.keys(profile.columns);
    expect(colKeys.length).toBeGreaterThan(0);
    expect(colKeys.every((k) => k.includes('.'))).toBe(true);
  });

  it('getDataSlice() returns time_series rows for company 1', () => {
    const rows = getDataSlice(1, 'time_series');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect('company_id' in first).toBe(true);
    expect('metric' in first).toBe(true);
    expect('period' in first).toBe(true);
    expect('value' in first).toBe(true);
  });

  it('getDataSlice() with metric filter returns only matching rows', () => {
    // Get a known metric from company 1
    const allRows = getDataSlice(1, 'time_series');
    expect(allRows.length).toBeGreaterThan(0);
    const targetMetric = (allRows[0] as Record<string, unknown>)['metric'] as string;

    const filtered = getDataSlice(1, 'time_series', { metric: targetMetric });
    expect(filtered.length).toBeGreaterThan(0);
    for (const row of filtered) {
      expect((row as Record<string, unknown>)['metric']).toBe(targetMetric);
    }
  });

  it('getDataSlice() rejects invalid table names', () => {
    expect(() => getDataSlice(1, 'DROP TABLE companies')).toThrow();
    expect(() => getDataSlice(1, 'sqlite_master')).toThrow();
    expect(() => getDataSlice(1, '; SELECT 1 --')).toThrow();
  });
});
