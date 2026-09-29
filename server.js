import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.AISSTREAM_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const app = express();

let wsState = API_KEY ? 'connecting' : 'not_configured';
let lastMessageAt = null;
let reconnectTimer = null;
let activeWs = null;

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN
}));

function connectAIS() {
  if (!API_KEY) {
    wsState = 'not_configured';
    console.error('[AIS] AISSTREAM_API_KEY is missing');
    return;
  }

  // Evita più connessioni AIS contemporanee nello stesso processo
  if (
    activeWs &&
    (
      activeWs.readyState === WebSocket.OPEN ||
      activeWs.readyState === WebSocket.CONNECTING
    )
  ) {
    console.log('[AIS] Connection already active or connecting. Skipping.');
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  wsState = 'connecting';
  console.log('[AIS] Connecting to AISStream...');

  activeWs = new WebSocket('wss://stream.aisstream.io/v0/stream');

  activeWs.on('open', () => {
    wsState = 'subscribing';

    console.log('[AIS] WebSocket opened. Sending subscription...');

    activeWs.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: [
        [
          [39.0, 48.0],
          [45.2, 53.0]
        ]
      ],
      FilterMessageTypes: [
        'PositionReport',
        'StandardClassBPositionReport',
        'ExtendedClassBPositionReport',
        'ShipStaticData',
        'StaticDataReport'
      ]
    }));
  });

  activeWs.on('message', raw => {
    try {
      const event = JSON.parse(raw.toString());

      lastMessageAt = new Date().toISOString();
      wsState = 'live';

      console.log(
        '[AIS] Message received:',
        event.MessageType || 'unknown'
      );

      if (event.MessageType === 'SubscriptionConfirmation') {
        console.log('[AIS] Subscription confirmed');
      }

      if (typeof handleEvent === 'function') {
        handleEvent(event);
      }

    } catch (err) {
      console.error('[AIS] Message parse error:', err.message);
    }
  });

  activeWs.on('unexpected-response', (_req, res) => {
    wsState = 'offline';

    console.error(
      `[AIS] Handshake rejected: HTTP ${res.statusCode} ${res.statusMessage || ''}`
    );

    res.on('data', chunk => {
      console.error('[AIS] Response:', chunk.toString());
    });

    activeWs = null;

    // Con errore 429 aspettiamo 5 minuti prima di riprovare
    const delay =
      res.statusCode === 429
        ? 5 * 60 * 1000
        : 60 * 1000;

    console.log(
      `[AIS] Next connection attempt in ${Math.round(delay / 60000)} minute(s)`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectAIS();
    }, delay);
  });

  activeWs.on('error', err => {
    wsState = 'offline';
    console.error('[AIS] WebSocket error:', err.message);
  });

  activeWs.on('close', (code, reason) => {
    wsState = 'offline';
    activeWs = null;

    console.log(
      `[AIS] Connection closed. code=${code} reason=${reason.toString()}`
    );

    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectAIS();
      }, 60 * 1000);
    }
  });
}

app.get('/', (_req, res) => {
  res.send('MCFI Caspian AIS backend');
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: wsState,
    provider: 'AISStream',
    last_message_at: lastMessageAt
  });
});

app.listen(PORT, () => {
  console.log(`MCFI AIS backend listening on :${PORT}`);
  connectAIS();
});
