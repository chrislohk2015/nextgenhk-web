import worker, { parseStooqLight, parsePrevClose, parseSwissquote, buildInstrument, deriveHKG }
  from '../price-proxy.js';

const STOOQ_LIGHT = `Symbol,Date,Time,Open,High,Low,Close,Volume
XAUUSD,2026-07-10,17:55:11,4701.5,4752.9,4684.1,4737.3,N/D
XAGUSD,2026-07-10,17:55:11,77.100,78.365,74.190,76.705,N/D
XPTUSD,2026-07-10,17:55:10,2050.0,2080.5,1996.3,2028.7,N/D
XPDUSD,2026-07-10,17:55:09,1520.0,1546.5,1462.0,1489.0,N/D
USDHKD,2026-07-10,17:55:12,7.8330,7.8338,7.8309,7.8327,N/D`;

const STOOQ_HIST = (closes) => 'Date,Open,High,Low,Close,Volume\n' +
  closes.map(([d, c]) => `${d},1,1,1,${c},0`).join('\n');

const SQ = (bid, ask) => JSON.stringify([
  { topo: { platform: 'MT5' }, spreadProfilePrices: [
    { spreadProfile: 'Standard', bid: bid - 0.3, ask: ask + 0.3 },
    { spreadProfile: 'Prime', bid, ask },
  ]},
]);

const HISTS = {
  xauusd: STOOQ_HIST([['2026-07-08', 4720.0], ['2026-07-09', 4739.0], ['2026-07-10', 4737.3]]),
  xagusd: STOOQ_HIST([['2026-07-09', 77.635], ['2026-07-10', 76.705]]),
  xptusd: STOOQ_HIST([['2026-07-09', 2071.5], ['2026-07-10', 2028.7]]),
  xpdusd: STOOQ_HIST([['2026-07-09', 1543.0], ['2026-07-10', 1489.0]]),
  usdhkd: STOOQ_HIST([['2026-07-09', 7.8328], ['2026-07-10', 7.8327]]),
};
const SQS = {
  'XAU/USD': SQ(4737.2, 4737.8),
  'XAG/USD': SQ(76.705, 76.905),
  'XPT/USD': SQ(2028.7, 2043.7),
  'XPD/USD': SQ(1489.0, 1504.0),
};

globalThis.fetch = async (url) => {
  const u = String(url);
  let body = null;
  if (u.includes('/q/l/')) body = STOOQ_LIGHT;
  else if (u.includes('/q/d/l/')) {
    const sym = new URL(u).searchParams.get('s');
    body = HISTS[sym];
  } else if (u.includes('swissquote')) {
    const inst = u.split('/instrument/')[1];
    body = SQS[decodeURIComponent(inst)];
  }
  if (body === null) return new Response('nf', { status: 404 });
  return new Response(body, { status: 200 });
};

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

const light = parseStooqLight(STOOQ_LIGHT);
assert(light.xauusd.last === 4737.3 && light.xauusd.high === 4752.9, 'stooq light parse');
assert(parsePrevClose(HISTS.xauusd, '2026-07-10') === 4739.0, 'prev close skips today');
assert(parseSwissquote(SQS['XAU/USD']).bid === 4737.2, 'swissquote prime bid');
assert(parseSwissquote('not json') === null, 'swissquote bad json → null');

const deg = buildInstrument({ sq: null, st: light.xagusd, ya: null, prevClose: 77.635, dp: 3 });
assert(deg.bid === '76.705' && deg.close === '77.635', 'fallback bid from stooq last');

const res = await worker.fetch(new Request('https://w.example/prices'));
const data = await res.json();
assert(res.status === 200, 'HTTP 200');
assert(data.LLG.bid === '4737.2' && data.LLG.ask === '4737.8', 'LLG bid/ask from swissquote');
assert(data.LLG.close === '4739.0', 'LLG prev close');
assert(data.LLG.high === '4752.9' && data.LLG.low === '4684.1', 'LLG day range');
assert(data['UST/T'].bid === '7.8327', 'USD/HKD');
const hkg = parseFloat(data.HKG.bid);
assert(hkg > 43000 && hkg < 45500, `HKG derived plausible (${hkg})`);
assert(res.headers.get('Access-Control-Allow-Origin') === '*', 'CORS *');
assert(data._meta.sources['stooq-light'] === 'ok', '_meta.sources reports stooq ok');

const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => String(u).includes('swissquote') ? new Response('e', { status: 500 }) : realFetch(u);
const res2 = await worker.fetch(new Request('https://w.example/prices'));
const d2 = await res2.json();
assert(res2.status === 200 && d2.LLG.bid === '4737.3', 'degrades to stooq last when swissquote down');
assert(/500/.test(d2._meta.sources['sq:LLG']), 'sources records swissquote failure');

const res3 = await worker.fetch(new Request('https://w.example/?u=https%3A%2F%2Fevil.com%2F'));
assert(res3.status === 403, 'relay blocks non-allowlisted host');

console.log('\nDONE');
