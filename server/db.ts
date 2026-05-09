import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Company, DataProfile } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'demo.db');

// Known data tables (excludes 'companies')
const DATA_TABLES = [
  'time_series',
  'breakdowns',
  'flows',
  'entities',
  'distributions',
  'events',
  'geo_metrics',
] as const;

type DataTable = typeof DATA_TABLES[number];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
  }
  return db;
}

export function getCompanies(): Company[] {
  return getDb()
    .prepare('SELECT * FROM companies ORDER BY id')
    .all() as Company[];
}

export function getCompanyBySlug(slug: string): Company | undefined {
  return getDb()
    .prepare('SELECT * FROM companies WHERE slug = ?')
    .get(slug) as Company | undefined;
}

export function getDataProfile(companyId: number): DataProfile {
  const database = getDb();

  // Determine which data tables have rows for this company
  const populatedTables: DataTable[] = [];
  for (const table of DATA_TABLES) {
    const row = database
      .prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE company_id = ?`)
      .get(companyId) as { cnt: number };
    if (row.cnt > 0) {
      populatedTables.push(table);
    }
  }

  // Build columns map: namespace as "<table>.<column>"
  const columns: DataProfile['columns'] = {};
  for (const table of populatedTables) {
    const tableInfo = database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string; type: string; notnull: number }>;

    for (const col of tableInfo) {
      const key = `${table}.${col.name}`;
      // Count distinct non-null values for this column scoped to company
      const cardinalityRow = database
        .prepare(
          `SELECT COUNT(DISTINCT ${col.name}) as cnt FROM ${table} WHERE company_id = ?`
        )
        .get(companyId) as { cnt: number };

      columns[key] = {
        dtype: col.type || 'TEXT',
        cardinality: cardinalityRow.cnt,
        nullable: col.notnull === 0,
      };
    }
  }

  // Total row count across all populated tables
  let rows = 0;
  for (const table of populatedTables) {
    const row = database
      .prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE company_id = ?`)
      .get(companyId) as { cnt: number };
    rows += row.cnt;
  }

  // Time range from time_series (if present for this company)
  let timeRange: DataProfile['timeRange'];
  if (populatedTables.includes('time_series')) {
    const tr = database
      .prepare(
        `SELECT MIN(period) as start, MAX(period) as end FROM time_series WHERE company_id = ?`
      )
      .get(companyId) as { start: string | null; end: string | null };
    if (tr.start && tr.end) {
      timeRange = { start: tr.start, end: tr.end };
    }
  }

  // Distinct non-null segment values from time_series
  let segments: DataProfile['segments'];
  if (populatedTables.includes('time_series')) {
    const segRows = database
      .prepare(
        `SELECT DISTINCT segment FROM time_series WHERE company_id = ? AND segment IS NOT NULL ORDER BY segment`
      )
      .all(companyId) as Array<{ segment: string }>;
    if (segRows.length > 0) {
      segments = segRows.map((r) => r.segment);
    }
  }

  return {
    tables: populatedTables,
    columns,
    rows,
    ...(timeRange ? { timeRange } : {}),
    ...(segments ? { segments } : {}),
  };
}

export interface KpiContext {
  metric: string;
  currentValue: number;
  currentPeriod: string;
  previousValue: number | null;
  previousPeriod: string | null;
  momDelta: number | null;
  momPct: number | null;
  yoyValue: number | null;
  yoyPeriod: string | null;
  yoyDelta: number | null;
  yoyPct: number | null;
  target: number | null;
}

export function getKpiContext(companyId: number): KpiContext[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT metric, period, value, target, segment
       FROM time_series
       WHERE company_id = ? AND segment IS NULL
       ORDER BY metric, period DESC`
    )
    .all(companyId) as Array<{ metric: string; period: string; value: number; target: number | null; segment: string | null }>;

  const byMetric = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byMetric.get(row.metric) ?? [];
    existing.push(row);
    byMetric.set(row.metric, existing);
  }

  const results: KpiContext[] = [];
  for (const [metric, metricRows] of byMetric) {
    if (metricRows.length === 0) continue;
    const current = metricRows[0];
    const previous = metricRows.length >= 2 ? metricRows[1] : null;

    const [yyyy, mm] = current.period.split('-');
    const yoyPeriod = `${Number(yyyy) - 1}-${mm}`;
    const yoyRow = metricRows.find(r => r.period === yoyPeriod) ?? null;

    results.push({
      metric,
      currentValue: current.value,
      currentPeriod: current.period,
      previousValue: previous?.value ?? null,
      previousPeriod: previous?.period ?? null,
      momDelta: previous ? current.value - previous.value : null,
      momPct: previous && previous.value !== 0
        ? ((current.value - previous.value) / Math.abs(previous.value)) * 100
        : null,
      yoyValue: yoyRow?.value ?? null,
      yoyPeriod: yoyRow ? yoyPeriod : null,
      yoyDelta: yoyRow ? current.value - yoyRow.value : null,
      yoyPct: yoyRow && yoyRow.value !== 0
        ? ((current.value - yoyRow.value) / Math.abs(yoyRow.value)) * 100
        : null,
      target: current.target,
    });
  }

  return results;
}

export function getDataSlice(
  companyId: number,
  table: string,
  filters?: Record<string, string>
): Record<string, unknown>[] {
  // Whitelist table names to prevent SQL injection
  if (!(DATA_TABLES as readonly string[]).includes(table)) {
    throw new Error(
      `Invalid table name: "${table}". Allowed tables: ${DATA_TABLES.join(', ')}`
    );
  }

  const safeTable = table as DataTable;
  const database = getDb();

  // If filters provided, whitelist column names via PRAGMA table_info
  let whereClauses = 'company_id = ?';
  const bindings: unknown[] = [companyId];

  if (filters && Object.keys(filters).length > 0) {
    // Get valid columns for this table
    const tableInfo = database
      .prepare(`PRAGMA table_info(${safeTable})`)
      .all() as Array<{ name: string }>;
    const validColumns = new Set(tableInfo.map((c) => c.name));

    for (const [col, val] of Object.entries(filters)) {
      if (!validColumns.has(col)) {
        throw new Error(
          `Invalid column name: "${col}" for table "${safeTable}"`
        );
      }
      if (val === '' || val === 'null' || val === 'NULL') {
        whereClauses += ` AND ${col} IS NULL`;
      } else {
        whereClauses += ` AND ${col} = ?`;
        bindings.push(val);
      }
    }
  }

  return database
    .prepare(`SELECT * FROM ${safeTable} WHERE ${whereClauses}`)
    .all(...bindings) as Record<string, unknown>[];
}
