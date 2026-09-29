import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.AISSTREAM_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

const boundsParts = String(
  process.env.CASPIAN_BOUNDS || '39.0,48.0,45.2,53.0'
).split(',').map(Number);

const BOUNDS =
  boundsParts.length === 4 && boundsParts.every(Number.isFinite)
    ? {
        south: boundsParts[0],
        west: boundsParts[1],
        north: boundsParts[2],
        east: boundsParts[3]
      }
    : {
        south: 39.0,
        west: 48.0,
        north: 45.2,
        east: 53.0
      };

const PORTS = {
  Aktau: { lat: 43.64, lon: 51.17, radiusNm: 15 },
  Kuryk: { lat: 43.18, lon: 51.66, radiusNm: 15 },
  Alat: { lat: 39.95, lon: 49.39, radiusNm: 15 },
  Baku: { lat: 40.30, lon: 49.92, radiusNm: 15 }
};

const EAST_ZONES = new Set(['Aktau', 'Kuryk']);
const WEST_ZONES = new Set(['Alat', 'Baku']);

const STALE_MS = 30 * 60 * 1000;
const HARD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PUBLIC_VESSELS = 50;

fs.mkdirSync(DATA_DIR, { recursive: true });

const crossingFile = path.join(DATA_DIR, 'crossings.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

let crossings = readJson(crossingFile, []);

if (!Array.isArray(crossings)) {
  crossings = [];
}

const vessels = new Map();
const journeyStarts = new Map();

const trackerSince = new Date().toISOString();

let wsState = API_KEY ? 'connecting' : 'not_configured';
let lastMessageAt = null;

let reconnectTimer = null;
let activeWs = null;

function persistCrossings() {
  try {
    fs.writeFileSync(
      crossingFile,
      JSON.stringify(crossings.slice(-1000), null, 2)
    );
  } catch {}
}

function toRad(d) {
  return d * Math.PI / 180;
}

function distanceNm(aLat, aLon, bLat, bLon) {
  const R = 3440.065;

  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);

  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(q));
}

function zoneFor(lat, lon) {
  for (const [name, p] of Object.entries(PORTS)) {
    if (distanceNm(lat, lon, p.lat, p.lon) <= p.radiusNm) {
      return name;
    }
  }

  return null;
}

function normalizeCourse(cog) {
  const n = Number(cog);

  if (!Number.isFinite(n)) {
    return null;
  }

  return ((n % 360) + 360) % 360;
}

function courseDirection(cog, sog) {
  if (!Number.isFinite(Number(sog)) || Number(sog) < 1.5) {
    return 'Stationary';
  }

  const c = normalizeCourse(cog);

  if (c === null) {
    return 'Underway';
  }

  if (c >= 190 && c <= 330) {
    return 'Westbound';
  }

  if (c >= 10 && c <= 150) {
    return 'Eastbound';
  }

  return 'Underway';
}

function corridorCandidate(v) {
  if (v.zone) {
    return true;
  }

  const dest = (v.destination || '').toUpperCase();

  if (/AKTAU|KURYK|ALAT|BAKU|BAKI/.test(dest)) {
    return true;
  }

  const direction = courseDirection(v.cog, v.sog);

  return (
    Number(v.sog) >= 3 &&
    (direction === 'Westbound' || direction === 'Eastbound') &&
    v.lat >= 39.3 &&
    v.lat <= 44.8 &&
    v.lon >= 48.4 &&
    v.lon <= 52.7
  );
}

function median(nums) {
  const values = nums
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!values.length) {
    return null;
  }

  const m = Math.floor(values.length / 2);

  return values.length % 2
    ? values[m]
    : (values[m - 1] + values[m]) / 2;
}

function inferCrossing(mmsi, prevZone, newZone, now) {
  if (!newZone || newZone === prevZone) {
    return;
  }

  const side = EAST_ZONES.has(newZone)
    ? 'east'
    : WEST_ZONES.has(newZone)
      ? 'west'
      : null;

  if (!side) {
    return;
  }

  const start = journeyStarts.get(mmsi);

  if (start && start.side !== side) {
    const hours = (now - start.at) / 3600000;

    if (hours >= 4 && hours <= 72) {
      crossings.push({
        mmsi: String(mmsi),
        from: start.zone,
        to: newZone,
        departed_at: new Date(start.at).toISOString(),
        arrived_at: new Date(now).toISOString(),
        hours: Number(hours.toFixed(2))
      });

      persistCrossings();
    }

    journeyStarts.delete(mmsi);
  }

  journeyStarts.set(mmsi, {
    side,
    zone: newZone,
    at: now
  });
}

function parsePosition(event) {
  const meta = event?.MetaData || {};
  const body = event?.Message?.[event.MessageType] || {};

  const lat = Number(meta.Latitude ?? body.Latitude);
  const lon = Number(meta.Longitude ?? body.Longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const mmsi = String(
    meta.MMSI ??
    body.UserID ??
    ''
  );

  if (!mmsi) {
    return null;
  }

  return {
    mmsi,
    name: String(meta.ShipName || '').trim() || null,
    lat,
    lon,
    sog: Number.isFinite(Number(body.Sog))
      ? Number(body.Sog)
      : null,
    cog: Number.isFinite(Number(body.Cog))
      ? Number(body.Cog)
      : null,
    heading: Number.isFinite(Number(body.TrueHeading))
      ? Number(body.TrueHeading)
      : null
  };
}

function applyStatic(event) {
  const meta = event?.MetaData || {};
  const body = event?.Message?.[event.MessageType] || {};

  const mmsi = String(
    meta.MMSI ??
    body.UserID ??
    ''
  );

  if (!mmsi) {
    return;
  }

  const old = vessels.get(mmsi) || { mmsi };

  const destination =
    body.Destination ||
    body.DestinationName ||
    old.destination ||
    null;

  vessels.set(mmsi, {
    ...old,
    name:
      String(
        meta.ShipName ||
        body.Name ||
        old.name ||
        ''
      ).trim() || null,
    destination:
      destination
        ? String(destination).trim()
        : null,
    imo:
      body.ImoNumber ||
      body.IMO ||
      old.imo ||
      null,
    call_sign:
      body.CallSign ||
      old.call_sign ||
      null,
    ship_type:
      body.Type ??
      body.ShipType ??
      old.ship_type ??
      null
  });
}

function handleEvent(event) {
  lastMessageAt = new Date().toISOString();

  if (event?.MessageType === 'SubscriptionConfirmation') {
    wsState = 'live';
    console.log('[AIS] Subscription confirmed');
    return;
  }

  if (
    event?.MessageType === 'ShipStaticData' ||
    event?.MessageType === 'StaticDataReport'
  ) {
    applyStatic(event);
    return;
  }

  if (
    ![
      'PositionReport',
      'StandardClassBPositionReport',
      'ExtendedClassBPositionReport',
      'LongRangeAisBroadcastMessage'
    ].includes(event?.MessageType)
  ) {
    return;
  }

  const pos = parsePosition(event);

  if (!pos) {
    return;
  }

  const now = Date.now();
  const old = vessels.get(pos.mmsi) || {};

  const newZone = zoneFor(pos.lat, pos.lon);
  const prevZone = old.zone || null;

  inferCrossing(
    pos.mmsi,
    prevZone,
    newZone,
    now
  );

  const next = {
    ...old,
    ...pos,
    zone: newZone,
    last_seen: new Date(now).toISOString()
  };

  next.direction = courseDirection(
    next.cog,
    next.sog
  );

  next.corridor_candidate =
    corridorCandidate(next);

  vessels.set(pos.mmsi, next);
}

function cleanup() {
  const cutoff = Date.now() - HARD_TTL_MS;

  for (const [mmsi, vessel] of vessels) {
    if (
      !vessel.last_seen ||
      new Date(vessel.last_seen).getTime() < cutoff
    ) {
      vessels.delete(mmsi);
    }
  }
}

function scheduleReconnect(delay) {
  if (reconnectTimer) {
    return;
  }

  console.log(
    `[AIS] Next connection attempt in ${Math.round(delay / 60000)} minute(s)`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectAIS();
  }, delay);
}

function connectAIS() {
  if (!API_KEY) {
    wsState = 'not_configured';
    console.error('[AIS] AISSTREAM_API_KEY missing');
    return;
  }

  if (
    activeWs &&
    (
      activeWs.readyState === WebSocket.OPEN ||
      activeWs.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  wsState = 'connecting';

  console.log('[AIS] Connecting to AISStream...');

  const ws = new WebSocket(
    'wss://stream.aisstream.io/v0/stream'
  );

  activeWs = ws;

  ws.on('open', () => {
    wsState = 'subscribing';

    console.log(
      '[AIS] WebSocket opened. Sending subscription...'
    );

    ws.send(JSON.stringify({
      APIKey: API_KEY,

      BoundingBoxes: [
        [
          [BOUNDS.south, BOUNDS.west],
          [BOUNDS.north, BOUNDS.east]
        ]
      ],

      FilterMessageTypes: [
        'PositionReport',
        'StandardClassBPositionReport',
        'ExtendedClassBPositionReport',
        'LongRangeAisBroadcastMessage',
        'ShipStaticData',
        'StaticDataReport'
      ]
    }));
  });

  ws.on('message', raw => {
    try {
      handleEvent(
        JSON.parse(
          raw.toString('utf8')
        )
      );
    } catch (err) {
      console.error(
        '[AIS] Parse error:',
        err.message
      );
    }
  });

  ws.on(
    'unexpected-response',
    (_req, res) => {
      wsState = 'offline';

      console.error(
        `[AIS] Handshake rejected: HTTP ${res.statusCode}`
      );

      res.on('data', chunk => {
        console.error(
          '[AIS] Response:',
          chunk.toString()
        );
      });

      if (activeWs === ws) {
        activeWs = null;
      }

      const delay =
        res.statusCode === 429
          ? 5 * 60 * 1000
          : 60 * 1000;

      scheduleReconnect(delay);
    }
  );

  ws.on('error', err => {
    wsState = 'offline';

    console.error(
      '[AIS] WebSocket error:',
      err.message
    );
  });

  ws.on('close', (code, reason) => {
    wsState = 'offline';

    if (activeWs === ws) {
      activeWs = null;
    }

    console.log(
      `[AIS] Connection closed. code=${code} reason=${reason.toString()}`
    );

    scheduleReconnect(
      60 * 1000
    );
  });
}

function publicSnapshot() {
  cleanup();

  const cutoff =
    Date.now() - STALE_MS;

  const recent = [
    ...vessels.values()
  ].filter(v =>
    v.last_seen &&
    new Date(v.last_seen).getTime() >= cutoff
  );

  recent.forEach(v => {
    v.direction =
      courseDirection(v.cog, v.sog);

    v.corridor_candidate =
      corridorCandidate(v);
  });

  recent.sort(
    (a, b) =>
      Number(b.corridor_candidate) -
        Number(a.corridor_candidate) ||
      Number(b.sog || 0) -
        Number(a.sog || 0)
  );

  const summary = {
    vessels_30m: recent.length,

    underway:
      recent.filter(
        v => Number(v.sog) >= 1.5
      ).length,

    near_aktau:
      recent.filter(
        v => v.zone === 'Aktau'
      ).length,

    near_kuryk:
      recent.filter(
        v => v.zone === 'Kuryk'
      ).length,

    near_alat:
      recent.filter(
        v => v.zone === 'Alat'
      ).length,

    near_baku:
      recent.filter(
        v => v.zone === 'Baku'
      ).length,

    westbound:
      recent.filter(
        v =>
          v.corridor_candidate &&
          v.direction === 'Westbound'
      ).length,

    eastbound:
      recent.filter(
        v =>
          v.corridor_candidate &&
          v.direction === 'Eastbound'
      ).length
  };

  const cutoff7 =
    Date.now() -
    7 * 86400000;

  const crossings7d =
    crossings.filter(
      c =>
        new Date(c.arrived_at).getTime() >=
        cutoff7
    );

  return {
    status: wsState,

    provider: 'AISStream',

    updated_at: lastMessageAt,

    tracker_since:
      trackerSince,

    bounds:
      BOUNDS,

    summary,

    crossings: {
      count:
        crossings7d.length,

      median_hours:
        median(
          crossings7d.map(
            c => Number(c.hours)
          )
        )
    },

    vessels:
      recent
        .slice(0, MAX_PUBLIC_VESSELS)
        .map(v => ({
          mmsi: v.mmsi,
          name: v.name,
          lat: v.lat,
          lon: v.lon,
          sog: v.sog,
          cog: v.cog,
          heading: v.heading,
          zone: v.zone,
          direction: v.direction,
          corridor_candidate:
            v.corridor_candidate,
          destination:
            v.destination || null,
          last_seen:
            v.last_seen
        }))
  };
}


// -----------------------------------------------------------------------------
// Pricing source watcher
// -----------------------------------------------------------------------------
const PRICING_REFRESH_MS = 5 * 60 * 1000;
const pricingSourceHashes = new Map();

const PRICING_FALLBACK = {
  structural: {
    dostyk_aktau: {
      route: 'Dostyk (Kazakhstan) → Aktau (Kazakhstan)',
      value_usd: 1250,
      container: "40 ft loaded",
      source_url: 'https://middlecorridor.com/images/tariffs/6.pdf',
      source_name: 'TITR / Middle Corridor',
      status: 'verified',
      note: 'Official Kazakhstan rail-segment tariff; 3,095 km, 114 hours.'
    },
    xian_aktau: {
      route: "Xi’an (China) → Aktau (Kazakhstan)",
      value_usd: null,
      status: 'not_published',
      note: 'No verified current public all-in Xi’an→Aktau 40HC tariff is used.'
    },
    kuryk_alat: {
      route: 'Kuryk (Kazakhstan) ↔ Alat (Azerbaijan)',
      value_usd: 1200,
      container: "40 ft container",
      source_url: 'https://asco.az//en/pages/19/140',
      source_name: 'ASCO',
      status: 'verified',
      note: 'Loading and discharging excluded under the published tariff notes.'
    },
    aktau_baku: {
      route: 'Aktau (Kazakhstan) → Alat/Baku (Azerbaijan)',
      value_usd: null,
      status: 'not_published',
      note: 'No verified current standalone public Aktau→Alat/Baku tariff is used.'
    }
  },
  market: {
    assessment: {
      route: "Xi’an (China) → Baku/Alat (Azerbaijan)",
      period: '2026-07',
      low_usd: 6600,
      high_usd: 7100,
      midpoint_usd: 6850,
      container: '40HC',
      source_url: 'https://ydxtrans.com/newsDetail/57.html',
      source_name: 'YDX market analysis',
      note: 'Latest month explicitly priced on the 21 Sep 2026 page; not a September quote.'
    },
    provider_quotes: [
      {
        route: "Xi’an (China) → Baku/Absheron (Azerbaijan)",
        value_usd: 5000,
        price_floor: false,
        container: 'SOC 40HQ',
        source_url: 'https://www.widesafe.com/news_en/35.html',
        source_name: 'WideSafe'
      },
      {
        route: "Xi’an (China) → Poti (Georgia)",
        value_usd: 4400,
        price_floor: false,
        container: 'SOC 40HQ',
        source_url: 'https://www.widesafe.com/news_en/35.html',
        source_name: 'WideSafe'
      },
      {
        route: "Xi’an (China) → Mersin/Istanbul (Türkiye)",
        value_usd: 4700,
        price_floor: true,
        container: 'SOC 40HQ',
        source_url: 'https://www.widesafe.com/news_en/35.html',
        source_name: 'WideSafe'
      }
    ]
  }
};

let pricingState = {
  status: 'starting',
  checked_at: null,
  review_required: false,
  sources: {},
  structural: structuredClone(PRICING_FALLBACK.structural),
  market: structuredClone(PRICING_FALLBACK.market)
};

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSource(url, asText = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'MCFI-Middle-Corridor-Monitor/1.0 (+public-source-check)'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = asText ? await res.text() : Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      body,
      etag: res.headers.get('etag'),
      last_modified: res.headers.get('last-modified'),
      content_type: res.headers.get('content-type')
    };
  } finally {
    clearTimeout(timer);
  }
}

function digest(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function markHash(sourceId, body) {
  const next = digest(body);
  const previous = pricingSourceHashes.get(sourceId);
  if (!previous) {
    pricingSourceHashes.set(sourceId, next);
    return false;
  }
  if (previous !== next) {
    pricingSourceHashes.set(sourceId, next);
    return true;
  }
  return false;
}

function parseMoney(raw) {
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseYdxAssessment(text) {
  const months = {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12
  };
  const found = [];
  const re = /(January|February|March|April|May|June|July|August|September|October|November|December)\s*:\s*\$?([\d,]+)\s*[–—-]\s*\$?([\d,]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const mon = months[m[1].toLowerCase()];
    const low = parseMoney(m[2]);
    const high = parseMoney(m[3]);
    if (mon && low && high && low >= 3000 && high <= 15000 && high >= low) {
      found.push({mon, low, high});
    }
  }
  if (!found.length) return null;
  found.sort((a,b)=>a.mon-b.mon);
  const x = found[found.length-1];
  return {
    route: "Xi’an (China) → Baku/Alat (Azerbaijan)",
    period: `2026-${String(x.mon).padStart(2,'0')}`,
    low_usd: x.low,
    high_usd: x.high,
    midpoint_usd: Math.round((x.low + x.high) / 2),
    container: '40HC',
    source_url: 'https://ydxtrans.com/newsDetail/57.html',
    source_name: 'YDX market analysis'
  };
}

function parseWideSafeQuotes(text) {
  const extract = (label, fallback) => {
    const idx = text.toLowerCase().indexOf(label.toLowerCase());
    if (idx < 0) return fallback;
    const window = text.slice(idx, idx + 500);
    const m = window.match(/\$\s*([0-9]{1,2}(?:,[0-9]{3})?)/);
    return m ? parseMoney(m[1]) : fallback;
  };

  const baku = extract('Xi’an (Middle China)', 5000);
  const poti = extract('Poti, Georgia', 4400);
  const turkey = extract('Mersin / Istanbul, Turkey', 4700);

  if (![baku,poti,turkey].every(v=>Number.isFinite(v))) return null;
  return [
    {route:"Xi’an (China) → Baku/Absheron (Azerbaijan)",value_usd:baku,price_floor:false,container:'SOC 40HQ',source_url:'https://www.widesafe.com/news_en/35.html',source_name:'WideSafe'},
    {route:"Xi’an (China) → Poti (Georgia)",value_usd:poti,price_floor:false,container:'SOC 40HQ',source_url:'https://www.widesafe.com/news_en/35.html',source_name:'WideSafe'},
    {route:"Xi’an (China) → Mersin/Istanbul (Türkiye)",value_usd:turkey,price_floor:true,container:'SOC 40HQ',source_url:'https://www.widesafe.com/news_en/35.html',source_name:'WideSafe'}
  ];
}

function parseAsco40(text) {
  const normalized = text.replace(/\s+/g,' ');
  const patterns = [
    /40\s*feet\s*container[^0-9]{0,120}([0-9]{3,5})/i,
    /40\s*foot[^0-9]{0,120}([0-9]{3,5})/i,
    /40\s*futluq[^0-9]{0,120}([0-9]{3,5})/i
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    const v = m ? parseMoney(m[1]) : null;
    if (v && v >= 500 && v <= 5000) return v;
  }
  return null;
}

async function refreshPricing() {
  const checkedAt = new Date().toISOString();
  const next = {
    status: 'live',
    checked_at: checkedAt,
    review_required: false,
    sources: {},
    structural: structuredClone(PRICING_FALLBACK.structural),
    market: structuredClone(PRICING_FALLBACK.market)
  };

  // Current market assessment page (machine-readable HTML)
  try {
    const r = await fetchSource('https://ydxtrans.com/newsDetail/57.html', true);
    const changed = markHash('ydx', r.body);
    const parsed = parseYdxAssessment(stripHtml(r.body));
    if (parsed) next.market.assessment = parsed;
    next.sources.ydx = {ok:true, changed, parsed:!!parsed, last_modified:r.last_modified};
    if (changed && !parsed) next.review_required = true;
  } catch (err) {
    next.sources.ydx = {ok:false, error:String(err.message||err)};
  }

  // Current provider quotes (machine-readable HTML)
  try {
    const r = await fetchSource('https://www.widesafe.com/news_en/35.html', true);
    const changed = markHash('widesafe', r.body);
    const parsed = parseWideSafeQuotes(stripHtml(r.body));
    if (parsed) next.market.provider_quotes = parsed;
    next.sources.widesafe = {ok:true, changed, parsed:!!parsed, last_modified:r.last_modified};
    if (changed && !parsed) next.review_required = true;
  } catch (err) {
    next.sources.widesafe = {ok:false, error:String(err.message||err)};
  }

  // ASCO ferry tariff. Update only when the exact 40-foot row is still parseable.
  try {
    const r = await fetchSource('https://asco.az//en/pages/19/140', true);
    const changed = markHash('asco', r.body);
    const parsed = parseAsco40(stripHtml(r.body));
    if (parsed) next.structural.kuryk_alat.value_usd = parsed;
    next.sources.asco = {ok:true, changed, parsed:!!parsed, last_modified:r.last_modified};
    if (changed && !parsed) next.review_required = true;
  } catch (err) {
    next.sources.asco = {ok:false, error:String(err.message||err)};
  }

  // Official TITR PDFs: monitor the bytes every five minutes. We do not guess a
  // new tariff from unparsed PDF content. If the file changes, flag review.
  for (const [id,url] of [
    ['titr_dostyk_aktau','https://middlecorridor.com/images/tariffs/6.pdf'],
    ['titr_integrated','https://middlecorridor.com/images/tariffs/1.pdf']
  ]) {
    try {
      const r = await fetchSource(url, false);
      const changed = markHash(id, r.body);
      next.sources[id] = {ok:true, changed, parsed:false, last_modified:r.last_modified};
      if (changed) next.review_required = true;
    } catch (err) {
      next.sources[id] = {ok:false, error:String(err.message||err)};
    }
  }

  const successes = Object.values(next.sources).filter(x=>x.ok).length;
  if (!successes) next.status = 'offline';
  if (next.review_required) next.status = 'review_required';
  pricingState = next;
  console.log(`[PRICE] Sources checked. status=${next.status} review=${next.review_required}`);
}


const app = express();

app.disable('x-powered-by');

app.use(
  cors({
    origin:
      ALLOWED_ORIGIN === '*'
        ? true
        : ALLOWED_ORIGIN
  })
);

app.get('/', (_req, res) => {
  res
    .type('text')
    .send(
      'MCFI Caspian AIS backend'
    );
});

app.get(
  '/api/health',
  (_req, res) => {
    res.json({
      ok: true,
      status: wsState,
      provider: 'AISStream',
      last_message_at:
        lastMessageAt
    });
  }
);

app.get(
  '/api/caspian',
  (_req, res) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    res.json(
      publicSnapshot()
    );
  }
);


app.get(
  '/api/pricing',
  (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(pricingState);
  }
);

app.listen(
  PORT,
  () => {
    console.log(
      `MCFI AIS backend listening on :${PORT}`
    );

    connectAIS();
    refreshPricing().catch(err => console.error('[PRICE] Initial refresh failed:', err.message));
  }
);

setInterval(
  cleanup,
  5 * 60 * 1000
).unref();

setInterval(() => refreshPricing().catch(err => console.error('[PRICE] Refresh failed:', err.message)), PRICING_REFRESH_MS).unref();
