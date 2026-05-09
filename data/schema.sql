CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  tagline TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  metric TEXT NOT NULL,
  segment TEXT,
  period TEXT NOT NULL,
  value REAL NOT NULL,
  target REAL,
  unit TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS breakdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  dimension TEXT NOT NULL,
  category TEXT NOT NULL,
  parent TEXT,
  value REAL NOT NULL,
  period TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  flow_type TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  value REAL NOT NULL,
  period TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  metric TEXT NOT NULL,
  segment TEXT,
  value REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  event_type TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT DEFAULT 'active',
  severity TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS geo_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  region TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  period TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ts_company_metric ON time_series(company_id, metric);
CREATE INDEX IF NOT EXISTS idx_bd_company_dimension ON breakdowns(company_id, dimension);
CREATE INDEX IF NOT EXISTS idx_fl_company_type ON flows(company_id, flow_type);
CREATE INDEX IF NOT EXISTS idx_en_company_type ON entities(company_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_di_company_metric ON distributions(company_id, metric);
CREATE INDEX IF NOT EXISTS idx_ev_company_type ON events(company_id, event_type);
CREATE INDEX IF NOT EXISTS idx_gm_company_metric ON geo_metrics(company_id, metric);
CREATE INDEX IF NOT EXISTS idx_co_slug ON companies(slug);
