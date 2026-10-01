import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const OPENWATERS_API_KEY = process.env.OPENWATERS_API_KEY || '';
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY || '';
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
const FALLBACK_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_MS = 365 * 24 * 60 * 60 * 1000;
const HARD_TTL_MS = ARCHIVE_MS;
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

let aisStreamState = AISSTREAM_API_KEY ? 'connecting' : 'disabled';
let activeAisStreamWs = null;
let aisStreamReconnectTimer = null;
let lastAisStreamMessageAt = null;
let fachaState = 'connecting';
let lastFachaSnapshotAt = null;


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
   AISSTREAM SECONDARY FEED
============================================================ */

function parseAisStreamTime(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(String(value).replace(' +0000 UTC','Z'));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function handleAisStreamEvent(event) {
  if (!event) return;

  if (event.MessageType === 'SubscriptionConfirmation') {
    aisStreamState = 'live';
    console.log('[AISSTREAM] Subscription confirmed');
    return;
  }

  const type = event.MessageType;
  const meta = event.MetaData || {};
  const body = event.Message?.[type] || {};

  const rawMmsi = meta.MMSI ?? meta.MMSI_String ?? body.UserID ?? body.MMSI;
  const mmsi = String(rawMmsi || '');
  if (!mmsi) return;

  const old = vessels.get(mmsi) || { mmsi };
  const next = { ...old, mmsi };

  const possibleName = meta.ShipName ?? body.Name ?? body.ShipName ?? old.name ?? null;
  const possibleDestination = body.Destination ?? old.destination ?? null;
  const possibleType = body.Type ?? body.ShipType ?? old.ship_type ?? null;

  next.name = possibleName ? String(possibleName).trim() : null;
  next.destination = possibleDestination ? String(possibleDestination).trim() : null;
  next.ship_type = possibleType;
  next.source = 'AISStream';
  next.msg_type = type || old.msg_type || null;

  const lat = Number(meta.Latitude ?? meta.latitude ?? body.Latitude ?? body.latitude);
  const lon = Number(meta.Longitude ?? meta.longitude ?? body.Longitude ?? body.longitude);

  const seen = parseAisStreamTime(meta.time_utc ?? meta.TimeUTC ?? meta.Timestamp);
  lastAisStreamMessageAt = new Date().toISOString();
  lastMessageAt = lastAisStreamMessageAt;
  aisStreamState = 'live';

  if (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= BOUNDS.south &&
    lat <= BOUNDS.north &&
    lon >= BOUNDS.west &&
    lon <= BOUNDS.east
  ) {
    next.lat = lat;
    next.lon = lon;
    next.last_seen = seen;

    const oldZone = old.zone || null;
    const newZone = zoneFor(lat, lon);
    next.zone = newZone;

    const seenMs = new Date(seen).getTime();
    if (Number.isFinite(seenMs)) {
      lastPositionAt = seen;
      inferCrossing(mmsi, oldZone, newZone, seenMs);
    }
  }

  if (body.Sog !== undefined) next.sog = validSog(body.Sog);
  if (body.Cog !== undefined) next.cog = validCog(body.Cog);
  if (body.TrueHeading !== undefined) next.heading = validHeading(body.TrueHeading);

  next.direction = courseDirection(next.cog, next.sog);
  next.corridor_candidate = corridorCandidate(next);

  if (Number.isFinite(next.lat) && Number.isFinite(next.lon)) {
    vessels.set(mmsi, next);
  }
}

function scheduleAisStreamReconnect(delay=30000) {
  if (!AISSTREAM_API_KEY || aisStreamReconnectTimer) return;
  aisStreamReconnectTimer = setTimeout(() => {
    aisStreamReconnectTimer = null;
    connectAisStream();
  }, delay);
}

function connectAisStream() {
  if (!AISSTREAM_API_KEY) {
    aisStreamState = 'disabled';
    return;
  }

  if (
    activeAisStreamWs &&
    (activeAisStreamWs.readyState === WebSocket.OPEN ||
     activeAisStreamWs.readyState === WebSocket.CONNECTING)
  ) return;

  aisStreamState = 'connecting';
  console.log('[AISSTREAM] Connecting...');

  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream', {
    perMessageDeflate: true
  });
  activeAisStreamWs = ws;

  ws.on('open', () => {
    const subscription = {
      APIKey: AISSTREAM_API_KEY,
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
        'ShipStaticData',
        'StaticDataReport'
      ]
    };

    ws.send(JSON.stringify(subscription));
    console.log('[AISSTREAM] Subscription sent: ' +
      BOUNDS.south + ',' + BOUNDS.west + ',' + BOUNDS.north + ',' + BOUNDS.east);
  });

  ws.on('message', raw => {
    try {
      handleAisStreamEvent(JSON.parse(raw.toString('utf8')));
    } catch (err) {
      console.error('[AISSTREAM] Parse error:', err.message);
    }
  });

  ws.on('error', err => {
    aisStreamState = 'offline';
    console.error('[AISSTREAM] WebSocket error:', err.message);
  });

  ws.on('close', (code, reason) => {
    aisStreamState = 'offline';
    if (activeAisStreamWs === ws) activeAisStreamWs = null;
    console.log('[AISSTREAM] Connection closed: ' + code + ' ' + reason.toString());
    scheduleAisStreamReconnect(code === 1008 ? 60000 : 30000);
  });
}


/* ============================================================
   FACHA.DEV SNAPSHOT FALLBACK
============================================================ */

const FACHA_REFRESH_MS = 5 * 60 * 1000;
const FACHA_AREAS = [
  { name:'Aktau', lat:43.64, lon:51.17, radiusKm:30 },
  { name:'Caspian 1', lat:43.18, lon:50.95, radiusKm:30 },
  { name:'Caspian 2', lat:42.72, lon:50.73, radiusKm:30 },
  { name:'Caspian 3', lat:42.26, lon:50.50, radiusKm:30 },
  { name:'Central Caspian', lat:41.80, lon:50.28, radiusKm:30 },
  { name:'Caspian 5', lat:41.34, lon:50.06, radiusKm:30 },
  { name:'Caspian 6', lat:40.88, lon:49.84, radiusKm:30 },
  { name:'Caspian 7', lat:40.42, lon:49.62, radiusKm:30 },
  { name:'Baku-Alat', lat:39.96, lon:49.40, radiusKm:30 }
];

async function refreshFachaSnapshot() {
  let successful = 0;
  let rows = [];

  for (const area of FACHA_AREAS) {
    const url =
      'https://api.facha.dev/v1/ship/radius/' +
      area.lat + '/' + area.lon + '/' + area.radiusKm;

    try {
      const res = await fetch(url, {
        headers: { 'accept':'application/json', 'user-agent':'MCFI-Caspian-Monitor/1.0' }
      });

      if (!res.ok) {
        console.warn('[FACHA] ' + area.name + ' HTTP ' + res.status);
        continue;
      }

      const data = await res.json();
      if (Array.isArray(data)) rows.push(...data);
      successful += 1;
    } catch (err) {
      console.warn('[FACHA] ' + area.name + ' error: ' + err.message);
    }
  }

  const unique = new Map();
  for (const row of rows) {
    const mmsi = String(row?.mmsi || '');
    if (!mmsi) continue;

    const lat = Number(row?.latitude);
    const lon = Number(row?.longitude);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < BOUNDS.south || lat > BOUNDS.north ||
      lon < BOUNDS.west || lon > BOUNDS.east
    ) continue;

    const seen = row?.timestamp ? new Date(row.timestamp) : new Date();
    if (!Number.isFinite(seen.getTime())) continue;

    const previous = unique.get(mmsi);
    if (!previous || new Date(previous.timestamp).getTime() < seen.getTime()) {
      unique.set(mmsi, row);
    }
  }

  let accepted = 0;
  let newest = null;

  for (const row of unique.values()) {
    const mmsi = String(row.mmsi);
    const seen = new Date(row.timestamp).toISOString();
    const seenMs = new Date(seen).getTime();
    const old = vessels.get(mmsi) || { mmsi };
    const oldMs = old.last_seen ? new Date(old.last_seen).getTime() : -Infinity;

    if (Number.isFinite(oldMs) && oldMs > seenMs) continue;

    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    const oldZone = old.zone || null;
    const newZone = zoneFor(lat, lon);

    const next = {
      ...old,
      mmsi,
      name: row.name ? String(row.name).trim() : (old.name || null),
      destination: row.destination ? String(row.destination).trim() : (old.destination || null),
      ship_type: row.type ?? row.vesselType ?? old.ship_type ?? null,
      lat,
      lon,
      sog: validSog(row.speedOverGround) ?? old.sog ?? null,
      cog: validCog(row.courseOverGround) ?? old.cog ?? null,
      heading: validHeading(row.heading) ?? old.heading ?? null,
      zone: newZone,
      source: 'facha.dev',
      msg_type: 'radius-snapshot',
      last_seen: seen
    };

    next.direction = courseDirection(next.cog, next.sog);
    next.corridor_candidate = corridorCandidate(next);
    vessels.set(mmsi, next);
    inferCrossing(mmsi, oldZone, newZone, seenMs);

    if (!newest || seenMs > newest) newest = seenMs;
    accepted += 1;
  }

  lastFachaSnapshotAt = new Date().toISOString();
  fachaState = successful ? 'live' : 'offline';

  if (Number.isFinite(newest)) {
    const iso = new Date(newest).toISOString();
    if (!lastPositionAt || new Date(lastPositionAt).getTime() < newest) {
      lastPositionAt = iso;
    }
  }

  console.log('[FACHA] Snapshot: ' + accepted + ' vessels from ' + successful + '/' + FACHA_AREAS.length + ' areas');
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
  const url = 'https://ais.openwaters.io/v1/vessels?bbox=' + encodeURIComponent(bbox) + '&max_age=all';

  try {
    const headers = { 'accept': 'application/geo+json, application/json' };
    if (OPENWATERS_API_KEY) headers.authorization = 'Bearer ' + OPENWATERS_API_KEY;
    const res = await fetch(url, { headers });

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

    const newestSeen = features
      .map(f => featureValue(f?.properties || {}, 'seen', 'time', 'last_seen', 'timestamp'))
      .filter(Boolean)
      .map(x => new Date(x).getTime())
      .filter(Number.isFinite)
      .sort((a,b) => b-a)[0];

    if (Number.isFinite(newestSeen)) {
      lastPositionAt = new Date(newestSeen).toISOString();
    }

    if (features.length || wsState !== 'live') wsState = 'live';
    const liveCount = [...vessels.values()].filter(v => v.last_seen && new Date(v.last_seen).getTime() >= Date.now() - STALE_MS).length;
    console.log('[OPENWATERS] Snapshot loaded: ' + features.length + ' vessels · live 30m: ' + liveCount);
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

  const now = Date.now();
  const liveCutoff = now - STALE_MS;
  const fallbackCutoff = now - FALLBACK_MS;
  const archiveCutoff = now - ARCHIVE_MS;

  const all = [...vessels.values()].filter(v => {
    if (!v.last_seen) return false;
    const t = new Date(v.last_seen).getTime();
    return Number.isFinite(t) && t >= archiveCutoff;
  });

  const recent = all.filter(v => new Date(v.last_seen).getTime() >= liveCutoff);
  const day = all.filter(v => new Date(v.last_seen).getTime() >= fallbackCutoff);
  const displayMode = recent.length ? 'live' : (day.length ? 'last_known' : (all.length ? 'archive' : 'empty'));
  const displayRows = recent.length ? recent : (day.length ? day : all);
  const display = displayRows
    .map(v => {
      const ageSeconds = Math.max(0, Math.floor((now - new Date(v.last_seen).getTime()) / 1000));
      const copy = {...v};
      copy.direction = courseDirection(copy.cog, copy.sog);
      copy.corridor_candidate = corridorCandidate(copy);
      copy.age_seconds = ageSeconds;
      copy.stale = ageSeconds > (STALE_MS / 1000);
      return copy;
    })
    .sort((a,b) =>
      Number(b.corridor_candidate) - Number(a.corridor_candidate) ||
      Number(validSog(b.sog) || 0) - Number(validSog(a.sog) || 0) ||
      Number(a.age_seconds || 0) - Number(b.age_seconds || 0)
    );

  const summarize = rows => ({
    vessels_display: rows.length,
    vessels_30m: recent.length,
    underway: rows.filter(v => {
      const speed = validSog(v.sog);
      return speed !== null && speed >= 1.5;
    }).length,
    near_aktau: rows.filter(v => v.zone === 'Aktau').length,
    near_kuryk: rows.filter(v => v.zone === 'Kuryk').length,
    near_alat: rows.filter(v => v.zone === 'Alat').length,
    near_baku: rows.filter(v => v.zone === 'Baku').length,
    westbound: rows.filter(v => corridorCandidate(v) && courseDirection(v.cog,v.sog) === 'Westbound').length,
    eastbound: rows.filter(v => corridorCandidate(v) && courseDirection(v.cog,v.sog) === 'Eastbound').length
  });

  const cutoff7 = now - 7 * 86400000;
  const crossings7d = crossings.filter(c => new Date(c.arrived_at).getTime() >= cutoff7);

  return {
    status: (wsState === 'live' || aisStreamState === 'live') ? 'live' :
      ((wsState === 'connecting' || wsState === 'subscribing' || aisStreamState === 'connecting') ? 'connecting' : 'offline'),
    provider: AISSTREAM_API_KEY ? 'Open Waters + AISStream + facha.dev' : 'Open Waters + facha.dev',
    display_mode: displayMode,
    display_window: displayMode === 'live' ? '30m' : (displayMode === 'last_known' ? '24h' : (displayMode === 'archive' ? 'archive' : null)),
    updated_at: lastMessageAt,
    last_position_at: lastPositionAt,
    tracker_since: trackerSince,
    bounds: BOUNDS,
    summary: summarize(display),
    live_summary: summarize(recent),
    crossings: {
      count: crossings7d.length,
      median_hours: median(crossings7d.map(c => Number(c.hours)))
    },
    vessels: display
      .slice(0, MAX_PUBLIC_VESSELS)
      .map(v => ({
        mmsi: v.mmsi,
        name: v.name,
        lat: v.lat,
        lon: v.lon,
        sog: validSog(v.sog),
        cog: validCog(v.cog),
        heading: validHeading(v.heading),
        zone: v.zone,
        direction: v.direction,
        corridor_candidate: v.corridor_candidate,
        destination: v.destination || null,
        ship_type: v.ship_type ?? null,
        source: v.source || null,
        last_seen: v.last_seen,
        age_seconds: v.age_seconds,
        stale: v.stale
      }))
  };
}

/* ============================================================
   MIDDLE CORRIDOR NEWS
============================================================ */

const NEWS_REFRESH_MS = 5 * 60 * 1000;
let newsCache = {
  status: 'connecting',
  updated_at: null,
  items: []
};

const FALLBACK_NEWS = [
  {
    title: 'New Sorting Tracks at Khorgos Gateway Increase Terminal Capacity by 48%',
    url: 'https://www.ktze.kz/en/news/0bb00126-8e18-4b4b-add2-b02ddd7260b0',
    source: 'KTZ Express',
    published_at: '2026-07-13T00:00:00Z'
  },
  {
    title: 'KTZ Express and Pasifik Eurasia Develop Eastbound Backhaul via the Middle Corridor',
    url: 'https://www.ktze.kz/en/news/bd9b0191-0328-4cfe-a9dc-e410ff6d5ea1',
    source: 'KTZ Express',
    published_at: '2026-05-08T00:00:00Z'
  },
  {
    title: 'Development of Container Transportation along the Middle Corridor: New Logistics Solutions',
    url: 'https://www.ktze.kz/en/news/da815d04-a0e5-42e8-9497-81af8dadbeed',
    source: 'KTZ Express',
    published_at: '2026-04-14T00:00:00Z'
  }
];

function decodeXml(value='') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>');
}

function tagValue(block, tag) {
  const m=block.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'));
  return m ? decodeXml(m[1].trim()) : '';
}

async function refreshNews() {
  const q=encodeURIComponent('"Middle Corridor" OR "Trans-Caspian International Transport Route" OR TITR');
  const url='https://news.google.com/rss/search?q='+q+'&hl=en&gl=GB&ceid=GB:en';

  try {
    const res=await fetch(url,{headers:{'user-agent':'MCFI-Middle-Corridor-Monitor/1.0'}});
    if(!res.ok) throw new Error('RSS HTTP '+res.status);
    const xml=await res.text();
    const blocks=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
    const items=blocks.map(block=>{
      const sourceMatch=block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      return {
        title:tagValue(block,'title'),
        url:tagValue(block,'link'),
        source:sourceMatch?decodeXml(sourceMatch[1].trim()):'Google News',
        published_at:tagValue(block,'pubDate')
      };
    }).filter(x=>x.title&&x.url)
      .sort((a,b)=>new Date(b.published_at)-new Date(a.published_at))
      .slice(0,12);

    newsCache={
      status:'live',
      updated_at:new Date().toISOString(),
      items:items.length?items:FALLBACK_NEWS
    };
    console.log('[NEWS] Refreshed: '+newsCache.items.length+' stories');
  } catch(err) {
    console.error('[NEWS] Refresh error:',err.message);
    newsCache={
      status:newsCache.items.length?'live':'offline',
      updated_at:newsCache.updated_at||new Date().toISOString(),
      items:newsCache.items.length?newsCache.items:FALLBACK_NEWS
    };
  }
}



/* ============================================================
   CASPIAN OFFICIAL VESSEL OPERATIONS
============================================================ */

const PORT_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;
const KURYK_TRAFFIC_URL = 'https://portkuryk.kz/en/dispoziciya-sudov';
const AKTAU_DISPOSITION_CSV = 'https://docs.google.com/spreadsheets/d/11zcV4XTC4YmjR_TCAZv5ErH4fONk9Plyevxje_JnHzo/export?format=csv';

const CASPIAN_POINTS = {
  alat: { lat: 39.95, lon: 49.39 },
  baku: { lat: 40.30, lon: 49.92 },
  aktau: { lat: 43.64, lon: 51.17 },
  kuryk: { lat: 43.18, lon: 51.66 }
};

let portActivityCache = {
  status: 'connecting',
  updated_at: null,
  sources: {
    aktau: 'Aktau Port official vessel disposition',
    kuryk: 'Port Kuryk official vessel traffic'
  },
  aktau: null,
  kuryk: null,
  errors: []
};

function decodeHtmlText(value='') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/\s+/g,' ')
    .trim();
}

function splitVesselNames(value='') {
  return String(value)
    .split(/[,;]+/)
    .map(x => x.replace(/^т\/х\.?\s*/i,'').replace(/^п\.?\s*/i,'').trim())
    .filter(Boolean);
}

function parseCsv(text='') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i=0; i<text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"' && text[i+1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/,''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/,''));
    rows.push(row);
  }

  return rows;
}

function cleanAktauVesselName(value='') {
  return String(value)
    .replace(/^т\/х\s*/i,'')
    .replace(/^пбу\s*/i,'PBU ')
    .replace(/^п\.?\s*/i,'')
    .replace(/^"|"$/g,'')
    .trim();
}

function parseKurykLocalEta(value, year) {
  const m = String(value||'').match(/(\d{1,2})\.(\d{1,2})\s*\/\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const hour = Number(m[3]);
  const minute = Number(m[4]);

  // Kazakhstan uses UTC+5 nationwide. Convert Kuryk local time to UTC.
  const ms = Date.UTC(year, month-1, day, hour-5, minute, 0);
  return Number.isFinite(ms) ? ms : null;
}

function estimatedFerryPosition(approach, trafficDate) {
  const yearMatch = String(trafficDate||'').match(/(20\d{2})/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getUTCFullYear();
  const etaMs = parseKurykLocalEta(approach.eta, year);
  if (!Number.isFinite(etaMs)) return { ...approach, estimate_status:'unknown' };

  const durationMs = 18 * 60 * 60 * 1000;
  const departureMs = etaMs - durationMs;
  const now = Date.now();

  let progress;
  let estimate_status;

  if (now < departureMs) {
    progress = 0;
    estimate_status = 'scheduled';
  } else if (now > etaMs) {
    progress = 1;
    estimate_status = 'eta_elapsed';
  } else {
    progress = (now - departureMs) / durationMs;
    estimate_status = 'underway_estimated';
  }

  const alat = CASPIAN_POINTS.alat;
  const kuryk = CASPIAN_POINTS.kuryk;

  return {
    ...approach,
    estimate_status,
    estimated_progress: Math.max(0,Math.min(1,progress)),
    estimated_lat: alat.lat + (kuryk.lat - alat.lat) * Math.max(0,Math.min(1,progress)),
    estimated_lon: alat.lon + (kuryk.lon - alat.lon) * Math.max(0,Math.min(1,progress)),
    estimated_departure_utc: new Date(departureMs).toISOString(),
    eta_utc: new Date(etaMs).toISOString(),
    estimate_basis: 'Official Kuryk ETA; 18h Alat–Kuryk crossing under favorable weather'
  };
}

async function fetchKurykActivity() {
  const res = await fetch(KURYK_TRAFFIC_URL, {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (compatible; MCFI-Middle-Corridor-Monitor/1.0)'
    }
  });
  if (!res.ok) throw new Error('Port Kuryk HTTP ' + res.status);

  const text = decodeHtmlText(await res.text());
  const dateMatch = text.match(/Vessel traffic as of\s+([0-9.]+)/i);
  const traffic_date = dateMatch ? dateMatch[1] : null;

  const approachIndex = text.search(/Approaching vessels/i);
  const berthedText = approachIndex >= 0 ? text.slice(0,approachIndex) : text;
  const approachText = approachIndex >= 0 ? text.slice(approachIndex) : '';

  const berthed = [];
  const berthRe = /Berth No\.\s+(.+?)\s+Vessel name\s+(.+?)\s+Berthing time\s+([0-9.]+\s*\/\s*[0-9:]+)\s+Operation type\s+(.+?)(?=Berth No\.|Approaching vessels|$)/gi;
  for (const m of berthedText.matchAll(berthRe)) {
    berthed.push({
      berth: m[1].trim(),
      vessel_names: splitVesselNames(m[2]),
      berthing_time: m[3].replace(/\s+/g,' ').trim(),
      operation: m[4].trim()
    });
  }

  const approaching = [];
  const approachRe = /Vessel name\s+(.+?)\s+Date and time of vessel approach\s+([0-9.]+\s*\/\s*[0-9:]+)/gi;
  for (const m of approachText.matchAll(approachRe)) {
    approaching.push({
      vessel_name: splitVesselNames(m[1])[0] || m[1].trim(),
      eta: m[2].replace(/\s+/g,' ').trim()
    });
  }

  if (!berthed.length && !approaching.length) {
    throw new Error('Port Kuryk page loaded but vessel rows were not parsed');
  }

  const berthedVesselCount = berthed.reduce((n,row)=>n+row.vessel_names.length,0);
  const crossing_estimates = approaching.map(v=>estimatedFerryPosition(v,traffic_date));

  return {
    traffic_date,
    source_url: KURYK_TRAFFIC_URL,
    summary: {
      berthed_vessels: berthedVesselCount,
      active_berth_entries: berthed.length,
      approaching_vessels: approaching.length,
      estimated_underway: crossing_estimates.filter(v=>v.estimate_status==='underway_estimated').length
    },
    berthed,
    approaching,
    crossing_estimates
  };
}

async function fetchAktauActivity() {
  const res = await fetch(AKTAU_DISPOSITION_CSV, {
    headers: {
      'accept': 'text/csv,text/plain,*/*',
      'user-agent': 'MCFI-Middle-Corridor-Monitor/1.0'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('Aktau disposition HTTP ' + res.status);

  const csv = await res.text();
  const rows = parseCsv(csv);

  const titleCell = rows.flat().find(c=>/Диспозиция судов/i.test(String(c||''))) || '';
  const dateMatch = String(titleCell).match(/(\d{2}\.\d{2}\.\d{4})/);
  const traffic_date = dateMatch ? dateMatch[1] : null;

  const berthed = [];
  const roadstead_dry = [];
  const roadstead_tankers = [];
  let inRoadstead = false;
  let inAMST = false;

  for (const row of rows) {
    const joined = row.join(' ');

    if (!inRoadstead && /\bАМСТ\b/i.test(joined)) {
      inAMST = true;
      continue;
    }

    if (/Суда стоящие на рейде/i.test(joined)) {
      inRoadstead = true;
      continue;
    }

    if (!inRoadstead) {
      const berth = String(row[0]||'').trim();
      const vessel = cleanAktauVesselName(row[1]||'');
      if (/^Пр\.?\s*№/i.test(berth) && vessel) {
        berthed.push({
          berth,
          vessel_name: vessel,
          agent: String(row[2]||'').trim() || null,
          reported_time: String(row[3]||'').trim() || null,
          operation: String(row[4]||'').trim() || null,
          facility: inAMST ? 'AMST' : 'Aktau Port'
        });
      }
      continue;
    }

    const dryVessel = cleanAktauVesselName(row[1]||'');
    if (/^\d+$/.test(String(row[0]||'').trim()) && dryVessel) {
      roadstead_dry.push({
        vessel_name: dryVessel,
        agent: String(row[2]||'').trim() || null,
        reported_time: String(row[3]||'').trim() || null,
        category: 'dry cargo / ferry roadstead'
      });
    }

    const tankerVessel = cleanAktauVesselName(row[7]||'');
    if (/^\d+$/.test(String(row[6]||'').trim()) && tankerVessel) {
      roadstead_tankers.push({
        vessel_name: tankerVessel,
        agent: String(row[8]||'').trim() || null,
        reported_time: String(row[9]||'').trim() || null,
        category: 'tanker roadstead'
      });
    }
  }

  if (!berthed.length && !roadstead_dry.length && !roadstead_tankers.length) {
    throw new Error('Aktau disposition loaded but vessel rows were not parsed');
  }

  const mainPortBerthed = berthed.filter(v => v.facility === 'Aktau Port');
  const occupiedMainBerths = new Set(
    mainPortBerthed
      .map(v => {
        const m = String(v.berth || '').match(/(\d+)/);
        return m ? Number(m[1]) : null;
      })
      .filter(Number.isFinite)
  ).size;
  const berthCapacity = 11;
  const berthOccupancyPct = Math.min(
    100,
    Math.round((occupiedMainBerths / berthCapacity) * 1000) / 10
  );

  return {
    traffic_date,
    source_url: AKTAU_DISPOSITION_CSV,
    summary: {
      berthed_vessels: berthed.length,
      main_port_berthed_vessels: mainPortBerthed.length,
      amst_berthed_vessels: berthed.filter(v => v.facility === 'AMST').length,
      occupied_main_berths: occupiedMainBerths,
      berth_capacity: berthCapacity,
      berth_occupancy_pct: berthOccupancyPct,
      roadstead_vessels: roadstead_dry.length + roadstead_tankers.length,
      roadstead_dry: roadstead_dry.length,
      roadstead_tankers: roadstead_tankers.length
    },
    berthed,
    roadstead_dry,
    roadstead_tankers
  };
}

async function refreshPortActivity() {
  let aktau = portActivityCache.aktau;
  let kuryk = portActivityCache.kuryk;
  const errors = [];
  let aktauLive = false;
  let kurykLive = false;

  try {
    aktau = await fetchAktauActivity();
    aktauLive = true;
  } catch (err) {
    errors.push('Aktau: ' + err.message);
  }

  try {
    kuryk = await fetchKurykActivity();
    kurykLive = true;
  } catch (err) {
    errors.push('Kuryk: ' + err.message);
  }

  portActivityCache = {
    status: aktauLive && kurykLive ? 'live' : ((aktau || kuryk) ? 'partial' : 'offline'),
    updated_at: new Date().toISOString(),
    sources: {
      aktau: 'Aktau Port official vessel disposition',
      kuryk: 'Port Kuryk official vessel traffic'
    },
    errors,
    aktau,
    kuryk
  };

  console.log('[CASPIAN OPS] ' + portActivityCache.status +
    ' · Aktau berthed=' + (aktau?.summary?.berthed_vessels ?? 'n/a') +
    ' main-berths=' + (aktau?.summary?.occupied_main_berths ?? 'n/a') + '/' + (aktau?.summary?.berth_capacity ?? 'n/a') +
    ' occupancy=' + (aktau?.summary?.berth_occupancy_pct ?? 'n/a') + '%' +
    ' roadstead=' + (aktau?.summary?.roadstead_vessels ?? 'n/a') +
    ' · Kuryk berthed=' + (kuryk?.summary?.berthed_vessels ?? 'n/a') +
    ' approaching=' + (kuryk?.summary?.approaching_vessels ?? 'n/a') +
    ' underway-est=' + (kuryk?.summary?.estimated_underway ?? 'n/a'));
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
        (wsState === 'live' || aisStreamState === 'live') ? 'live' :
          ((wsState === 'connecting' || wsState === 'subscribing' || aisStreamState === 'connecting') ? 'connecting' : 'offline'),

      provider:
        AISSTREAM_API_KEY ? 'Open Waters + AISStream + facha.dev' : 'Open Waters + facha.dev',

      open_waters_status:
        wsState,

      aisstream_status:
        aisStreamState,

      facha_status:
        fachaState,

      last_aisstream_message_at:
        lastAisStreamMessageAt,

      last_facha_snapshot_at:
        lastFachaSnapshotAt,

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
  '/api/port-activity',
  (_req, res) => {
    res.set('Cache-Control','no-store');
    res.json(portActivityCache);
  }
);

app.get(
  '/api/news',
  (_req, res) => {
    res.set('Cache-Control','no-store');
    res.json(newsCache);
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
    refreshNews();
    refreshPortActivity();
    connectOpenWaters();
    connectAisStream();
    refreshFachaSnapshot();
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

setInterval(refreshNews, NEWS_REFRESH_MS).unref();
setInterval(refreshPortActivity, PORT_ACTIVITY_REFRESH_MS).unref();
setInterval(refreshFachaSnapshot, FACHA_REFRESH_MS).unref();
