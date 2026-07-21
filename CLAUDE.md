# Nextgen Resources website — project guide

Corporate site for **Nextgen Resources Limited**, a Hong Kong/Dubai precious
metals trading house (DPMS Licence A-B-23-06-00477). Static site, no build
step, no framework.

## Hosting & deploy

- **GitHub Pages serves `main`** → https://www.nextgenhk.info (CNAME file:
  `www.nextgenhk.info`). Pushing to `main` deploys in ~1–2 min
  ("pages build and deployment" workflow). Viewers need a hard refresh.
- Domain DNS is on **Cloudflare** (free plan, since 2026-06-21). Mail (MX) is
  **Google Workspace** — do not touch MX records.
- Development branch: `claude/nextgen-website-redesign-mlyt90` — historically
  kept in sync with main (fast-forward merges).
- Branch preview URL (before merging):
  `https://raw.githack.com/chrislohk2015/nextgenhk-web/<branch>/index.html`

## Files

| File | Role |
|---|---|
| `index.html` | Single-page site: hero, marquee, stats, services, live markets, about, insights, contact, footer |
| `style.css` | All styling. Dark theme, gold accents. `privacy-policy.html` shares the nav/hero/footer classes and CSS variables — keep those names stable |
| `script.js` | Nav/reveal/counters/cursor/tilt + live prices + contact form |
| `hero3d.js` | Three.js interactive hero (ES module) |
| `vendor/three/` | Vendored three.js r160 (module + RoomEnvironment + RoundedBoxGeometry) — **no CDN dependency**, importmap in index.html maps `three` |
| `cloudflare-worker/price-proxy.js` | The price-feed Worker source (deployed manually, see below) |
| `privacy-policy.html` | Own inline styles on top of style.css; nav pinned `top:0` (no ticker bar there) |
| `social-card.jpg` | 1200×630 og:image |

## Design system (style.css)

- Fonts: **Fraunces** (display serif, gold-gradient `<em>`) + **Space Grotesk** (UI).
- Palette vars: `--dark #07080a`, `--gold #d6a644`, `--gold-light #f1d489`,
  `--up #3ddc97`, `--down #ff5c5c`. Old var names kept for privacy page compat.
- Interactions: custom cursor + magnetic buttons (fine pointers only), card
  spotlight/tilt (`.tilt`), scroll reveal (`.reveal`→`.visible`), marquee,
  scroll progress bar. All honor `prefers-reduced-motion`.

## 3D hero (hero3d.js)

- Stack of 3 cast gold ingots: RoundedBoxGeometry tapered per-vertex,
  procedural canvas roughness/bump maps, engraved "NEXTGEN 999.9 FINE GOLD"
  stamp planes, contact-shadow blob, halo ring, gold-dust particles.
- Idle spin → drag-to-rotate with inertia (pointer events on canvas),
  mouse parallax, scroll dolly. Pauses off-screen/hidden tab. DPR capped at 2.
- Mobile (<720px): camera z 13.5, stack scale 0.85, baseY −2.8 (desktop: 9 /
  1.18 / −2.0) — set in `resize()`.
- Degrades silently to the CSS glow/grid if WebGL or module loading fails.

## Live prices

**Architecture:** browser polls `PRICE_PROXY + '/prices'` every 5s
(`script.js`) → Cloudflare Worker aggregates sources server-side → JSON:
`{ LLG|HKG|LLS|PT|PD|"UST/T": {bid,ask,high,low,close}, _meta }`.
`applyPrices()` fills the board + top ticker; change column = bid vs `close`
(previous close); up/down row flashes.

- **Worker URL** (`PRICE_PROXY` in script.js):
  `https://purple-snow-4151.chrislohk2015.workers.dev`
  (owner: chrislohk2015's free Cloudflare account, worker "purple-snow-4151").
- **Sources & priority** (each field falls through independently):
  bid/ask: Swissquote public quotes → Stooq last → Yahoo last;
  high/low/prevClose: Stooq → Yahoo chart meta;
  USD/HKD: Stooq → Yahoo `HKD=X` → open.er-api.com daily.
  **Known:** Stooq usually refuses Cloudflare egress IPs → Yahoo does the work.
- **HKG (HK 99-tael gold, HKD/tael) is derived**: XAU/USD × USD/HKD × 1.20337
  oz/tael × 0.99 fineness — labelled "derived from spot" in the UI (real CGSE
  quotes carry a local premium; derivation lands within ~0.3%).
- **No seed prices**: board shows "—" + "Connecting…" until data; "Offline"
  if all sources fail. Never display hard-coded numbers — this is a bullion
  dealer.
- **Worker deploys are MANUAL**: paste `cloudflare-worker/price-proxy.js` into
  Cloudflare dashboard → Worker → Edit code → Deploy. The repo copy is source
  of truth; remind the owner to re-paste after editing it.
- Worker is host-allowlisted (not an open proxy); CORS `*` (public data).
  Also keeps a legacy `/?u=` relay for debugging.
- `_meta.sources` in the /prices response reports each upstream's outcome
  ('ok' / 'parse-null' / error) — first thing to check when columns go blank.
- Testing: `node cloudflare-worker/test/test-worker.mjs` (and `test-worker2.mjs`)
  — unit tests with mocked `fetch`, runnable offline in Node 22.

## Contact form

- **Web3Forms** → delivers to **chrislo@nextgenhk.info**
  (access key `201cbbe0-4cdd-4d70-b13f-a395e4edaf04` in index.html — public
  by design). A dormant key for chrislohk2015@gmail.com exists
  (`54599a2c-...`). Free tier: 250 submissions/month.
- Flow (`script.js handleForm`): fetch POST to `api.web3forms.com/submit`
  (FormData incl. `access_key`, dynamic `subject`, `botcheck` honeypot) →
  JSON result → green success / red error with direct-email fallback shown in
  `.form-status`. Hidden-iframe submit only if fetch itself cannot run.
- **History — do NOT go back to FormSubmit.co**: it returned `success` while
  silently delivering nothing, even to a plain Gmail (verified 2026-07-10).
  The old iframe-only code also faked "Sent Successfully" regardless of
  outcome; keep the honest-feedback pattern.
- To change recipient: new key at web3forms.com → swap `access_key` value.

## Environment notes (Claude Code remote sessions)

- Sandbox egress is allowlisted: github/fonts/npm work; **blocked**:
  workers.dev, stooq, swissquote, yahoo, formsubmit, web3forms, nextgenhk.info
  itself. Verify external behavior via the owner's browser or unit tests with
  mocked fetch — `curl` returning `HTTP 000` means proxy denial, not a bug.
- Local preview: `python3 -m http.server 8000` (modules need HTTP, not file://).
  Screenshot via Playwright at `/opt/node22/lib/node_modules/playwright`,
  chromium args `--no-sandbox --use-gl=swiftshader --enable-unsafe-swiftshader`.
- Owner's Gmail (chrislohk2015@gmail.com) is connected via MCP — useful for
  verifying email delivery end-to-end.
- The owner is non-technical: give click-by-click dashboard instructions,
  verify each step, and prefer solutions with zero ongoing maintenance.

## Changelog (2026-07-10 redesign session)

1. Full redesign: dark/gold editorial theme, Fraunces+Space Grotesk,
   interactive 3D bullion hero, marquee, tilt cards, custom cursor.
2. Vendored three.js r160 (was CDN); realism pass on ingots (rounded taper,
   texture maps, engraving, contact shadow, warm/cool lighting).
3. Replaced dead price scraping (wfgold HTML renders client-side → no data)
   with Cloudflare Worker `/prices` aggregator + multi-tier fallbacks.
4. Replaced FormSubmit (silent non-delivery) with Web3Forms; honest
   success/error UI; recipient chrislo@nextgenhk.info.
5. Audit fixes: removed stale seed prices, privacy-page nav gap, og:image
   social card, robots.txt, sitemap.xml.
6. Preserved: DPMS licence footer, address/phone, privacy policy, CNAME.
