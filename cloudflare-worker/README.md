# Live price Worker — Cloudflare

This Worker gives the website a reliable live price feed. Its `/prices`
endpoint aggregates real machine-readable market data server-side —
Swissquote public quotes (dealable bid/ask for XAU/XAG/XPT/XPD) and Stooq
(day range, previous close, USD/HKD) — caches it at Cloudflare's edge for a
few seconds, and returns clean JSON with the CORS headers the browser needs.
Hong Kong 99-tael gold (HKD/tael) is derived from spot × USD/HKD × 1.20337
oz/tael × 0.99 fineness and labelled as derived on the site.

(Scraping the old quote webpage doesn't work: its prices are rendered by
client-side scripts, so the raw HTML contains no numbers.)

Upstream fetching is **host-allowlisted** — the Worker only talks to the data
sources listed in `price-proxy.js`, so it cannot be abused as an open proxy.

Cost: **free**. Cloudflare's Workers free plan (100,000 requests/day) is far
more than this site will ever use, even refreshing every 5 seconds.

---

## Deploy in ~10 minutes (dashboard, no tools needed)

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. In the dashboard sidebar: **Workers & Pages → Create → Create Worker**.
3. Give it a name, e.g. `nextgen-prices`, and click **Deploy**.
4. Click **Edit code**, delete the starter code, and paste the entire contents
   of [`price-proxy.js`](./price-proxy.js). Click **Deploy** again.
5. Copy the Worker URL shown (looks like
   `https://nextgen-prices.YOURNAME.workers.dev`).
6. Open `script.js` in the site and set:

   ```js
   const PRICE_PROXY = 'https://nextgen-prices.YOURNAME.workers.dev';
   ```

   (no trailing slash). Commit and deploy the site. Done.

---

## Deploy with Wrangler (CLI, optional)

If you prefer the command line:

```bash
npm install -g wrangler
wrangler login
cd cloudflare-worker
wrangler deploy price-proxy.js --name nextgen-prices --compatibility-date 2024-01-01
```

Then set `PRICE_PROXY` in `script.js` to the URL Wrangler prints.

---

## How to verify it works

Open this in a browser (replace with your Worker URL) — you should see JSON
with bid/ask/high/low/close for LLG, HKG, LLS, PT, PD and UST/T:

```
https://nextgen-prices.YOURNAME.workers.dev/prices
```

On the live site, the price board's status pill should read **● Live** and the
"Last update" time should tick, without dropping to "Retrying…".

---

## Notes

- **Fallback still works.** If you never set `PRICE_PROXY`, or the Worker is
  down, the site automatically falls back to the public proxies — nothing
  breaks, it just becomes less reliable.
- **Change the source later.** To pull from a different upstream, add its host
  to `ALLOWED_HOSTS` in `price-proxy.js` and redeploy.
- **Lock down CORS.** `ALLOWED_ORIGINS` in `price-proxy.js` already pins the
  Worker to nextgenhk.info + localhost. Add any other domains you serve from.
- **Prices are indicative.** Whatever the source, these are reference spot
  prices — actual trades execute at Nextgen desk prices, as the board states.
