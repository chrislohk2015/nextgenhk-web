// ===== NAV SCROLL =====
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
});

// ===== COUNTER ANIMATION =====
function animateCount(el, target, duration = 1800) {
  let start = 0;
  const step = (ts) => {
    if (!start) start = ts;
    const p = Math.min((ts - start) / duration, 1);
    el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const statsObs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting && !e.target.dataset.animated) {
      e.target.dataset.animated = '1';
      animateCount(e.target.querySelector('.count'), parseInt(e.target.dataset.val));
    }
  });
}, { threshold: 0.4 });
document.querySelectorAll('.stat[data-val]').forEach(s => statsObs.observe(s));

// ===== SCROLL REVEAL =====
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) setTimeout(() => e.target.classList.add('visible'), i * 80);
  });
}, { threshold: 0.1 });
document.querySelectorAll('.service-card,.pillar,.insight-card,.price-row:not(.header),.stat,.photo-item').forEach(el => {
  el.classList.add('reveal');
  revealObs.observe(el);
});

// ===== LIVE PRICES FROM mq1.wfgold.com =====
// Prices are in HKD (港金 HKG) and USD (倫敦金 LLG)
// We scrape the rendered page via allorigins CORS proxy every 5 seconds.

// CORS proxies tried in order until one works
// On localhost, try the local proxy server first (node proxy.js)
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const PROXIES = IS_LOCAL
  ? [
      (_url) => `http://localhost:8900/wfgold`,          // local node proxy (run: node proxy.js)
      (url)  => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url)  => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      (url)  => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ]
  : [
      (url)  => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url)  => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      (url)  => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];
const WF = 'https://mq1.wfgold.com';
let proxyIndex = 0;

// Seed with latest real prices from WF Gold (fallback when proxies unavailable)
const SEED = {
  LLG:     { bid:'4,737.3', ask:'4,738.8', high:'4,752.9', low:'4,684.1', close:'4,739.0' },
  HKG:     { bid:'44,078',  ask:'44,093',  high:'44,224',  low:'43,585',  close:'44,094'  },
  LLS:     { bid:'76.705',  ask:'76.905',  high:'78.365',  low:'74.190',  close:'77.635'  },
  PT:      { bid:'2,028.7', ask:'2,043.7', high:'2,080.5', low:'1,996.3', close:'2,071.5' },
  PD:      { bid:'1,489.0', ask:'1,504.0', high:'1,546.5', low:'1,462.0', close:'1,543.0' },
  'UST/T': { bid:'7.8327',  ask:'7.8332',  high:'7.8338',  low:'7.8309',  close:'7.8328'  },
};

// Maps the WF code → our DOM field IDs
const FIELDS = {
  'LLG':   { bid:'llg-bid', ask:'llg-ask', chg:'llg-chg', range:'llg-range', metal:'gold'      },
  'HKG':   { bid:'hkg-bid', ask:'hkg-ask', chg:'hkg-chg', range:'hkg-range', metal:'gold'      },
  'LLS':   { bid:'lls-bid', ask:'lls-ask', chg:'lls-chg', range:'lls-range', metal:'silver'    },
  'PT':    { bid:'pt-bid',  ask:'pt-ask',  chg:'pt-chg',  range:'pt-range',  metal:'platinum'  },
  'PD':    { bid:'pd-bid',  ask:'pd-ask',  chg:'pd-chg',  range:'pd-range',  metal:'palladium' },
  'UST/T': { bid:'fx-bid',  ask:'fx-ask',  chg:'fx-chg',  range:'fx-range',  metal:'fx'        },
};

const prevBid = {};   // track previous bid per code for flash direction
const closePx = {};   // yesterday's close per code

// Parse the HTML string returned by the proxy
function parseHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const result = {};

  doc.querySelectorAll('table').forEach(table => {
    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return;

      const nameRaw = cells[0].textContent.replace(/\s+/g, ' ').trim();

      // Extract the short code — last word in the cell (LLG, HKG, LLS, PT, PD, UST/T)
      const codeMatch = nameRaw.match(/([A-Z]{2,5}(?:\/[A-Z])?)$/);
      if (!codeMatch) return;
      const code = codeMatch[1];
      if (!FIELDS[code]) return;

      // Column layout (from our earlier scrape):
      // 0:name  1:bid  2:ask  3:high  4:low  5:close  (some tables differ)
      // The combined "bid/ask" cell vs separate — handle both layouts
      const c1 = cells[1].textContent.trim();
      const c2 = cells[2].textContent.trim();
      const c3 = cells[3] ? cells[3].textContent.trim() : '';
      const c4 = cells[4] ? cells[4].textContent.trim() : '';
      const c5 = cells[5] ? cells[5].textContent.trim() : '';

      let bid, ask, high, low, close;

      // Layout A: bid and ask are separate (cells 3 & 4 are bid/ask, 1 is combined)
      if (c1.includes('/') && !c3.includes('/')) {
        const parts = c1.split('/');
        bid   = parts[0].trim();
        ask   = parts[1] ? parts[1].trim() : c2;
        high  = c2.split('/')[0].trim();
        low   = c3.split('/')[0].trim();
        close = c5 || c4;
      } else {
        // Layout B: bid=c3, ask=c4
        bid   = c3 || c1;
        ask   = c4 || c2;
        high  = c1.split('/')[0].trim();
        low   = c2.split('/')[0].trim();
        close = c5;
      }

      result[code] = { bid, ask, high, low, close };
    });
  });

  return result;
}

function fmt(v) {
  const n = parseFloat(String(v).replace(/,/g, ''));
  if (isNaN(n)) return v;
  // Keep original decimal places
  const dec = (String(v).split('.')[1] || '').length;
  return n.toLocaleString('en-HK', { minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 2) });
}

function calcChg(bidStr, code) {
  const bid   = parseFloat(String(bidStr).replace(/,/g, ''));
  const close = parseFloat(String(closePx[code] || '').replace(/,/g, ''));
  if (isNaN(bid) || isNaN(close) || close === 0) return { text: '—', cls: '' };
  const diff = bid - close;
  const pct  = (diff / close) * 100;
  const sign = diff >= 0 ? '+' : '';
  return {
    text: `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
    cls:  diff >= 0 ? 'up' : 'down',
  };
}

function flash(metal, dir) {
  document.querySelectorAll(`.price-row[data-metal="${metal}"]`).forEach(row => {
    row.style.transition = 'background 0.15s';
    row.style.background = dir === 'up' ? 'rgba(76,175,122,0.1)' : 'rgba(224,85,85,0.1)';
    setTimeout(() => { row.style.background = ''; }, 600);
  });
}

function applyPrices(data) {
  let updated = 0;

  Object.entries(data).forEach(([code, v]) => {
    const f = FIELDS[code];
    if (!f) return;

    // Store close for change calc
    if (v.close) closePx[code] = v.close;

    const bidNum = parseFloat(String(v.bid).replace(/,/g, ''));

    // Flash on change
    if (prevBid[code] !== undefined && !isNaN(bidNum)) {
      if (bidNum > prevBid[code])      flash(f.metal, 'up');
      else if (bidNum < prevBid[code]) flash(f.metal, 'down');
    }
    if (!isNaN(bidNum)) prevBid[code] = bidNum;

    // Set DOM
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = fmt(val); };
    set(f.bid, v.bid);
    set(f.ask, v.ask);

    if (v.high && v.low) {
      const el = document.getElementById(f.range);
      if (el) el.textContent = `${fmt(v.low)} – ${fmt(v.high)}`;
    }

    const chg = calcChg(v.bid, code);
    const chgEl = document.getElementById(f.chg);
    if (chgEl) { chgEl.textContent = chg.text; chgEl.className = `change ${chg.cls}`; }

    updated++;
  });

  // Timestamp
  const ts = document.getElementById('last-update');
  if (ts) ts.textContent = new Date().toLocaleTimeString('en-HK', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Hong_Kong'
  }) + ' HKT';

  // Status indicator
  const st = document.getElementById('price-status');
  if (st) st.innerHTML = updated > 0
    ? '<span class="status-dot"></span> Live'
    : '<span class="status-dot" style="background:var(--gold-dim)"></span> Retrying…';

  // Update ticker bar too
  if (data.LLG?.bid) { const el = document.getElementById('xau'); if (el) el.textContent = fmt(data.LLG.bid); }
  if (data.LLS?.bid) { const el = document.getElementById('xag'); if (el) el.textContent = fmt(data.LLS.bid); }
  if (data.PT?.bid)  { const el = document.getElementById('xpt'); if (el) el.textContent = fmt(data.PT.bid);  }
  if (data.PD?.bid)  { const el = document.getElementById('xpd'); if (el) el.textContent = fmt(data.PD.bid);  }
}

let fetchController = null;

async function fetchPrices() {
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();

  // Try each proxy in rotation
  for (let attempt = 0; attempt < PROXIES.length; attempt++) {
    const idx = (proxyIndex + attempt) % PROXIES.length;
    const proxyUrl = PROXIES[idx](`${WF}?t=${Date.now()}`);

    try {
      const res = await fetch(proxyUrl, {
        signal: fetchController.signal,
        headers: { 'Accept': 'text/html,application/xhtml+xml' }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let html = await res.text();

      // allorigins wraps in JSON — handle both raw HTML and JSON wrapper
      if (html.trim().startsWith('{')) {
        try { html = JSON.parse(html).contents || html; } catch (_) {}
      }

      const data = parseHTML(html);
      if (Object.keys(data).length === 0) throw new Error('no data parsed');

      proxyIndex = idx; // stick with working proxy
      applyPrices(data);
      return; // success

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn(`Proxy ${idx} failed:`, err.message);
    }
  }

  // All proxies failed
  console.warn('All proxies failed');
  const st = document.getElementById('price-status');
  if (st) st.innerHTML = '<span class="status-dot" style="background:var(--down)"></span> Offline';
}

// Kick off immediately with seed data, then fetch live
applyPrices(SEED);
fetchPrices();
setInterval(fetchPrices, 5000);

// ===== FORM (FormSubmit.co) =====
async function handleForm(e) {
  e.preventDefault();

  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.textContent;

  // Disable button and show sending state
  btn.textContent = 'Sending…';
  btn.disabled = true;

  try {
    const formData = new FormData(form);
    // Set a dynamic subject line with the sender's name
    const name = formData.get('name') || '';
    const company = formData.get('company') || '';
    formData.set('_subject', `Enquiry from ${name}${company ? ' — ' + company : ''} via Nextgen Website`);

    const res = await fetch(form.action, {
      method: 'POST',
      body: formData,
      redirect: 'manual',
    });

    // FormSubmit returns 302 redirect on success; redirect:'manual' gives us an opaque-redirect (type 'opaqueredirect', status 0)
    // A network error would throw, so reaching here means the POST succeeded
    btn.textContent = 'Sent Successfully ✓';
    btn.style.background = '#4CAF7A';
    form.reset();
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.disabled = false;
    }, 4000);
  } catch (err) {
    console.error('Form error:', err);
    btn.textContent = 'Error — Please Try Again';
    btn.style.background = '#E05555';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.disabled = false;
    }, 4000);
  }
}

// Attach form handler
document.addEventListener('DOMContentLoaded', () => {
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', handleForm);
  }
});

// ===== HAMBURGER =====
const hamburger = document.getElementById('hamburger');
if (hamburger) {
  hamburger.addEventListener('click', () => {
    const links  = document.querySelector('.nav-links');
    const btnNav = document.querySelector('.btn-nav');
    if (!links) return;
    const open = links.style.display === 'flex';
    links.style.cssText = open ? '' : 'display:flex;flex-direction:column;position:absolute;top:68px;left:0;right:0;background:var(--dark-2);padding:20px 40px;gap:20px;border-bottom:1px solid var(--line)';
    if (btnNav) btnNav.style.display = open ? '' : 'block';
  });
}
