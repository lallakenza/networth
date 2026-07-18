#!/usr/bin/env node
/**
 * tv_history.mjs — Historique quotidien (OHLCV) d'une action de la Bourse de Casablanca via
 * le websocket TradingView, et écriture dans data/<ticker>_history.json.
 *
 * Pourquoi le websocket : TradingView n'expose PAS d'endpoint HTTP d'historique daté. Ses
 * graphiques passent par wss://data.tradingview.com. Ce flux rejette les Origins non-TradingView
 * (403) → INAPPELABLE depuis le navigateur (l'Origin y est imposé par le navigateur), mais OK
 * depuis un script qui envoie `Origin: https://www.tradingview.com`. C'est donc un outil de
 * BACKFILL, exécuté à la demande (pas en CI) : il reconstruit tout l'historique depuis l'IPO.
 * Le prix LIVE runtime reste le scanner HTTP (js/api.js), l'accumulation courante reste le
 * localStorage — aucun GitHub Actions requis.
 *
 * Zéro dépendance : client websocket brut (handshake + framing RFC 6455) sur tls natif.
 *
 * Usage :
 *   node scripts/tv_history.mjs SGTM              # → data/sgtm_history.json (défaut 600 barres)
 *   node scripts/tv_history.mjs SGTM 400
 *   node scripts/tv_history.mjs ATW --stdout      # imprime le JSON sans écrire de fichier
 *
 * Mapping ticker : le code BVC/TradingView de SGTM est « GTM ». Ajoute-le dans BVC_TICKER si
 * le ticker broker diffère du code BVC (sinon le ticker est utilisé tel quel sous CSEMA:).
 */
import tls from 'node:tls';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BVC_TICKER = { SGTM: 'GTM' }; // ticker broker → code BVC quand ils diffèrent

// ── Client websocket brut (RFC 6455) ────────────────────────────────────────────────────────
function tvConnect({ onOpen, onText, onError }) {
  const socket = tls.connect(443, 'data.tradingview.com', { servername: 'data.tradingview.com' });
  let handshakeDone = false;
  let buf = Buffer.alloc(0);

  socket.on('secureConnect', () => {
    const key = crypto.randomBytes(16).toString('base64');
    socket.write(
      'GET /socket.io/websocket?type=chart HTTP/1.1\r\n' +
      'Host: data.tradingview.com\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\n` +
      'Sec-WebSocket-Version: 13\r\n' +
      'Origin: https://www.tradingview.com\r\n' +               // ← indispensable (sinon 403)
      'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36\r\n' +
      '\r\n'
    );
  });

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!handshakeDone) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep === -1) return;
      const head = buf.slice(0, sep).toString();
      if (!/101/.test(head.split('\r\n')[0])) { onError(new Error('handshake: ' + head.split('\r\n')[0])); socket.destroy(); return; }
      handshakeDone = true;
      buf = buf.slice(sep + 4);
      onOpen();
    }
    // parse toutes les frames complètes disponibles
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = (b1 & 0x80) === 0x80; // serveur→client normalement non masqué
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) break; // frame incomplète → attendre plus
      let payload = buf.slice(off + maskLen, off + maskLen + len);
      if (masked) { const m = buf.slice(off, off + 4); payload = Buffer.from(payload.map((x, i) => x ^ m[i % 4])); }
      buf = buf.slice(off + maskLen + len);
      if (opcode === 0x8) { socket.destroy(); return; }        // close
      if (opcode === 0x9) { sendFrame(socket, payload, 0xA); continue; } // ping → pong
      if (opcode === 0x1 || opcode === 0x0) onText(payload.toString());
    }
  });
  socket.on('error', onError);
  socket.on('close', () => {});
  return socket;
}

// frame client→serveur : masquée (obligatoire côté client RFC 6455)
function sendFrame(socket, data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(payload.map((x, i) => x ^ mask[i % 4]));
  socket.write(Buffer.concat([header, mask, masked]));
}

// ── Protocole TradingView par-dessus (~m~len~m~payload) ──────────────────────────────────────
const tvSend = (socket, m, p) => {
  const s = JSON.stringify({ m, p });
  sendFrame(socket, `~m~${s.length}~m~${s}`);
};
const rnd = (pfx) => pfx + crypto.randomBytes(6).toString('hex');

function fetchDailyBars(symbol, bars) {
  return new Promise((resolve, reject) => {
    const cs = rnd('cs_');
    let out = null;
    const to = setTimeout(() => { reject(new Error('timeout')); try { socket.destroy(); } catch {} }, 25000);
    const socket = tvConnect({
      onOpen: () => {
        tvSend(socket, 'set_auth_token', ['unauthorized_user_token']);
        tvSend(socket, 'chart_create_session', [cs, '']);
        tvSend(socket, 'resolve_symbol', [cs, 'sds_sym_1', `=${JSON.stringify({ symbol, adjustment: 'splits' })}`]);
        tvSend(socket, 'create_series', [cs, 'sds_1', 's1', 'sds_sym_1', '1D', bars, '']);
      },
      onText: (raw) => {
        for (const part of raw.split(/~m~\d+~m~/).filter(Boolean)) {
          if (part.startsWith('~h~')) { sendFrame(socket, `~m~${part.length}~m~${part}`); continue; } // heartbeat
          let msg; try { msg = JSON.parse(part); } catch { continue; }
          if (msg.m === 'timescale_update') {
            const sd = msg.p && msg.p[1] && msg.p[1].sds_1;
            if (sd && Array.isArray(sd.s)) {
              out = sd.s.map((x) => ({
                date: new Date(x.v[0] * 1000).toISOString().slice(0, 10),
                o: x.v[1], h: x.v[2], l: x.v[3], c: x.v[4], v: x.v[5],
              }));
            }
          }
          if (msg.m === 'series_completed') { clearTimeout(to); try { socket.destroy(); } catch {} resolve(out || []); return; }
          if (/error/.test(msg.m || '')) { clearTimeout(to); try { socket.destroy(); } catch {} reject(new Error(msg.m + ' ' + JSON.stringify(msg.p))); return; }
        }
      },
      onError: (e) => { clearTimeout(to); reject(e); },
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  const broker = (pos[0] || 'SGTM').toUpperCase();
  const bars = parseInt(pos[1] || '600', 10);
  const bvc = BVC_TICKER[broker] || broker;
  const symbol = `CSEMA:${bvc}`;

  process.stderr.write(`[tv_history] ${symbol} — pull ${bars} barres quotidiennes…\n`);
  const raw = await fetchDailyBars(symbol, bars);
  if (!raw.length) throw new Error('aucune barre reçue');

  // Schéma compatible app : { series:[{date, priceMAD(=close), source, o,h,l,v}] }
  const series = raw
    .filter((b) => b.date && Number.isFinite(b.c) && b.c > 0)
    .map((b) => ({ date: b.date, priceMAD: Math.round(b.c * 100) / 100, source: 'tradingview', o: b.o, h: b.h, l: b.l, v: b.v }));

  const doc = {
    ticker: broker,
    currency: 'MAD',
    granularity: 'daily-ohlc',
    note: 'OHLCV quotidien depuis l\'IPO via le websocket TradingView (scripts/tv_history.mjs). ' +
          'priceMAD = close. Backfill à la demande — le live runtime reste le scanner HTTP + localStorage.',
    lastBackfill: raw[raw.length - 1].date,
    source: 'tradingview-ws',
    series,
  };

  if (flags.has('--stdout')) {
    process.stdout.write(JSON.stringify(doc, null, 1) + '\n');
  } else {
    const out = path.join(REPO_ROOT, 'data', `${broker.toLowerCase()}_history.json`);
    fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
    process.stderr.write(`[tv_history] ✓ ${series.length} jours (${series[0].date} → ${series[series.length - 1].date}) → ${path.relative(REPO_ROOT, out)}\n`);
  }
}

main().catch((e) => { process.stderr.write('[tv_history] ✗ ' + e.message + '\n'); process.exit(1); });
