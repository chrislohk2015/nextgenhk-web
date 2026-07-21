/**
 * Nextgen Resources — live price Worker (Cloudflare)
 * ---------------------------------------------------------
 * GET /prices   ← the endpoint the website uses.
 *   Aggregates live precious-metal quotes server-side and returns JSON in
 *   the exact shape the site's price board consumes:
 *     { LLG:{bid,ask,high,low,close}, HKG:{...}, LLS, PT, PD, "UST/T" }
 *
 *   Sources (all fetched server-side, where browser CORS does not apply):
 *     - Swissquote public quotes  → real bid/ask for XAU/XAG/XPT/XPD
 *     - Stooq                     → day open/high/low/last + USD/HKD
 *     - Stooq daily history       → previous close (for the Change column)
 *   HKG (Hong Kong 99 tael gold, HKD/tael) is derived from spot:
 *     XAU/USD × USD/HKD × 1.20337 oz-per-tael × 0.99 fineness.
 *   Every source is best-effort: if one fails, the fields it feeds are
 *   omitted and the site shows "—" there instead of breaking.
 *
 * GET /?u=<url> ← legacy relay (host-allowlisted), kept for debugging.
 *
 * Deploy: see README.md in this folder.
 */

const ALLOWED_HOSTS = new Set([
  'mq1.wfgold.com',
  'stooq.com',
  'forex-data-feed.swissquote.com',
  'query1.finance.yahoo.com',
  'open.er-api.com',
]);

const QUOTE_CACHE_SECONDS = 10;    // edge cache for live quotes
const HISTORY_CACHE_SECONDS = 3600; // edge cache for previous-close lookups

// Instrument map: site code → sources + decimals.
// Yahoo's chart API 404s on spot metal symbols (XAUUSD=X etc.) but serves
// the front-month futures (GC=F, SI=F, PL=F, PA=F). Futures carry a small
// premium over spot, so `scale: true` re-anchors their high/low/prevClose
// to the live Swissquote spot mid before use (percent moves are ~identical).
const INSTRUMENTS = {
  'LLG':   { stooq: 'xauusd', sq: 'XAU/USD', yahoo: 'GC=F',  scale: true, dp: 1 },
  'LLS':   { stooq: 'xagusd', sq: 'XAG/USD', yahoo: 'SI=F',  scale: true, dp: 3 },
  'PT':    { stooq: 'xptusd', sq: 'XPT/USD', yahoo: 'PL=F',  scale: true, dp: 1 },
  'PD':    { stooq: 'xpdusd', sq: 'XPD/USD', yahoo: 'PA=F',  scale: true, dp: 1 },
  'UST/T': { stooq: 'usdhkd', sq: null,      yahoo: 'HKD=X',              dp: 4 },
};

// HK 99-tael gold derivation constants
const OZ_PER_TAEL = 1.20337; // 1 tael = 37.429 g ÷ 31.1035 g/ozt (CGSE)
const FINENESS_99 = 0.99;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${QUOTE_CACHE_SECONDS}`,
    },
  });
}

// Some upstreams (notably Yahoo) reject obviously non-browser user agents.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchText(url, cacheTtl) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    cf: { cacheTtl, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/* ---------------- Stooq: multi-symbol light CSV ----------------
 * https://stooq.com/q/l/?s=a+b+c&f=sd2t2ohlcv&h&e=csv
 * Symbol,Date,Time,Open,High,Low,Close,Volume  (Close = last trade)
 */
export function parseStooqLight(csv) {
  const out = {};
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const c = line.split(',');
    if (c.length < 7) continue;
    const sym = c[0].trim().toLowerCase();
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    out[sym] = {
      date: c[1].trim(),
      open: num(c[3]), high: num(c[4]), low: num(c[5]), last: num(c[6]),
    };
  }
  return out;
}

/* ---------------- Stooq: daily history CSV → previous close ----------
 * https://stooq.com/q/d/l/?s=xauusd&i=d&d1=YYYYMMDD&d2=YYYYMMDD
 * Date,Open,High,Low,Close,Volume — take the latest row strictly before
 * `beforeDate` (the current quote date).
 */
export function parsePrevClose(csv, beforeDate) {
  let prev = null;
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const c = line.split(',');
    if (c.length < 5) continue;
    const d = c[0].trim();
    const close = parseFloat(c[4]);
    if (isNaN(close)) continue;
    if (!beforeDate || d < beforeDate) prev = close; // rows are oldest→newest
  }
  return prev;
}

/* ---------------- Swissquote: real bid/ask ---------------------------
 * Array of platforms; each has spreadProfilePrices [{spreadProfile,bid,ask}].
 * Prefer the tightest (prime) profile of the first platform that has one.
 */
export function parseSwissquote(jsonBody) {
  let arr;
  try { arr = JSON.parse(jsonBody); } catch (_) { return null; }
  if (!Array.isArray(arr)) return null;
  for (const platform of arr) {
    const profiles = platform && platform.spreadProfilePrices;
    if (!Array.isArray(profiles) || profiles.length === 0) continue;
    const prefOrder = ['prime', 'premium', 'standard'];
    let best = null;
    for (const want of prefOrder) {
      best = profiles.find(p => String(p.spreadProfile).toLowerCase() === want);
      if (best) break;
    }
    best = best || profiles[0];
    const bid = parseFloat(best.bid), ask = parseFloat(best.ask);
    if (!isNaN(bid) && !isNaN(ask)) return { bid, ask };
  }
  return null;
}

/* ---------------- Yahoo Finance chart meta (fallback) -----------------
 * https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X?range=1d&interval=1d
 * The meta block carries last price, day high/low and previous close.
 */
export function parseYahoo(body) {
  try {
    const meta = JSON.parse(body)?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const n = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
    return {
      last: n(meta.regularMarketPrice),
      high: n(meta.regularMarketDayHigh),
      low:  n(meta.regularMarketDayLow),
      prevClose: n(meta.chartPreviousClose ?? meta.previousClose),
    };
  } catch (_) { return null; }
}

/* open.er-api.com daily FX (last-resort for USD/HKD) */
export function parseErApi(body) {
  try {
    const j = JSON.parse(body);
    const r = j && j.rates && j.rates.HKD;
    return (typeof r === 'number' && isFinite(r)) ? r : null;
  } catch (_) { return null; }
}

const fix = (n, dp) => (n === null || n === undefined || isNaN(n)) ? undefined : n.toFixed(dp);

/* Build one instrument's payload from its sources (all optional).
 * Priority: Swissquote bid/ask > Stooq last > Yahoo last;
 *           Stooq range/close > Yahoo range/prevClose.
 * `scale`: Yahoo data is futures — re-anchor it to the Swissquote spot mid
 * so the Change/Range columns are consistent with the displayed bid/ask. */
export function buildInstrument({ sq, st, ya, prevClose, dp, scale }) {
  const o = {};
  const pick = (...vals) => {
    for (const v of vals) if (v !== null && v !== undefined && !isNaN(v)) return v;
    return null;
  };
  if (scale && sq && ya && ya.last) {
    const k = ((sq.bid + sq.ask) / 2) / ya.last;
    if (isFinite(k) && k > 0) {
      ya = {
        last: ya.last * k,
        high: ya.high !== null ? ya.high * k : null,
        low: ya.low !== null ? ya.low * k : null,
        prevClose: ya.prevClose !== null ? ya.prevClose * k : null,
      };
    }
  }
  const bid = pick(sq && sq.bid, st && st.last, ya && ya.last);
  const ask = pick(sq && sq.ask, st && st.last, ya && ya.last);
  const high = pick(st && st.high, ya && ya.high);
  const low = pick(st && st.low, ya && ya.low);
  const close = pick(prevClose, ya && ya.prevClose);
  if (bid !== null) o.bid = fix(bid, dp);
  if (ask !== null) o.ask = fix(ask, dp);
  if (high !== null) o.high = fix(high, dp);
  if (low !== null) o.low = fix(low, dp);
  if (close !== null) o.close = fix(close, dp);
  return o;
}

/* Derive HK 99-tael gold (HKD/tael) from XAU/USD and USD/HKD. */
export function deriveHKG(llg, fx) {
  const f = (v) => v === undefined ? null : parseFloat(v);
  const k = OZ_PER_TAEL * FINENESS_99;
  const fxBid = f(fx.bid), fxAsk = f(fx.ask);
  const o = {};
  const put = (key, gold, rate) => {
    const g = f(gold);
    if (g !== null && rate !== null && !isNaN(rate)) o[key] = (g * rate * k).toFixed(0);
  };
  put('bid', llg.bid, fxBid);
  put('ask', llg.ask, fxAsk !== null ? fxAsk : fxBid);
  put('high', llg.high, fxAsk !== null ? fxAsk : fxBid);
  put('low', llg.low, fxBid);
  put('close', llg.close, fxBid);
  return o;
}

async function handlePrices() {
  const codes = Object.keys(INSTRUMENTS);
  const stooqSyms = codes.map(c => INSTRUMENTS[c].stooq);

  // Per-upstream outcome map, reported in _meta.sources for diagnosis.
  // 'ok' = fetched and parsed; 'parse-null' = fetched but no usable data;
  // anything else = the fetch error (HTTP status etc.).
  const src = {};
  const grab = (tag, url, ttl, parse) =>
    fetchText(url, ttl)
      .then((body) => {
        const parsed = parse(body);
        src[tag] = (parsed === null || (typeof parsed === 'object' && Object.keys(parsed).length === 0))
          ? 'parse-null' : 'ok';
        return parsed;
      })
      .catch((e) => { src[tag] = String(e.message || e).slice(0, 60); return null; });

  // Tier 1 (parallel): Swissquote bid/ask + Stooq quotes/history.
  const lightP = grab('stooq-light',
    `https://stooq.com/q/l/?s=${stooqSyms.join('+')}&f=sd2t2ohlcv&h&e=csv`,
    QUOTE_CACHE_SECONDS, parseStooqLight).then(r => r || {});

  const sqP = {};
  for (const c of codes) {
    const inst = INSTRUMENTS[c];
    sqP[c] = inst.sq
      ? grab('sq:' + c,
          `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${inst.sq}`,
          QUOTE_CACHE_SECONDS, parseSwissquote)
      : Promise.resolve(null);
  }

  const now = new Date();
  const d2 = now.toISOString().slice(0, 10).replace(/-/g, '');
  const d1 = new Date(now.getTime() - 10 * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
  const histP = {};
  for (const c of codes) {
    // Validate the CSV header — Stooq answers 200 with a rate-limit message
    // when it refuses, which must count as parse-null, not ok.
    histP[c] = grab('hist:' + INSTRUMENTS[c].stooq,
      `https://stooq.com/q/d/l/?s=${INSTRUMENTS[c].stooq}&i=d&d1=${d1}&d2=${d2}`,
      HISTORY_CACHE_SECONDS, (t) => (/^Date,Open,High,Low,Close/i.test(String(t).trim()) ? t : null));
  }

  const light = await lightP;

  // Tier 2: Yahoo chart meta for anything Stooq didn't cover (range, prev
  // close, FX). Only fired for the gaps, in parallel.
  const yaP = {};
  for (const c of codes) {
    const inst = INSTRUMENTS[c];
    const st = light[inst.stooq];
    const needYahoo = !st || st.high === null || st.low === null || !st.last;
    yaP[c] = (needYahoo && inst.yahoo)
      ? grab('yahoo:' + inst.yahoo,
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo)}?range=5d&interval=1d`,
          QUOTE_CACHE_SECONDS, parseYahoo)
      : Promise.resolve(null);
  }

  const out = { _meta: { ts: now.toISOString(), source: 'swissquote+stooq+yahoo', sources: src } };

  for (const c of codes) {
    const inst = INSTRUMENTS[c];
    const st = light[inst.stooq] || null;
    const sq = await sqP[c];
    const ya = await yaP[c];
    const histCsv = await histP[c];
    const prevClose = histCsv ? parsePrevClose(histCsv, st ? st.date : null) : null;
    out[c] = buildInstrument({ sq, st, ya, prevClose, dp: inst.dp, scale: inst.scale });
  }

  // Tier 3: if USD/HKD still has no price, use open.er-api.com's daily rate
  // (HKD is pegged to USD, so a daily mid is fine for the derivation).
  if (!out['UST/T'] || out['UST/T'].bid === undefined) {
    const rate = await grab('erapi', 'https://open.er-api.com/v6/latest/USD',
      HISTORY_CACHE_SECONDS, parseErApi);
    if (rate !== null) {
      out['UST/T'] = { ...(out['UST/T'] || {}), bid: rate.toFixed(4), ask: rate.toFixed(4) };
    }
  }

  // Derived Hong Kong 99-tael gold
  if (out.LLG && out['UST/T']) out.HKG = deriveHKG(out.LLG, out['UST/T']);

  const gotAny = codes.some(c => out[c] && out[c].bid !== undefined);
  return json(out, gotAny ? 200 : 502);
}

/* ---------------- legacy host-allowlisted relay (?u=) ---------------- */
async function handleRelay(url) {
  const target = url.searchParams.get('u');
  if (!target) return json({ error: 'missing ?u= upstream url' }, 400);
  let upstream;
  try { upstream = new URL(target); } catch (_) { return json({ error: 'invalid url' }, 400); }
  if (upstream.protocol !== 'https:' || !ALLOWED_HOSTS.has(upstream.hostname)) {
    return json({ error: 'host not allowed' }, 403);
  }
  try {
    const res = await fetch(upstream.toString(), {
      headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': UA },
      cf: { cacheTtl: QUOTE_CACHE_SECONDS, cacheEverything: true },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8',
        'Cache-Control': `public, max-age=${QUOTE_CACHE_SECONDS}`,
      },
    });
  } catch (err) {
    return json({ error: 'upstream fetch failed', detail: String(err) }, 502);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    if (url.pathname === '/prices') return handlePrices();
    return handleRelay(url);
  },
};
