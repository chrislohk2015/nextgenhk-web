import worker, { parseYahoo, parseErApi, buildInstrument }
  from '../price-proxy.js';

const YA = (last, high, low, prev) => JSON.stringify({
  chart: { result: [{ meta: {
    regularMarketPrice: last, regularMarketDayHigh: high,
    regularMarketDayLow: low, chartPreviousClose: prev,
  }}]},
});
// Futures values = 2x spot so the scale factor k is exactly 0.5
const YAS = {
  'GC=F':  YA(8208.4, 8237.8, 8170.6, 8221.0),
  'SI=F':  YA(118.993, 120.20, 117.80, 119.60),
  'PL=F':  YA(3239.5, 3260.0, 3200.0, 3251.0),
  'PA=F':  YA(2544.3, 2560.0, 2520.0, 2556.0),
  'HKD=X': YA(7.8391, 7.8402, 7.8375, 7.8388),
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

assert(parseYahoo(YAS['GC=F']).prevClose === 8221.0, 'yahoo parse prevClose');
assert(parseYahoo('<html>') === null, 'yahoo garbage → null');
assert(parseErApi(ER) === 7.8392, 'er-api parse');
const merged = buildInstrument({ sq: { bid: 1, ask: 2 }, st: null, ya: { last: 9, high: 3, low: 0.5, prevClose: 4 }, prevClose: null, dp: 1 });
assert(merged.bid === '1.0' && merged.high === '3.0' && merged.close === '4.0', 'merge sq bid + yahoo range/close (no scale)');
const scaled = buildInstrument({ sq: { bid: 99, ask: 101 }, st: null, ya: { last: 200, high: 220, low: 180, prevClose: 210 }, prevClose: null, dp: 1, scale: true });
assert(scaled.high === '110.0' && scaled.low === '90.0' && scaled.close === '105.0', 'futures scaled to spot mid (k=0.5)');

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
assert(d.LLG.high === '4118.9' && d.LLG.low === '4085.3', 'range from yahoo futures scaled to spot (k=0.5)');
assert(d.LLG.close === '4110.5', 'prev close from yahoo futures scaled');
assert(d['UST/T'].bid === '7.8391', 'fx from yahoo');
assert(d.HKG.bid !== undefined && parseFloat(d.HKG.bid) > 37000 && parseFloat(d.HKG.bid) < 40000, `HKG derived (${d.HKG.bid})`);
assert(/403/.test(d._meta.sources['stooq-light']), 'sources reports stooq 403');
assert(d._meta.sources['yahoo:GC=F'] === 'ok', 'sources reports yahoo ok');

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
