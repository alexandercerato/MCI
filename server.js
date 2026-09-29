import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.AISSTREAM_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

const boundsParts = String(
  process.env.CASPIAN_BOUNDS || '36.0,46.0,47.0,55.0'
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
        south: 36.0,
        west: 46.0,
        north: 47.0,
        east: 55.0
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

const EAST_ZONES = new Set([
  'Aktau',
  'Kuryk'
]);

const WEST_ZONES = new Set([
  'Alat',
  'Baku'
]);

const STALE_MS =
  30 * 60 * 1000;

const HARD_TTL_MS =
  2 * 60 * 60 * 1000;

const MAX_PUBLIC_VESSELS = 50;

fs.mkdirSync(
  DATA_DIR,
  { recursive: true }
);

const crossingFile =
  path.join(
    DATA_DIR,
    'crossings.json'
  );

function readJson(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
      )
    );
  } catch {
    return fallback;
  }
}

let crossings =
  readJson(
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

let wsState =
  API_KEY
    ? 'connecting'
    : 'not_configured';

let lastMessageAt = null;

let reconnectTimer = null;
let activeWs = null;


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
    Math.asin(
      Math.sqrt(q)
    )
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
  const n = Number(value);

  /*
    AIS:
    102.3 = speed not available.
  */

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
  const n = Number(value);

  /*
    AIS:
    360 = COG not available.
  */

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
  const n = Number(value);

  /*
    AIS:
    511 = heading not available.
  */

  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n >= 360
  ) {
    return null;
  }

  return n;
}

function normalizeCourse(cog) {
  const n =
    validCog(cog);

  if (n === null) {
    return null;
  }

  return (
    (n % 360) + 360
  ) % 360;
}


/* ============================================================
   DIRECTION
============================================================ */

function courseDirection(
  cog,
  sog
) {
  const speed =
    validSog(sog);

  if (
    speed === null ||
    speed < 1.5
  ) {
    return 'Stationary';
  }

  const c =
    normalizeCourse(cog);

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

  const dest =
    (
      v.destination || ''
    ).toUpperCase();

  if (
    /AKTAU|KURYK|ALAT|BAKU|BAKI/
      .test(dest)
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
      .sort(
        (a, b) => a - b
      );

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

    /*
      Remove obviously invalid
      crossing durations.
    */

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
        `[CROSSING] ${mmsi}: ${start.zone} -> ${newZone} (${hours.toFixed(2)} h)`
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
   AIS PARSING
============================================================ */

function parsePosition(event) {
  const meta =
    event?.MetaData || {};

  const body =
    event?.Message?.[
      event.MessageType
    ] || {};

  const lat =
    Number(
      meta.Latitude ??
      body.Latitude
    );

  const lon =
    Number(
      meta.Longitude ??
      body.Longitude
    );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null;
  }

  if (
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  const mmsi =
    String(
      meta.MMSI ??
      body.UserID ??
      ''
    );

  if (!mmsi) {
    return null;
  }

  return {
    mmsi,

    name:
      String(
        meta.ShipName || ''
      ).trim() || null,

    lat,

    lon,

    sog:
      validSog(
        body.Sog
      ),

    cog:
      validCog(
        body.Cog
      ),

    heading:
      validHeading(
        body.TrueHeading
      )
  };
}


/* ============================================================
   STATIC SHIP DATA
============================================================ */

function applyStatic(event) {
  const meta =
    event?.MetaData || {};

  const body =
    event?.Message?.[
      event.MessageType
    ] || {};

  const mmsi =
    String(
      meta.MMSI ??
      body.UserID ??
      ''
    );

  if (!mmsi) {
    return;
  }

  const old =
    vessels.get(mmsi) || {
      mmsi
    };

  const destination =
    body.Destination ||
    body.DestinationName ||
    old.destination ||
    null;

  vessels.set(
    mmsi,
    {
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
          ? String(
              destination
            ).trim()
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
    }
  );
}


/* ============================================================
   EVENT HANDLER
============================================================ */

function handleEvent(event) {
  lastMessageAt =
    new Date().toISOString();

  if (
    event?.MessageType ===
    'SubscriptionConfirmation'
  ) {
    wsState = 'live';

    console.log(
      '[AIS] Subscription confirmed'
    );

    return;
  }

  if (
    event?.MessageType ===
      'ShipStaticData' ||
    event?.MessageType ===
      'StaticDataReport'
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
    ].includes(
      event?.MessageType
    )
  ) {
    return;
  }

  const pos =
    parsePosition(event);

  if (!pos) {
    return;
  }

  const now =
    Date.now();

  const old =
    vessels.get(
      pos.mmsi
    ) || {};

  const newZone =
    zoneFor(
      pos.lat,
      pos.lon
    );

  const prevZone =
    old.zone || null;

  inferCrossing(
    pos.mmsi,
    prevZone,
    newZone,
    now
  );

  const next = {
    ...old,
    ...pos,

    zone:
      newZone,

    last_seen:
      new Date(
        now
      ).toISOString()
  };

  next.direction =
    courseDirection(
      next.cog,
      next.sog
    );

  next.corridor_candidate =
    corridorCandidate(next);

  vessels.set(
    pos.mmsi,
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
   RECONNECTION
============================================================ */

function scheduleReconnect(
  delay
) {
  if (reconnectTimer) {
    return;
  }

  console.log(
    `[AIS] Next connection attempt in ${Math.round(delay / 60000)} minute(s)`
  );

  reconnectTimer =
    setTimeout(
      () => {
        reconnectTimer = null;
        connectAIS();
      },
      delay
    );
}


/* ============================================================
   AISSTREAM CONNECTION
============================================================ */

function connectAIS() {
  if (!API_KEY) {
    wsState =
      'not_configured';

    console.error(
      '[AIS] AISSTREAM_API_KEY missing'
    );

    return;
  }

  if (
    activeWs &&
    (
      activeWs.readyState ===
        WebSocket.OPEN ||
      activeWs.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    console.log(
      '[AIS] Existing connection active; skipping duplicate connection'
    );

    return;
  }

  wsState =
    'connecting';

  console.log(
    '[AIS] Connecting to AISStream...'
  );

  const ws =
    new WebSocket(
      'wss://stream.aisstream.io/v0/stream',
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
        '[AIS] WebSocket opened. Sending subscription...'
      );

      const subscription = {
        APIKey:
          API_KEY,

        BoundingBoxes: [
          [
            [
              BOUNDS.south,
              BOUNDS.west
            ],
            [
              BOUNDS.north,
              BOUNDS.east
            ]
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
      };

      ws.send(
        JSON.stringify(
          subscription
        )
      );

      console.log(
        `[AIS] Subscription bounds: ${BOUNDS.south},${BOUNDS.west} -> ${BOUNDS.north},${BOUNDS.east}`
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

        handleEvent(event);

      } catch (err) {
        console.error(
          '[AIS] Parse error:',
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
        `[AIS] Handshake rejected: HTTP ${res.statusCode}`
      );

      res.on(
        'data',
        chunk => {
          console.error(
            '[AIS] Response:',
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
          ? 5 * 60 * 1000
          : 60 * 1000;

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
        '[AIS] WebSocket error:',
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
        `[AIS] Connection closed. code=${code} reason=${reason.toString()}`
      );

      scheduleReconnect(
        60 * 1000
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
            validSog(v.sog);

          return (
            speed !== null &&
            speed >= 1.5
          );
        }
      ).length,

    near_aktau:
      recent.filter(
        v =>
          v.zone ===
          'Aktau'
      ).length,

    near_kuryk:
      recent.filter(
        v =>
          v.zone ===
          'Kuryk'
      ).length,

    near_alat:
      recent.filter(
        v =>
          v.zone ===
          'Alat'
      ).length,

    near_baku:
      recent.filter(
        v =>
          v.zone ===
          'Baku'
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
        ).getTime() >=
        cutoff7
    );

  return {
    status:
      wsState,

    provider:
      'AISStream',

    updated_at:
      lastMessageAt,

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
              Number(
                c.hours
              )
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
        'MCFI Caspian AIS backend'
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
        'AISStream',

      last_message_at:
        lastMessageAt,

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
      `MCFI AIS backend listening on :${PORT}`
    );

    console.log(
      `[AIS] Configured bounds: ${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`
    );

    connectAIS();
  }
);


/* ============================================================
   PERIODIC CLEANUP
============================================================ */

setInterval(
  cleanup,
  5 * 60 * 1000
).unref();
