/**
 * Nextgen Resources — live price proxy (Cloudflare Worker)
 * ---------------------------------------------------------
 * Fetches the upstream precious-metals quote page server-side (where
 * browser CORS rules do not apply), caches it at Cloudflare's edge for a
 * few seconds, and returns it to the website with permissive CORS headers.
 *
 * This removes the site's dependence on flaky public CORS proxies
 * (corsproxy.io / codetabs / allorigins), which is what caused the price
 * board to intermittently show "Retrying…" or fall back to seed values.
 *
 * The proxy is HOST-ALLOWLISTED — it will only fetch the upstreams listed
 * below, so it cannot be abused as a general-purpose open proxy.
 *
 * Deploy: see README.md in this folder.
 */

// Only these upstream hosts may be fetched through this Worker.
const ALLOWED_HOSTS = new Set([
  'mq1.wfgold.com',      // WF Gold — Loco London + HK tael + Pt/Pd + USD/HKD
]);

// Where the site is allowed to call this Worker from (CORS allowlist).
// '*' also works, but pinning to your domains is tidier and safer.
const ALLOWED_ORIGINS = [
  'https://www.nextgenhk.info',
  'https://nextgenhk.info',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const EDGE_CACHE_SECONDS = 15; // how long the edge holds each fetch

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    // Pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    if (!target) {
      return json({ error: 'missing ?u= upstream url' }, 400, origin);
    }

    let upstream;
    try {
      upstream = new URL(target);
    } catch (_) {
      return json({ error: 'invalid url' }, 400, origin);
    }
    if (upstream.protocol !== 'https:' || !ALLOWED_HOSTS.has(upstream.hostname)) {
      return json({ error: 'host not allowed' }, 403, origin);
    }

    try {
      const res = await fetch(upstream.toString(), {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'NextgenPriceProxy/1.0 (+https://www.nextgenhk.info)',
        },
        cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true },
      });

      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          ...corsHeaders(origin),
          'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8',
          'Cache-Control': `public, max-age=${EDGE_CACHE_SECONDS}`,
        },
      });
    } catch (err) {
      return json({ error: 'upstream fetch failed', detail: String(err) }, 502, origin);
    }
  },
};

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}
