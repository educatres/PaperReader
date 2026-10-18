// Standalone localhost helper. Requires Node.js 24+. No packages or API key files.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRIDGE_PORT = 43127;
export const BRIDGE_APP = 'PaperReader CGU Bridge';
const UPSTREAM = 'https://air.cgu.edu.tw/cgullmapi/v1';
const ORIGINS = new Set(['https://educatres.github.io', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173', 'http://localhost:5173', 'http://localhost:4173']);
const LIMIT = 1024 * 1024;

export function createBridge({ fetchUpstream = fetch, upstreamTimeoutMs = 115_000 } = {}) {
  const pairingCode = randomBytes(24).toString('base64url');
  const paired = token => {
    if (typeof token !== 'string') return false;
    const supplied = Buffer.from(token); const expected = Buffer.from(pairingCode);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const error = (status, code) => send(status, { error: { code } });
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Vary', 'Origin');
    // A fixed loopback bind plus Host validation prevents DNS rebinding.
    if (req.headers.host !== `127.0.0.1:${server.address()?.port}`) return error(403, 'paperreader_host_denied');
    const origin = req.headers.origin;
    if (!ORIGINS.has(origin)) return error(403, 'paperreader_origin_denied');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    const paths = { '/health': 'GET', '/v1/models': 'GET', '/v1/responses': 'POST' };
    const method = paths[req.url];
    if (!method) return error(404, 'paperreader_route_denied');
    if (req.method === 'OPTIONS') {
      const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (req.headers['access-control-request-method'] !== method || headers.some(h => !['authorization', 'content-type', 'x-paperreader-token'].includes(h))) return error(403, 'paperreader_preflight_denied');
      res.setHeader('Access-Control-Allow-Methods', method);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-PaperReader-Token');
      res.setHeader('Access-Control-Max-Age', '600'); res.writeHead(204); res.end(); return;
    }
    if (req.method !== method) return error(405, 'paperreader_method_denied');
    const authenticated = paired(req.headers['x-paperreader-token']);
    if (req.url === '/health') return send(200, { app: BRIDGE_APP, version: 1, paired: authenticated });
    if (!authenticated) return error(401, 'paperreader_pairing_required');
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [\x21-\x7e]+$/.test(authorization)) return error(401, 'paperreader_key_required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      let body;
      if (method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return error(415, 'paperreader_json_required');
        if (Number(req.headers['content-length']) > LIMIT) return error(413, 'paperreader_request_too_large');
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length; if (size > LIMIT) return error(413, 'paperreader_request_too_large');
          chunks.push(chunk);
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return error(400, 'paperreader_invalid_json'); }
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.model !== 'string' || !data.input || data.stream) return error(400, 'paperreader_invalid_request');
        body = JSON.stringify({ ...data, store: false });
      }
      // Never forward cookies, caller-controlled URLs, Origin, or pairing tokens.
      // Authorization exists only in this request's memory and goes only to CGU.
      const upstream = await fetchUpstream(`${UPSTREAM}${req.url.slice(3)}`, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: authorization, Accept: 'application/json', 'Accept-Encoding': 'identity', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body } : {}),
      });
      if (upstream.status >= 300 && upstream.status < 400) return error(502, 'paperreader_upstream_redirect');
      // Read decoded JSON; never relay a stale upstream Content-Encoding/Length.
      const text = await upstream.text();
      if (!res.destroyed) { res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(text); }
    } catch {
      if (!res.destroyed) error(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'paperreader_upstream_timeout' : 'paperreader_upstream_unavailable');
    } finally { clearTimeout(timer); res.off('close', disconnect); }
  });
  server.requestTimeout = 120_000; server.headersTimeout = 10_000;
  return { server, pairingCode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, pairingCode } = createBridge();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${BRIDGE_PORT} is in use. Close the previous PaperReader helper and retry.` : 'PaperReader helper could not start.');
    process.exitCode = 1;
  });
  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`${BRIDGE_APP}\nListening only on http://127.0.0.1:${BRIDGE_PORT}\nPairing code: ${pairingCode}\nPaste this code into PaperReader > CGU API > localhost helper.\nAPI keys are never saved or logged. Press Ctrl+C to stop.`);
  });
  process.on('SIGINT', () => { server.close(); server.closeAllConnections(); });
}
