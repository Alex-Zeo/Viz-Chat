import Database from 'better-sqlite3';
import { readFileSync, createReadStream, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'demo.db');
const RAW = join(__dirname, 'raw');

// Clean slate
for (const suffix of ['', '-wal', '-shm']) {
  const f = DB_PATH + suffix;
  if (existsSync(f)) unlinkSync(f);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf-8'));

const stmt = {
  company: db.prepare('INSERT INTO companies (slug, name, sector, tagline) VALUES (?, ?, ?, ?)'),
  ts: db.prepare('INSERT INTO time_series (company_id, metric, segment, period, value, target, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  bd: db.prepare('INSERT INTO breakdowns (company_id, dimension, category, parent, value, period) VALUES (?, ?, ?, ?, ?, ?)'),
  fl: db.prepare('INSERT INTO flows (company_id, flow_type, source, target, value, period) VALUES (?, ?, ?, ?, ?, ?)'),
  en: db.prepare('INSERT INTO entities (company_id, entity_type, name, attributes) VALUES (?, ?, ?, ?)'),
  di: db.prepare('INSERT INTO distributions (company_id, metric, segment, value) VALUES (?, ?, ?, ?)'),
  ev: db.prepare('INSERT INTO events (company_id, event_type, name, started_at, ended_at, status, severity, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  gm: db.prepare('INSERT INTO geo_metrics (company_id, region, metric, value, period) VALUES (?, ?, ?, ?, ?)'),
};

function loadCsv(subdir: string, filename: string): Record<string, string>[] {
  return parse(readFileSync(join(RAW, subdir, filename)), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

function period(dateStr: string): string {
  return dateStr.substring(0, 7);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function topN<T>(map: Map<T, number>, n: number): [T, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ─── Companies ──────────────────────────────────────────
const CID_OLIST = Number(stmt.company.run(
  'olist', 'Olist E-Commerce', 'Sales & Marketing',
  'Brazilian marketplace analytics from 100K+ real orders (2016-2018)'
).lastInsertRowid);

const CID_FLIGHTS = Number(stmt.company.run(
  'skypulse', 'SkyPulse Analytics', 'Product & Operations',
  'US aviation operations intelligence from 5.8M flights (2015)'
).lastInsertRowid);

const CID_TRADE = Number(stmt.company.run(
  'globaltrade', 'GlobalTrade Insights', 'Finance',
  'Trade war impact across tariffs, equities & currencies (2018-present)'
).lastInsertRowid);

console.log('Companies: Olist=' + CID_OLIST + ', SkyPulse=' + CID_FLIGHTS + ', GlobalTrade=' + CID_TRADE);

// ═══════════════════════════════════════════════════════════
//  OLIST E-COMMERCE
// ═══════════════════════════════════════════════════════════
function seedOlist() {
  console.log('Seeding Olist...');
  const orders = loadCsv('olist', 'olist_orders_dataset.csv');
  const items = loadCsv('olist', 'olist_order_items_dataset.csv');
  const payments = loadCsv('olist', 'olist_order_payments_dataset.csv');
  const reviews = loadCsv('olist', 'olist_order_reviews_dataset.csv');
  const customers = loadCsv('olist', 'olist_customers_dataset.csv');
  const products = loadCsv('olist', 'olist_products_dataset.csv');
  const sellers = loadCsv('olist', 'olist_sellers_dataset.csv');

  const custState = new Map(customers.map(c => [c.customer_id, c.customer_state]));
  const prodCat = new Map(products.map(p => [p.product_id, p.product_category_name || 'other']));
  const sellerMap = new Map(sellers.map(s => [s.seller_id, { city: s.seller_city, state: s.seller_state }]));
  const reviewMap = new Map(reviews.map(r => [r.order_id, Number(r.review_score)]));

  const itemsByOrder = new Map<string, typeof items>();
  for (const i of items) {
    const list = itemsByOrder.get(i.order_id) ?? [];
    list.push(i);
    itemsByOrder.set(i.order_id, list);
  }

  const paysByOrder = new Map<string, typeof payments>();
  for (const p of payments) {
    const list = paysByOrder.get(p.order_id) ?? [];
    list.push(p);
    paysByOrder.set(p.order_id, list);
  }

  interface Monthly { revenue: number; orders: number; reviewSum: number; reviewN: number; delaySum: number; delayN: number }
  const zero = (): Monthly => ({ revenue: 0, orders: 0, reviewSum: 0, reviewN: 0, delaySum: 0, delayN: 0 });

  const byPeriod = new Map<string, Monthly>();
  const bySegPeriod = new Map<string, Monthly>();

  function acc(map: Map<string, Monthly>, key: string): Monthly {
    if (!map.has(key)) map.set(key, zero());
    return map.get(key)!;
  }

  const catRevenue = new Map<string, number>();
  const payTypeRevenue = new Map<string, number>();
  const stateRevenue = new Map<string, number>();
  const statusByPeriod = new Map<string, Map<string, number>>();
  const sellerRev = new Map<string, number>();
  const geoData = new Map<string, number>();
  const reviewDist = [0, 0, 0, 0, 0];
  const deliveryDays: number[] = [];
  const orderValues: number[] = [];
  const eventBuf: Parameters<typeof stmt.ev.run>[] = [];

  for (const o of orders) {
    if (!o.order_purchase_timestamp) continue;
    const p = period(o.order_purchase_timestamp);
    if (p < '2016-01') continue;

    const state = custState.get(o.customer_id) ?? 'XX';
    const paysForOrder = paysByOrder.get(o.order_id) ?? [];
    const primaryPay = paysForOrder.find(x => x.payment_sequential === '1')?.payment_type ?? 'credit_card';

    let rev = 0;
    for (const pay of paysForOrder) {
      const v = Number(pay.payment_value) || 0;
      rev += v;
      payTypeRevenue.set(pay.payment_type, (payTypeRevenue.get(pay.payment_type) ?? 0) + v);
    }

    if (rev <= 0) continue;

    const agg = acc(byPeriod, p);
    const seg = acc(bySegPeriod, primaryPay + '|' + p);
    agg.revenue += rev; agg.orders++;
    seg.revenue += rev; seg.orders++;

    orderValues.push(rev);
    stateRevenue.set(state, (stateRevenue.get(state) ?? 0) + rev);

    const gk = (m: string) => state + '|' + m + '|' + p;
    geoData.set(gk('revenue'), (geoData.get(gk('revenue')) ?? 0) + rev);
    geoData.set(gk('orders'), (geoData.get(gk('orders')) ?? 0) + 1);

    for (const it of (itemsByOrder.get(o.order_id) ?? [])) {
      const cat = prodCat.get(it.product_id) ?? 'other';
      const itRev = (Number(it.price) || 0) + (Number(it.freight_value) || 0);
      catRevenue.set(cat, (catRevenue.get(cat) ?? 0) + itRev);
      sellerRev.set(it.seller_id, (sellerRev.get(it.seller_id) ?? 0) + itRev);
    }

    const score = reviewMap.get(o.order_id);
    if (score && score >= 1 && score <= 5) {
      agg.reviewSum += score; agg.reviewN++;
      seg.reviewSum += score; seg.reviewN++;
      reviewDist[score - 1]++;

      if (score <= 2 && eventBuf.length < 60) {
        eventBuf.push([CID_OLIST, 'low_review', score + '-star review (' + o.order_id.substring(0, 8) + ')',
          o.order_purchase_timestamp, null, 'closed', score === 1 ? 'critical' : 'warning',
          JSON.stringify({ order_id: o.order_id, score, state })]);
      }
    }

    if (o.order_delivered_customer_date && o.order_purchase_timestamp) {
      const ms = new Date(o.order_delivered_customer_date).getTime() - new Date(o.order_purchase_timestamp).getTime();
      const days = ms / 86_400_000;
      if (days > 0 && days < 365) {
        agg.delaySum += days; agg.delayN++;
        seg.delaySum += days; seg.delayN++;
        deliveryDays.push(days);

        if (days > 30 && eventBuf.length < 120) {
          eventBuf.push([CID_OLIST, 'late_delivery',
            'Order ' + o.order_id.substring(0, 8) + ': ' + Math.round(days) + 'd delivery',
            o.order_purchase_timestamp, o.order_delivered_customer_date,
            'resolved', days > 60 ? 'critical' : 'warning',
            JSON.stringify({ days: Math.round(days), state })]);
        }
      }
    }

    if (!statusByPeriod.has(p)) statusByPeriod.set(p, new Map());
    const sm = statusByPeriod.get(p)!;
    sm.set(o.order_status, (sm.get(o.order_status) ?? 0) + 1);
  }

  // Drop sparse tail periods (dataset truncation artifacts)
  for (const [p, m] of byPeriod) {
    if (m.orders < 50) byPeriod.delete(p);
  }
  for (const [key] of bySegPeriod) {
    const p = key.substring(key.indexOf('|') + 1);
    if (!byPeriod.has(p)) bySegPeriod.delete(key);
  }

  db.transaction(() => {
    for (const [p, m] of byPeriod) {
      stmt.ts.run(CID_OLIST, 'revenue', null, p, round2(m.revenue), null, 'BRL');
      stmt.ts.run(CID_OLIST, 'order_count', null, p, m.orders, null, 'orders');
      stmt.ts.run(CID_OLIST, 'avg_order_value', null, p, round2(m.revenue / m.orders), null, 'BRL');
      if (m.reviewN) stmt.ts.run(CID_OLIST, 'avg_review_score', null, p, round2(m.reviewSum / m.reviewN), null, 'score');
      if (m.delayN) stmt.ts.run(CID_OLIST, 'avg_delivery_days', null, p, round2(m.delaySum / m.delayN), null, 'days');
    }
    for (const [key, m] of bySegPeriod) {
      const idx = key.indexOf('|');
      const seg = key.substring(0, idx);
      const p = key.substring(idx + 1);
      stmt.ts.run(CID_OLIST, 'revenue', seg, p, round2(m.revenue), null, 'BRL');
      stmt.ts.run(CID_OLIST, 'order_count', seg, p, m.orders, null, 'orders');
      if (m.orders) stmt.ts.run(CID_OLIST, 'avg_order_value', seg, p, round2(m.revenue / m.orders), null, 'BRL');
      if (m.reviewN) stmt.ts.run(CID_OLIST, 'avg_review_score', seg, p, round2(m.reviewSum / m.reviewN), null, 'score');
      if (m.delayN) stmt.ts.run(CID_OLIST, 'avg_delivery_days', seg, p, round2(m.delaySum / m.delayN), null, 'days');
    }
  })();

  const latestP = [...byPeriod.keys()].sort().pop()!;
  db.transaction(() => {
    for (const [cat, v] of topN(catRevenue, 20)) stmt.bd.run(CID_OLIST, 'product_category', cat, null, round2(v), latestP);
    for (const [st, v] of topN(stateRevenue, 20)) stmt.bd.run(CID_OLIST, 'customer_state', st, null, round2(v), latestP);
    for (const [pt, v] of topN(payTypeRevenue, 10)) stmt.bd.run(CID_OLIST, 'payment_type', pt, null, round2(v), latestP);
  })();

  db.transaction(() => {
    const stages = ['approved', 'invoiced', 'shipped', 'delivered'] as const;
    const periods = [...statusByPeriod.keys()].sort().slice(-6);
    for (const p of periods) {
      const sm = statusByPeriod.get(p)!;
      let prev = 'created';
      for (const s of stages) {
        const v = sm.get(s) ?? 0;
        if (v > 0) stmt.fl.run(CID_OLIST, 'order_funnel', prev, s, v, p);
        prev = s;
      }
    }
  })();

  db.transaction(() => {
    for (const [sid, rev] of topN(sellerRev, 30)) {
      const info = sellerMap.get(sid);
      stmt.en.run(CID_OLIST, 'seller', sid.substring(0, 12),
        JSON.stringify({ revenue: Math.round(rev), city: info?.city, state: info?.state }));
    }
    for (const [cat, rev] of topN(catRevenue, 25)) {
      stmt.en.run(CID_OLIST, 'product_category', cat, JSON.stringify({ revenue: Math.round(rev) }));
    }
  })();

  db.transaction(() => {
    for (let i = 0; i < 5; i++) stmt.di.run(CID_OLIST, 'review_score', String(i + 1), reviewDist[i]);

    const sorted = deliveryDays.sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 30;
    const bw = p95 / 10;
    for (let i = 0; i < 10; i++) {
      const lo = i * bw, hi = lo + bw;
      const n = sorted.filter(d => d >= lo && (i === 9 ? true : d < hi)).length;
      stmt.di.run(CID_OLIST, 'delivery_days', Math.round(lo) + '-' + Math.round(hi) + 'd', n);
    }

    const ovSorted = orderValues.sort((a, b) => a - b);
    const ovP95 = ovSorted[Math.floor(ovSorted.length * 0.95)] ?? 500;
    const ovBw = ovP95 / 10;
    for (let i = 0; i < 10; i++) {
      const lo = i * ovBw, hi = lo + ovBw;
      const n = ovSorted.filter(v => v >= lo && (i === 9 ? true : v < hi)).length;
      stmt.di.run(CID_OLIST, 'order_value', Math.round(lo) + '-' + Math.round(hi), n);
    }
  })();

  db.transaction(() => { for (const args of eventBuf) stmt.ev.run(...args); })();

  db.transaction(() => {
    for (const [key, val] of geoData) {
      const parts = key.split('|');
      stmt.gm.run(CID_OLIST, parts[0], parts[1], round2(val), parts[2]);
    }
  })();

  console.log('  Olist: ~' + (byPeriod.size * 5 + bySegPeriod.size * 5) + ' ts rows, ' + eventBuf.length + ' events');
}

// ═══════════════════════════════════════════════════════════
//  SKYPULSE - US FLIGHTS 2015
// ═══════════════════════════════════════════════════════════
async function seedFlights() {
  console.log('Seeding Flights (streaming 5.8M rows)...');

  const airlines = loadCsv('flights', 'airlines.csv');
  const airports = loadCsv('flights', 'airports.csv');

  const airlineName = new Map(airlines.map(a => [a.IATA_CODE, a.AIRLINE]));
  const airportMeta = new Map(airports.map(a => [a.IATA_CODE, {
    name: a.AIRPORT, city: a.CITY, state: a.STATE,
    lat: Number(a.LATITUDE), lon: Number(a.LONGITUDE),
  }]));

  const TOP5 = new Set(['WN', 'DL', 'AA', 'UA', 'US']);

  interface Bucket {
    flights: number; cancelled: number; onTime: number;
    delaySum: number; delayN: number;
    distSum: number; distN: number;
  }
  const fresh = (): Bucket => ({ flights: 0, cancelled: 0, onTime: 0, delaySum: 0, delayN: 0, distSum: 0, distN: 0 });

  const buckets = new Map<string, Bucket>();
  function bk(seg: string | null, p: string): Bucket {
    const k = (seg ?? '') + '|' + p;
    if (!buckets.has(k)) buckets.set(k, fresh());
    return buckets.get(k)!;
  }

  const airlineTotal = new Map<string, number>();
  const routeCount = new Map<string, number>();
  const cancelReason = new Map<string, number>();
  const dowCount = new Map<number, number>();
  const stateFlights = new Map<string, number>();
  const stateDelay = new Map<string, { sum: number; n: number }>();
  const dayCancel = new Map<string, { total: number; cancelled: number }>();
  const sampleDelays: number[] = [];
  const sampleDist: number[] = [];
  const severeEvents: Parameters<typeof stmt.ev.run>[] = [];

  let rows = 0;

  const rl = createInterface({
    input: createReadStream(join(RAW, 'flights', 'flights.csv')),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  for await (const line of rl) {
    if (rows === 0) { headers = line.split(','); rows++; continue; }
    rows++;
    const vals = line.split(',');
    const r: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) r[headers[i]] = vals[i] ?? '';

    const month = r.MONTH.padStart(2, '0');
    const p = '2015-' + month;
    const al = r.AIRLINE;
    const isCancelled = r.CANCELLED === '1';
    const delay = Number(r.ARRIVAL_DELAY);
    const dist = Number(r.DISTANCE);

    const agg = bk(null, p);
    agg.flights++;

    if (TOP5.has(al)) {
      const seg = bk(al, p);
      seg.flights++;
      if (isCancelled) seg.cancelled++;
      if (!isNaN(delay)) { seg.delaySum += delay; seg.delayN++; if (delay <= 15) seg.onTime++; }
      if (dist > 0) { seg.distSum += dist; seg.distN++; }
    }

    if (isCancelled) {
      agg.cancelled++;
      if (r.CANCELLATION_REASON) cancelReason.set(r.CANCELLATION_REASON, (cancelReason.get(r.CANCELLATION_REASON) ?? 0) + 1);
    }

    if (!isNaN(delay)) {
      agg.delaySum += delay; agg.delayN++;
      if (delay <= 15) agg.onTime++;
    }
    if (dist > 0) { agg.distSum += dist; agg.distN++; }

    airlineTotal.set(al, (airlineTotal.get(al) ?? 0) + 1);

    const route = r.ORIGIN_AIRPORT + '-' + r.DESTINATION_AIRPORT;
    routeCount.set(route, (routeCount.get(route) ?? 0) + 1);

    const dow = Number(r.DAY_OF_WEEK);
    dowCount.set(dow, (dowCount.get(dow) ?? 0) + 1);

    const originState = airportMeta.get(r.ORIGIN_AIRPORT)?.state;
    if (originState) {
      stateFlights.set(originState, (stateFlights.get(originState) ?? 0) + 1);
      if (!isNaN(delay)) {
        const sd = stateDelay.get(originState) ?? { sum: 0, n: 0 };
        sd.sum += delay; sd.n++;
        stateDelay.set(originState, sd);
      }
    }

    const dateKey = '2015-' + month + '-' + r.DAY.padStart(2, '0');
    const dc = dayCancel.get(dateKey) ?? { total: 0, cancelled: 0 };
    dc.total++; if (isCancelled) dc.cancelled++;
    dayCancel.set(dateKey, dc);

    if (rows % 1000 === 0) {
      if (!isNaN(delay)) sampleDelays.push(delay);
      if (dist > 0) sampleDist.push(dist);
    }

    if (!isNaN(delay) && delay > 240 && severeEvents.length < 80) {
      severeEvents.push([CID_FLIGHTS, 'severe_delay',
        al + r.FLIGHT_NUMBER + ' ' + r.ORIGIN_AIRPORT + '->' + r.DESTINATION_AIRPORT + ' +' + Math.round(delay) + 'm',
        dateKey, null, 'resolved', delay > 480 ? 'critical' : 'warning',
        JSON.stringify({ airline: al, flight: r.FLIGHT_NUMBER, origin: r.ORIGIN_AIRPORT, dest: r.DESTINATION_AIRPORT, delay: Math.round(delay) })]);
    }

    if (rows % 1_000_000 === 0) process.stdout.write('  ' + (rows / 1_000_000).toFixed(1) + 'M rows...\r');
  }
  console.log('  Streamed ' + (rows - 1) + ' flight records');

  db.transaction(() => {
    for (const [key, b] of buckets) {
      const idx = key.indexOf('|');
      const seg = key.substring(0, idx) || null;
      const p = key.substring(idx + 1);
      stmt.ts.run(CID_FLIGHTS, 'total_flights', seg, p, b.flights, null, 'flights');
      if (b.delayN) stmt.ts.run(CID_FLIGHTS, 'avg_arrival_delay', seg, p, round2(b.delaySum / b.delayN), null, 'min');
      if (b.flights) stmt.ts.run(CID_FLIGHTS, 'cancellation_rate', seg, p, round2(b.cancelled / b.flights * 100), null, '%');
      if (b.delayN) stmt.ts.run(CID_FLIGHTS, 'on_time_pct', seg, p, round2(b.onTime / b.delayN * 100), null, '%');
      if (b.distN) stmt.ts.run(CID_FLIGHTS, 'avg_distance', seg, p, round2(b.distSum / b.distN), null, 'mi');
    }
  })();

  db.transaction(() => {
    for (const [al, cnt] of topN(airlineTotal, 14))
      stmt.bd.run(CID_FLIGHTS, 'airline', airlineName.get(al) ?? al, null, cnt, '2015-12');
    const reasonLabel: Record<string, string> = { A: 'Carrier', B: 'Weather', C: 'NAS', D: 'Security' };
    for (const [r, cnt] of cancelReason)
      stmt.bd.run(CID_FLIGHTS, 'cancellation_reason', reasonLabel[r] ?? r, null, cnt, '2015-12');
    const dowLabel = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const [d, cnt] of dowCount)
      stmt.bd.run(CID_FLIGHTS, 'day_of_week', dowLabel[d] ?? String(d), null, cnt, '2015-12');
  })();

  db.transaction(() => {
    for (const [route, cnt] of topN(routeCount, 30)) {
      const parts = route.split('-');
      stmt.fl.run(CID_FLIGHTS, 'route', parts[0], parts[1], cnt, '2015-12');
    }
  })();

  db.transaction(() => {
    for (const [code, name] of airlineName)
      stmt.en.run(CID_FLIGHTS, 'airline', name, JSON.stringify({ iata: code, flights: airlineTotal.get(code) ?? 0 }));
    const topStates = topN(stateFlights, 20);
    for (const [st] of topStates) {
      const matching = [...airportMeta.entries()].filter(([, m]) => m.state === st).slice(0, 3);
      for (const [code, m] of matching) {
        stmt.en.run(CID_FLIGHTS, 'airport', m.name,
          JSON.stringify({ iata: code, city: m.city, state: m.state, lat: m.lat, lon: m.lon }));
      }
    }
  })();

  db.transaction(() => {
    const ds = sampleDelays.sort((a, b) => a - b);
    if (ds.length) {
      const lo = ds[Math.floor(ds.length * 0.05)];
      const hi = ds[Math.floor(ds.length * 0.95)];
      const bw = (hi - lo) / 10;
      for (let i = 0; i < 10; i++) {
        const a = lo + i * bw, b = a + bw;
        stmt.di.run(CID_FLIGHTS, 'arrival_delay', Math.round(a) + ' to ' + Math.round(b) + 'min',
          ds.filter(v => v >= a && (i === 9 ? true : v < b)).length);
      }
    }
    const dd = sampleDist.sort((a, b) => a - b);
    if (dd.length) {
      const bw = dd[dd.length - 1] / 10;
      for (let i = 0; i < 10; i++) {
        const a = i * bw, b = a + bw;
        stmt.di.run(CID_FLIGHTS, 'flight_distance', Math.round(a) + ' to ' + Math.round(b) + 'mi',
          dd.filter(v => v >= a && (i === 9 ? true : v < b)).length);
      }
    }
  })();

  db.transaction(() => {
    for (const args of severeEvents) stmt.ev.run(...args);
    for (const [date, { total, cancelled }] of dayCancel) {
      const rate = cancelled / total;
      if (rate > 0.05 && total > 10000) {
        stmt.ev.run(CID_FLIGHTS, 'mass_cancellation',
          date + ': ' + cancelled + '/' + total + ' cancelled (' + (rate * 100).toFixed(1) + '%)',
          date, null, 'resolved', rate > 0.15 ? 'critical' : 'warning',
          JSON.stringify({ total, cancelled, rate: round2(rate * 100) }));
      }
    }
  })();

  db.transaction(() => {
    for (const [st, cnt] of topN(stateFlights, 30)) {
      stmt.gm.run(CID_FLIGHTS, st, 'flights', cnt, '2015-12');
      const sd = stateDelay.get(st);
      if (sd && sd.n) stmt.gm.run(CID_FLIGHTS, st, 'avg_delay', round2(sd.sum / sd.n), '2015-12');
    }
  })();

  console.log('  Flights: ' + buckets.size + ' ts buckets, ' + severeEvents.length + ' events');
}

// ═══════════════════════════════════════════════════════════
//  GLOBALTRADE - TRADE WAR
// ═══════════════════════════════════════════════════════════
function seedTradeWar() {
  console.log('Seeding Trade War...');

  const stocks = loadCsv('favorita', 'stock_market_reaction.csv');
  const currencies = loadCsv('favorita', 'currency_impact.csv');
  const inflation = loadCsv('favorita', 'inflation_response.csv');
  const tariffs = loadCsv('favorita', 'tariff_timeline.csv');
  const sectors = loadCsv('favorita', 'sector_impact.csv');
  const tradeVol = loadCsv('favorita', 'trade_volume_annual.csv');

  interface TsBucket { sum: number; n: number }
  const ts = new Map<string, TsBucket>();
  function addTs(metric: string, seg: string | null, p: string, v: number) {
    const k = metric + '|' + (seg ?? '') + '|' + p;
    const b = ts.get(k) ?? { sum: 0, n: 0 };
    b.sum += v; b.n++;
    ts.set(k, b);
  }

  for (const r of stocks) {
    if (!r.date || !r.close) continue;
    const p = period(r.date);
    const close = Number(r.close);
    if (isNaN(close)) continue;
    addTs('market_index', null, p, close);
    addTs('market_index', r.country, p, close);
    if (r.volatility_20d) {
      const vol = Number(r.volatility_20d);
      if (!isNaN(vol)) {
        addTs('market_volatility', null, p, vol);
        addTs('market_volatility', r.country, p, vol);
      }
    }
  }

  for (const r of currencies) {
    if (!r.date || !r.rate_vs_usd) continue;
    const p = period(r.date);
    const rate = Number(r.rate_vs_usd);
    if (isNaN(rate)) continue;
    addTs('fx_rate', r.currency, p, rate);
    addTs('fx_rate', null, p, rate);
  }

  for (const r of inflation) {
    if (!r.date || !r.value || r.country !== 'USA') continue;
    const p = period(r.date);
    const v = Number(r.value);
    if (isNaN(v)) continue;
    addTs('us_cpi', null, p, v);
    addTs('us_cpi', r.category, p, v);
  }

  for (const r of tariffs) {
    if (!r.date) continue;
    const p = period(r.date);
    addTs('tariff_actions', null, p, 1);
    addTs('tariff_actions', r.target_country, p, 1);
  }

  db.transaction(() => {
    for (const [key, b] of ts) {
      const firstPipe = key.indexOf('|');
      const secondPipe = key.indexOf('|', firstPipe + 1);
      const metric = key.substring(0, firstPipe);
      const seg = key.substring(firstPipe + 1, secondPipe) || null;
      const p = key.substring(secondPipe + 1);
      const isCount = metric === 'tariff_actions';
      const val = isCount ? b.sum : round2(b.sum / b.n);
      const unit = metric === 'market_index' ? 'index' : metric === 'market_volatility' ? '%'
        : metric === 'fx_rate' ? 'rate' : metric === 'us_cpi' ? 'index' : 'actions';
      stmt.ts.run(CID_TRADE, metric, seg, p, val, null, unit);
    }
  })();

  const sectorVol = new Map<string, number>();
  for (const r of sectors) {
    if (!r.close) continue;
    const label = r.sector_label || r.sector || 'Other';
    sectorVol.set(label, (sectorVol.get(label) ?? 0) + (Number(r.volume) || 0));
  }

  const countryTariffs = new Map<string, number>();
  const tariffTypes = new Map<string, number>();
  for (const r of tariffs) {
    countryTariffs.set(r.target_country, (countryTariffs.get(r.target_country) ?? 0) + 1);
    tariffTypes.set(r.type, (tariffTypes.get(r.type) ?? 0) + 1);
  }

  const latestP = [...ts.keys()].map(k => { const i = k.lastIndexOf('|'); return k.substring(i + 1); }).sort().pop() ?? '2024-12';
  db.transaction(() => {
    for (const [s, v] of topN(sectorVol, 15)) stmt.bd.run(CID_TRADE, 'sector', s, null, v, latestP);
    for (const [c, v] of countryTariffs) stmt.bd.run(CID_TRADE, 'target_country', c, null, v, latestP);
    for (const [t, v] of tariffTypes) stmt.bd.run(CID_TRADE, 'tariff_type', t, null, v, latestP);
  })();

  const flowMap = new Map<string, number>();
  for (const r of tariffs) {
    const k = r.imposing_country + '|' + r.target_country;
    flowMap.set(k, (flowMap.get(k) ?? 0) + 1);
  }
  db.transaction(() => {
    for (const [k, v] of flowMap) {
      const parts = k.split('|');
      stmt.fl.run(CID_TRADE, 'tariff_flow', parts[0], parts[1], v, latestP);
    }
  })();

  db.transaction(() => {
    for (const r of tariffs) {
      stmt.en.run(CID_TRADE, 'tariff_action',
        r.imposing_country + ' -> ' + r.target_country + ': ' + r.sector + ' ' + r.tariff_rate_pct + '%',
        JSON.stringify({
          date: r.date, sector: r.sector, rate: Number(r.tariff_rate_pct),
          prev_rate: Number(r.prev_rate_pct), type: r.type,
          trade_value_bn: Number(r.estimated_trade_value_usd_bn) || null,
          retaliation: r.retaliation === 'True',
        }));
    }
    const uniqueCurrencies = new Set(currencies.map(c => c.currency));
    for (const cur of uniqueCurrencies) {
      const sample = currencies.find(c => c.currency === cur);
      stmt.en.run(CID_TRADE, 'currency', cur,
        JSON.stringify({ country: sample?.country, latest_rate: Number(sample?.rate_vs_usd) || null }));
    }
  })();

  db.transaction(() => {
    const rates = tariffs.map(r => Number(r.tariff_rate_pct)).filter(v => !isNaN(v) && v > 0).sort((a, b) => a - b);
    if (rates.length) {
      const max = rates[rates.length - 1];
      const bw = max / 8;
      for (let i = 0; i < 8; i++) {
        const lo = i * bw, hi = lo + bw;
        stmt.di.run(CID_TRADE, 'tariff_rate', Math.round(lo) + '-' + Math.round(hi) + '%',
          rates.filter(v => v >= lo && (i === 7 ? v <= hi : v < hi)).length);
      }
    }

    const returns = stocks.map(r => Number(r.daily_return_pct)).filter(v => !isNaN(v));
    if (returns.length) {
      const sorted = returns.sort((a, b) => a - b);
      const lo = sorted[Math.floor(sorted.length * 0.02)];
      const hi = sorted[Math.floor(sorted.length * 0.98)];
      const bw = (hi - lo) / 10;
      for (let i = 0; i < 10; i++) {
        const a = lo + i * bw, b = a + bw;
        stmt.di.run(CID_TRADE, 'daily_return', round2(a) + ' to ' + round2(b) + '%',
          sorted.filter(v => v >= a && (i === 9 ? true : v < b)).length);
      }
    }
  })();

  db.transaction(() => {
    for (const r of tariffs) {
      stmt.ev.run(CID_TRADE, 'tariff_announcement',
        r.imposing_country + ' -> ' + r.target_country + ': ' + r.sector + ' @ ' + r.tariff_rate_pct + '%',
        r.date, null, 'completed',
        Number(r.tariff_rate_pct) >= 25 ? 'critical' : 'warning',
        JSON.stringify({ sector: r.sector, rate: Number(r.tariff_rate_pct), notes: r.notes }));
    }

    const dailyReturns = new Map<string, number[]>();
    for (const r of stocks) {
      if (!r.daily_return_pct || r.country !== 'USA') continue;
      const ret = Number(r.daily_return_pct);
      if (isNaN(ret)) continue;
      const list = dailyReturns.get(r.date) ?? [];
      list.push(ret);
      dailyReturns.set(r.date, list);
    }
    let shockCount = 0;
    for (const [date, rets] of dailyReturns) {
      const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
      if (Math.abs(avg) > 2 && shockCount < 40) {
        shockCount++;
        stmt.ev.run(CID_TRADE, 'market_shock',
          'US markets ' + (avg > 0 ? '+' : '') + round2(avg) + '% on ' + date,
          date, null, 'resolved',
          Math.abs(avg) > 4 ? 'critical' : 'warning',
          JSON.stringify({ avg_return: round2(avg) }));
      }
    }
  })();

  const countryTrade = new Map<string, number>();
  for (const r of tradeVol) {
    if (r.indicator === 'NE.EXP.GNFS.CD') {
      const v = Number(r.value);
      if (!isNaN(v)) countryTrade.set(r.country, (countryTrade.get(r.country) ?? 0) + v);
    }
  }
  db.transaction(() => {
    for (const [country, v] of topN(countryTrade, 15))
      stmt.gm.run(CID_TRADE, country, 'total_exports', v, latestP);
    for (const [country, cnt] of countryTariffs)
      stmt.gm.run(CID_TRADE, country, 'tariff_actions', cnt, latestP);
  })();

  console.log('  Trade War: ' + ts.size + ' ts buckets, ' + tariffs.length + ' tariff events');
}

// ═══════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('--- Control Room Seed ---');
  const t0 = Date.now();
  seedOlist();
  await seedFlights();
  seedTradeWar();

  // Compute targets: previous period value * growth factor
  const LOWER_IS_BETTER = new Set(['avg_delivery_days', 'cancellation_rate', 'avg_arrival_delay']);
  console.log('Computing targets...');
  const allTs = db.prepare(
    'SELECT id, company_id, metric, segment, period, value FROM time_series ORDER BY company_id, metric, segment, period'
  ).all() as Array<{ id: number; company_id: number; metric: string; segment: string | null; period: string; value: number }>;

  const updateTarget = db.prepare('UPDATE time_series SET target = ? WHERE id = ?');
  db.transaction(() => {
    let prev: typeof allTs[0] | null = null;
    for (const row of allTs) {
      if (prev && prev.company_id === row.company_id && prev.metric === row.metric
        && prev.segment === row.segment) {
        const factor = LOWER_IS_BETTER.has(row.metric) ? 0.95 : 1.05;
        updateTarget.run(round2(prev.value * factor), row.id);
      }
      prev = row;
    }
  })();

  const { tgt } = db.prepare('SELECT COUNT(*) as tgt FROM time_series WHERE target IS NOT NULL').get() as { tgt: number };
  console.log('  Targets set: ' + tgt + '/' + allTs.length);

  console.log('\n--- Row Counts ---');
  for (const table of ['companies', 'time_series', 'breakdowns', 'flows', 'entities', 'distributions', 'events', 'geo_metrics']) {
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM ' + table).get() as { cnt: number };
    console.log('  ' + table + ': ' + cnt);
  }

  const companies = db.prepare('SELECT id, name FROM companies').all() as { id: number; name: string }[];
  for (const c of companies) {
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM time_series WHERE company_id = ?').get(c.id) as { cnt: number };
    const nullSeg = db.prepare('SELECT COUNT(DISTINCT metric) as cnt FROM time_series WHERE company_id = ? AND segment IS NULL').get(c.id) as { cnt: number };
    console.log('  ' + c.name + ': ' + cnt + ' ts rows, ' + nullSeg.cnt + ' metrics with null-segment');
  }

  db.close();
  console.log('\nDone in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's -> ' + DB_PATH);
}

main().catch(err => { console.error(err); process.exit(1); });
