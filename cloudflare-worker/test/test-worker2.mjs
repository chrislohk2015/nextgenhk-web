import worker, { parseYahoo, parseErApi, buildInstrument }
  from '../price-proxy.js';

const YA = (last, high, low, prev) => JSON.stringify({
  chart: { result: [{ meta: {
    regularMarketPrice: last, regularMarketDayHigh: high,
    regularMarketDayLow: low, chartPreviousClose: prev,
  }}]},
});
const YAS = {
  'XAUUSD=X': YA(4104.2, 4118.9, 4085.3, 4110.5),
  'XAGUSD=X': YA(59.50, 60.10, 58.90, 59.80),
  'XPTUSD=X': YA(1619.0, 1630.0, 1600.0, 1625.5),
  'XPDUSD=X': YA(1272.0, 1280.0, 1260.0, 1278.0),
  'HKD=X':    YA(7.8391, 7.8402, 7.8375, 7.8388),
};
const SQ = (bid, ask) => JSON.stringify([
  { spreadProfilePrices: [{ spreadProfile: 'Prime', bid, ask }] },
]);
const SQS = {
  'XAU/USD': SQ(4103.9, 4104.5),
  'XAG/USD': SQ(59.471, 59.522),
  'XPT/USD': SQ(1617.5, 1622.0),
  'XPD/USD': SQ(1270.0, 1274.3),
};
const ER = JSON.stringify({ result: 'success', rates: { HKD: 7.8392 } });

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

assert(parseYahoo(YAS['XAUUSD=X']).prevClose === 4110.5, 'yahoo parse prevClose');
assert(parseYahoo('<html>') === null, 'yahoo garbage → null');
assert(parseErApi(ER) === 7.8392, 'er-api parse');
const merged = buildInstrument({ sq: { bid: 1, ask: 2 }, st: null, ya: { last: 9, high: 3, low: 0.5, prevClose: 4 }, prevClose: null, dp: 1 });
assert(merged.bid === '1.0' && merged.high === '3.0' && merged.close === '4.0', 'merge sq bid + yahoo range/close');

function mockFetch({ stooqDown = false, yahooDown = false, sqDown = false, erDown = false }) {
  return async (url) => {
    const u = String(url);
    if (u.includes('stooq.com')) return stooqDown ? new Response('deny', { status: 403 }) : new Response('', { status: 404 });
    if (u.includes('swissquote')) {
      if (sqDown) return new Response('e', { status: 500 });
      return new Response(SQS[decodeURIComponent(u.split('/instrument/')[1])] || 'x', { status: 200 });
    }
    if (u.includes('yahoo')) {
      if (yahooDown) return new Response('e', { status: 429 });
      const sym = decodeURIComponent(u.split('/chart/')[1].split('?')[0]);
      return new Response(YAS[sym] || 'x', { status: 200 });
    }
    if (u.includes('er-api')) return erDown ? new Response('e', { status: 500 }) : new Response(ER, { status: 200 });
    return new Response('nf', { status: 404 });
  };
}

globalThis.fetch = mockFetch({ stooqDown: true });
let res = await worker.fetch(new Request('https://w/prices'));
let d = await res.json();
assert(d.LLG.bid === '4103.9' && d.LLG.ask === '4104.5', 'bid/ask still swissquote');
assert(d.LLG.high === '4118.9' && d.LLG.low === '4085.3', 'range from yahoo');
assert(d.LLG.close === '4110.5', 'prev close from yahoo');
assert(d['UST/T'].bid === '7.8391', 'fx from yahoo');
assert(d.HKG.bid !== undefined && parseFloat(d.HKG.bid) > 37000 && parseFloat(d.HKG.bid) < 40000, `HKG derived (${d.HKG.bid})`);
assert(/403/.test(d._meta.sources['stooq-light']), 'sources reports stooq 403');
assert(d._meta.sources['yahoo:XAUUSD=X'] === 'ok', 'sources reports yahoo ok');

globalThis.fetch = mockFetch({ stooqDown: true, yahooDown: true });
res = await worker.fetch(new Request('https://w/prices'));
d = await res.json();
assert(d.LLG.bid === '4103.9' && d.LLG.high === undefined, 'metals bid only, no range');
assert(d['UST/T'].bid === '7.8392', 'fx from er-api');
assert(d.HKG.bid !== undefined, 'HKG still derived');

globalThis.fetch = mockFetch({ stooqDown: true, yahooDown: true, sqDown: true, erDown: true });
res = await worker.fetch(new Request('https://w/prices'));
assert(res.status === 502, 'all-down → 502');

console.log('\nDONE');
