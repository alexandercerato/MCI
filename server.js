import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const OPENWATERS_API_KEY = process.env.OPENWATERS_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

const boundsParts = String(
  process.env.CASPIAN_BOUNDS || '39.0,48.0,45.2,53.0'
)
  .split(',')
  .map(Number);

const BOUNDS =
  boundsParts.length === 4 &&
  boundsParts.every(Number.isFinite)
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
  Aktau: {
    lat: 43.64,
    lon: 51.17,
    radiusNm: 15
  },
  Kuryk: {
    lat: 43.18,
    lon: 51.66,
    radiusNm: 15
  },
  Alat: {
    lat: 39.95,
    lon: 49.39,
    radiusNm: 15
  },
  Baku: {
    lat: 40.30,
    lon: 49.92,
    radiusNm: 15
  }
};

const EAST_ZONES = new Set(['Aktau', 'Kuryk']);
const WEST_ZONES = new Set(['Alat', 'Baku']);

const STALE_MS = 30 * 60 * 1000;
const HARD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PUBLIC_VESSELS = 100;

fs.mkdirSync(DATA_DIR, { recursive: true });

const crossingFile = path.join(
  DATA_DIR,
  'crossings.json'
);

function readJson(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
  } catch {
    return fallback;
  }
}

let crossings = readJson(
  crossingFile,
  []
);

if (!Array.isArray(crossings)) {
  crossings = [];
}

const vessels = new Map();
const journeyStarts = new Map();

const trackerSince =
  new Date().toISOString();

let useApiKey = Boolean(OPENWATERS_API_KEY);
let wsState = 'connecting';

let lastMessageAt = null;
let lastPositionAt = null;
let reconnectTimer = null;
let activeWs = null;
let lastSnapshotAt = null;


/* ============================================================
   STORAGE
============================================================ */

function persistCrossings() {
  try {
    fs.writeFileSync(
      crossingFile,
      JSON.stringify(
        crossings.slice(-1000),
        null,
        2
      )
    );
  } catch (err) {
    console.error(
      '[DATA] Could not save crossings:',
      err.message
    );
  }
}


/* ============================================================
   GEO
============================================================ */

function toRad(d) {
  return d * Math.PI / 180;
}

function distanceNm(
  aLat,
  aLon,
  bLat,
  bLon
) {
  const R = 3440.065;

  const dLat =
    toRad(bLat - aLat);

  const dLon =
    toRad(bLon - aLon);

  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLon / 2) ** 2;

  return (
    2 *
    R *
    Math.asin(Math.sqrt(q))
  );
}

function zoneFor(lat, lon) {
  for (
    const [name, p]
    of Object.entries(PORTS)
  ) {
    if (
      distanceNm(
        lat,
        lon,
        p.lat,
        p.lon
      ) <= p.radiusNm
    ) {
      return name;
    }
  }

  return null;
}


/* ============================================================
   AIS VALUE NORMALISATION
============================================================ */

function validSog(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n >= 102.3
  ) {
    return null;
  }

  return n;
}

function validCog(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n >= 360
  ) {
    return null;
  }

  return n;
}

function validHeading(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n >= 360
  ) {
    return null;
  }

  return n;
}


/* ============================================================
   DIRECTION
============================================================ */

function courseDirection(cog, sog) {
  const speed = validSog(sog);

  if (
    speed === null ||
    speed < 1.5
  ) {
    return 'Stationary';
  }

  const c = validCog(cog);

  if (c === null) {
    return 'Underway';
  }

  if (
    c >= 190 &&
    c <= 330
  ) {
    return 'Westbound';
  }

  if (
    c >= 10 &&
    c <= 150
  ) {
    return 'Eastbound';
  }

  return 'Underway';
}


/* ============================================================
   CORRIDOR FILTER
============================================================ */

function corridorCandidate(v) {
  if (v.zone) {
    return true;
  }

  const destination =
    String(
      v.destination || ''
    ).toUpperCase();

  if (
    /AKTAU|KURYK|ALAT|BAKU|BAKI/
      .test(destination)
  ) {
    return true;
  }

  const speed =
    validSog(v.sog);

  const direction =
    courseDirection(
      v.cog,
      v.sog
    );

  return (
    speed !== null &&
    speed >= 3 &&

    (
      direction === 'Westbound' ||
      direction === 'Eastbound'
    ) &&

    v.lat >= 39.3 &&
    v.lat <= 44.8 &&

    v.lon >= 48.4 &&
    v.lon <= 52.7
  );
}


/* ============================================================
   STATISTICS
============================================================ */

function median(nums) {
  const values =
    nums
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  if (!values.length) {
    return null;
  }

  const m =
    Math.floor(
      values.length / 2
    );

  return (
    values.length % 2
      ? values[m]
      : (
          values[m - 1] +
          values[m]
        ) / 2
  );
}


/* ============================================================
   CROSSING TRACKER
============================================================ */

function inferCrossing(
  mmsi,
  prevZone,
  newZone,
  now
) {
  if (
    !newZone ||
    newZone === prevZone
  ) {
    return;
  }

  const side =
    EAST_ZONES.has(newZone)
      ? 'east'
      : WEST_ZONES.has(newZone)
        ? 'west'
        : null;

  if (!side) {
    return;
  }

  const start =
    journeyStarts.get(mmsi);

  if (
    start &&
    start.side !== side
  ) {
    const hours =
      (
        now -
        start.at
      ) / 3600000;

    if (
      hours >= 4 &&
      hours <= 72
    ) {
      crossings.push({
        mmsi:
          String(mmsi),

        from:
          start.zone,

        to:
          newZone,

        departed_at:
          new Date(
            start.at
          ).toISOString(),

        arrived_at:
          new Date(
            now
          ).toISOString(),

        hours:
          Number(
            hours.toFixed(2)
          )
      });

      persistCrossings();

      console.log(
        `[CROSSING] ${mmsi}: ${start.zone} -> ${newZone} (${hours.toFixed(2)}h)`
      );
    }

    journeyStarts.delete(mmsi);
  }

  journeyStarts.set(
    mmsi,
    {
      side,
      zone: newZone,
      at: now
    }
  );
}


/* ============================================================
   OPEN WATERS EVENT PARSER
============================================================ */

function handleOpenWatersEvent(event) {
  if (!event) {
    return;
  }

  /*
    Initial connection information.
  */

  if (event.type === 'welcome') {
    wsState = 'subscribing';

    console.log(
      '[OPENWATERS] Welcome received'
    );

    if (event.limits) {
      console.log(
        '[OPENWATERS] Limits:',
        JSON.stringify(event.limits)
      );
    }

    return;
  }

  /*
    Open Waters reports subscription / protocol errors
    as an error frame.
  */

  if (event.type === 'error') {
    const message = String(event.error || event || '');
    wsState = 'error';

    console.error(
      '[OPENWATERS] Error:',
      message
    );

    if (useApiKey && /token.*not valid|invalid token|from this address/i.test(message)) {
      useApiKey = false;
      console.warn('[OPENWATERS] Falling back to anonymous access');
    }

    return;
  }

  if (event.type !== 'event') {
    return;
  }

  lastMessageAt =
    new Date().toISOString();

  wsState = 'live';

  const mmsi =
    String(
      event.mmsi || ''
    );

  if (!mmsi) {
    return;
  }

  const old =
    vessels.get(mmsi) || {
      mmsi
    };

  const body =
    event.message || {};

  /*
    Static information can arrive separately
    from position information.
  */

  const possibleName =
    body.Name ??
    body.ShipName ??
    body.VesselName ??
    old.name ??
    null;

  const possibleDestination =
    body.Destination ??
    body.DestinationName ??
    old.destination ??
    null;

  const possibleType =
    body.Type ??
    body.ShipType ??
    old.ship_type ??
    null;

  const next = {
    ...old,

    mmsi,

    name:
      possibleName
        ? String(
            possibleName
          ).trim()
        : null,

    destination:
      possibleDestination
        ? String(
            possibleDestination
          ).trim()
        : null,

    ship_type:
      possibleType,

    source:
      event.source ||
      old.source ||
      null,

    station:
      event.station ||
      old.station ||
      null,

    msg_type:
      event.msg_type ||
      old.msg_type ||
      null
  };

  /*
    Open Waters includes lat/lon on an event whenever
    the vessel has a known current position.
  */

  const lat =
    Number(event.lat);

  const lon =
    Number(event.lon);

  if (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  ) {
    next.lat = lat;
    next.lon = lon;

    lastPositionAt =
      new Date().toISOString();

    /*
      Snapshot events retain their original time.
      Prefer that over the moment our server received them.
    */

    next.last_seen =
      event.time ||
      new Date().toISOString();

    next.synthesized =
      Boolean(event.synthesized);

    const oldZone =
      old.zone || null;

    const newZone =
      zoneFor(
        lat,
        lon
      );

    next.zone =
      newZone;

    inferCrossing(
      mmsi,
      oldZone,
      newZone,
      new Date(
        next.last_seen
      ).getTime()
    );
  }

  /*
    go-ais decoded fields.
  */

  if (
    body.Sog !== undefined
  ) {
    next.sog =
      validSog(
        body.Sog
      );
  }

  if (
    body.Cog !== undefined
  ) {
    next.cog =
      validCog(
        body.Cog
      );
  }

  if (
    body.TrueHeading !== undefined
  ) {
    next.heading =
      validHeading(
        body.TrueHeading
      );
  }

  next.direction =
    courseDirection(
      next.cog,
      next.sog
    );

  next.corridor_candidate =
    corridorCandidate(next);

  vessels.set(
    mmsi,
    next
  );
}


/* ============================================================
   CLEANUP
============================================================ */

function cleanup() {
  const cutoff =
    Date.now() -
    HARD_TTL_MS;

  for (
    const [mmsi, vessel]
    of vessels
  ) {
    if (
      !vessel.last_seen ||
      new Date(
        vessel.last_seen
      ).getTime() < cutoff
    ) {
      vessels.delete(mmsi);
    }
  }
}


/* ============================================================
   OPEN WATERS HTTP SNAPSHOT
============================================================ */

function featureValue(props, ...keys) {
  for (const key of keys) {
    if (props && props[key] !== undefined && props[key] !== null) return props[key];
  }
  return null;
}

async function refreshOpenWatersSnapshot() {
  const bbox = [BOUNDS.south, BOUNDS.west, BOUNDS.north, BOUNDS.east].join(',');
  const url = 'https://ais.openwaters.io/v1/vessels?bbox=' + encodeURIComponent(bbox) + '&max_age=30m';

  try {
    const res = await fetch(url, {
      headers: { 'accept': 'application/geo+json, application/json' }
    });

    if (!res.ok) {
      throw new Error('Snapshot HTTP ' + res.status);
    }

    const geo = await res.json();
    const features = Array.isArray(geo?.features) ? geo.features : [];
    const nowIso = new Date().toISOString();

    for (const feature of features) {
      const props = feature?.properties || {};
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;

      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const rawMmsi = featureValue(props, 'mmsi', 'MMSI', 'id') ?? feature?.id;
      const mmsi = String(rawMmsi || '').replace(/^mmsi[:/]/i,'');
      if (!mmsi) continue;

      const old = vessels.get(mmsi) || { mmsi };
      const sog = validSog(featureValue(props, 'sog', 'Sog', 'speed'));
      const cog = validCog(featureValue(props, 'cog', 'Cog', 'course'));
      const heading = validHeading(featureValue(props, 'heading', 'TrueHeading', 'true_heading'));
      const seen = featureValue(props, 'seen', 'time', 'last_seen', 'timestamp') || nowIso;

      const next = {
        ...old,
        mmsi,
        name: String(featureValue(props, 'name', 'Name', 'ShipName', 'ship_name') || old.name || '').trim() || null,
        destination: String(featureValue(props, 'destination', 'Destination') || old.destination || '').trim() || null,
        ship_type: featureValue(props, 'ship_type', 'ShipType', 'type') ?? old.ship_type ?? null,
        lat,
        lon,
        sog: sog ?? old.sog ?? null,
        cog: cog ?? old.cog ?? null,
        heading: heading ?? old.heading ?? null,
        zone: zoneFor(lat, lon),
        source: featureValue(props, 'source') || 'Open Waters snapshot',
        last_seen: seen
      };

      next.direction = courseDirection(next.cog, next.sog);
      next.corridor_candidate = corridorCandidate(next);
      vessels.set(mmsi, next);
    }

    lastSnapshotAt = nowIso;
    lastMessageAt = nowIso;
    if (features.length || wsState !== 'live') wsState = 'live';
    console.log('[OPENWATERS] Snapshot loaded: ' + features.length + ' vessels');
  } catch (err) {
    console.error('[OPENWATERS] Snapshot error:', err.message);
  }
}


/* ============================================================
   RECONNECT
============================================================ */

function scheduleReconnect(delay) {
  if (reconnectTimer) {
    return;
  }

  console.log(
    `[OPENWATERS] Next connection attempt in ${Math.round(delay / 1000)} seconds`
  );

  reconnectTimer =
    setTimeout(
      () => {
        reconnectTimer = null;
        connectOpenWaters();
      },
      delay
    );
}


/* ============================================================
   OPEN WATERS CONNECTION
============================================================ */

function connectOpenWaters() {
  if (
    activeWs &&
    (
      activeWs.readyState ===
        WebSocket.OPEN ||
      activeWs.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return;
  }

  wsState =
    'connecting';

  console.log(
    '[OPENWATERS] Connecting...'
  );

  const url =
    'wss://ais.openwaters.io/v1/stream' +
    (useApiKey && OPENWATERS_API_KEY
      ? '?key=' + encodeURIComponent(OPENWATERS_API_KEY)
      : '');

  const ws =
    new WebSocket(
      url,
      {
        perMessageDeflate: true
      }
    );

  activeWs = ws;

  ws.on(
    'open',
    () => {
      wsState =
        'subscribing';

      console.log(
        '[OPENWATERS] WebSocket opened'
      );

      const subscription = {
        type:
          'subscribe',

        bbox: [
          [
            BOUNDS.south,
            BOUNDS.west,
            BOUNDS.north,
            BOUNDS.east
          ]
        ],

        /*
          Immediately replay last-known vessel state
          from the previous 30 minutes.
        */
        snapshot:
          true
      };

      ws.send(
        JSON.stringify(
          subscription
        )
      );

      console.log(
        `[OPENWATERS] Subscription sent: ${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`
      );
    }
  );

  ws.on(
    'message',
    raw => {
      try {
        const event =
          JSON.parse(
            raw.toString(
              'utf8'
            )
          );

        handleOpenWatersEvent(
          event
        );

      } catch (err) {
        console.error(
          '[OPENWATERS] Parse error:',
          err.message
        );
      }
    }
  );

  ws.on(
    'unexpected-response',
    (_req, res) => {
      wsState =
        'offline';

      console.error(
        `[OPENWATERS] HTTP ${res.statusCode} ${res.statusMessage || ''}`
      );

      res.on(
        'data',
        chunk => {
          console.error(
            '[OPENWATERS] Response:',
            chunk.toString()
          );
        }
      );

      if (
        activeWs === ws
      ) {
        activeWs = null;
      }

      const delay =
        res.statusCode === 429
          ? 60 * 1000
          : 30 * 1000;

      scheduleReconnect(
        delay
      );
    }
  );

  ws.on(
    'error',
    err => {
      wsState =
        'offline';

      console.error(
        '[OPENWATERS] WebSocket error:',
        err.message
      );
    }
  );

  ws.on(
    'close',
    (
      code,
      reason
    ) => {
      wsState =
        'offline';

      if (
        activeWs === ws
      ) {
        activeWs = null;
      }

      console.log(
        `[OPENWATERS] Connection closed: ${code} ${reason.toString()}`
      );

      scheduleReconnect(
        30 * 1000
      );
    }
  );
}


/* ============================================================
   PUBLIC SNAPSHOT
============================================================ */

function publicSnapshot() {
  cleanup();

  const cutoff =
    Date.now() -
    STALE_MS;

  const recent =
    [
      ...vessels.values()
    ].filter(
      v =>
        v.last_seen &&
        new Date(
          v.last_seen
        ).getTime() >= cutoff
    );

  recent.forEach(
    v => {
      v.direction =
        courseDirection(
          v.cog,
          v.sog
        );

      v.corridor_candidate =
        corridorCandidate(v);
    }
  );

  recent.sort(
    (a, b) =>
      Number(
        b.corridor_candidate
      ) -
        Number(
          a.corridor_candidate
        ) ||

      Number(
        validSog(b.sog) || 0
      ) -
        Number(
          validSog(a.sog) || 0
        )
  );

  const summary = {
    vessels_30m:
      recent.length,

    underway:
      recent.filter(
        v => {
          const speed =
            validSog(
              v.sog
            );

          return (
            speed !== null &&
            speed >= 1.5
          );
        }
      ).length,

    near_aktau:
      recent.filter(
        v =>
          v.zone === 'Aktau'
      ).length,

    near_kuryk:
      recent.filter(
        v =>
          v.zone === 'Kuryk'
      ).length,

    near_alat:
      recent.filter(
        v =>
          v.zone === 'Alat'
      ).length,

    near_baku:
      recent.filter(
        v =>
          v.zone === 'Baku'
      ).length,

    westbound:
      recent.filter(
        v =>
          v.corridor_candidate &&
          v.direction ===
            'Westbound'
      ).length,

    eastbound:
      recent.filter(
        v =>
          v.corridor_candidate &&
          v.direction ===
            'Eastbound'
      ).length
  };

  const cutoff7 =
    Date.now() -
    7 * 86400000;

  const crossings7d =
    crossings.filter(
      c =>
        new Date(
          c.arrived_at
        ).getTime() >= cutoff7
    );

  return {
    status:
      wsState,

    provider:
      'Open Waters',

    updated_at:
      lastMessageAt,

    last_position_at:
      lastPositionAt,

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
            c =>
              Number(c.hours)
          )
        )
    },

    vessels:
      recent
        .slice(
          0,
          MAX_PUBLIC_VESSELS
        )
        .map(
          v => ({
            mmsi:
              v.mmsi,

            name:
              v.name,

            lat:
              v.lat,

            lon:
              v.lon,

            sog:
              validSog(
                v.sog
              ),

            cog:
              validCog(
                v.cog
              ),

            heading:
              validHeading(
                v.heading
              ),

            zone:
              v.zone,

            direction:
              v.direction,

            corridor_candidate:
              v.corridor_candidate,

            destination:
              v.destination ||
              null,

            ship_type:
              v.ship_type ??
              null,

            source:
              v.source ||
              null,

            last_seen:
              v.last_seen
          })
        )
  };
}


/* ============================================================
   HTTP API
============================================================ */

const app = express();

app.disable(
  'x-powered-by'
);

app.use(
  cors({
    origin:
      ALLOWED_ORIGIN === '*'
        ? true
        : ALLOWED_ORIGIN
  })
);

app.get(
  '/',
  (_req, res) => {
    res
      .type('text')
      .send(
        'MCFI Caspian AIS backend — Open Waters'
      );
  }
);

app.get(
  '/api/health',
  (_req, res) => {
    res.json({
      ok: true,

      status:
        wsState,

      provider:
        'Open Waters',

      last_message_at:
        lastMessageAt,

      last_position_at:
        lastPositionAt,

      last_snapshot_at:
        lastSnapshotAt,

      bounds:
        BOUNDS,

      tracked_vessels:
        vessels.size
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


/* ============================================================
   START
============================================================ */

app.listen(
  PORT,
  () => {
    console.log(
      `MCFI Open Waters backend listening on :${PORT}`
    );

    console.log(
      `[OPENWATERS] Bounds: ${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`
    );

    refreshOpenWatersSnapshot();
    connectOpenWaters();
  }
);


/* ============================================================
   CLEANUP
============================================================ */

setInterval(
  cleanup,
  5 * 60 * 1000
).unref();

setInterval(
  refreshOpenWatersSnapshot,
  60 * 1000
).unref();
