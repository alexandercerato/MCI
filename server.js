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

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN
}));

function connectAIS() {
  if (!API_KEY) {
    wsState = 'not_configured';
    console.error('[AIS] AISSTREAM_API_KEY is missing');
    return;
  }

  wsState = 'connecting';
  console.log('[AIS] Connecting to AISStream...');

  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    console.log('[AIS] WebSocket opened');

    const subscription = {
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
    };

    console.log('[AIS] Sending subscription...');
    ws.send(JSON.stringify(subscription));
  });

  ws.on('message', raw => {
    try {
      const event = JSON.parse(raw.toString());

      lastMessageAt = new Date().toISOString();

      console.log(
        '[AIS] Message received:',
        event.MessageType || 'unknown'
      );

      if (event.MessageType === 'SubscriptionConfirmation') {
        wsState = 'live';
        console.log('[AIS] Subscription confirmed');
      } else {
        wsState = 'live';
      }

    } catch (err) {
      console.error('[AIS] JSON parse error:', err.message);
    }
  });

  ws.on('unexpected-response', (_req, res) => {
    wsState = 'offline';

    console.error(
      `[AIS] Handshake rejected: HTTP ${res.statusCode} ${res.statusMessage || ''}`
    );

    res.on('data', chunk => {
      console.error('[AIS] Response:', chunk.toString());
    });
  });

  ws.on('error', err => {
    wsState = 'offline';
    console.error('[AIS] WebSocket error:', err.message);
  });

  ws.on('close', (code, reason) => {
    wsState = 'offline';

    console.error(
      `[AIS] Connection closed. code=${code} reason=${reason.toString()}`
    );

    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
      console.log('[AIS] Attempting reconnection...');
      connectAIS();
    }, 5000);
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
