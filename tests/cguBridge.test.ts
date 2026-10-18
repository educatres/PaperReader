import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { createBridge } from '../public/PaperReader-CGU-Bridge.mjs';

const origin = 'https://educatres.github.io';
const fakeKey = 'Bearer unit-test-key';
let bridge: ReturnType<typeof createBridge>;
let base: string;
let upstream: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  upstream = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }] }), { headers: { 'Content-Encoding': 'br', 'Content-Length': '999' } }));
  bridge = createBridge({ fetchUpstream: upstream, upstreamTimeoutMs: 1000 });
  await new Promise<void>(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${bridge.server.address().port}`;
});
afterEach(async () => {
  const closed = new Promise<void>(resolve => bridge.server.close(resolve));
  bridge.server.closeAllConnections(); await closed;
});
const headers = () => ({ Origin: origin, Authorization: fakeKey, 'X-PaperReader-Token': bridge.pairingCode });

describe('loopback bridge boundary', () => {
  it('pairs without an API key, supports private-network preflight and never exposes its code', async () => {
    expect(bridge.server.address().address).toBe('127.0.0.1');
    const unpaired = await fetch(`${base}/health`, { headers: { Origin: origin } });
    expect(await unpaired.json()).toEqual({ app: 'PaperReader CGU Bridge', version: 1, paired: false });
    const paired = await fetch(`${base}/health`, { headers: { Origin: origin, 'X-PaperReader-Token': bridge.pairingCode } });
    expect(await paired.json()).toEqual({ app: 'PaperReader CGU Bridge', version: 1, paired: true });
    expect(paired.headers.get('cache-control')).toBe('no-store');
    const options = await fetch(`${base}/v1/responses`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, x-paperreader-token', 'Access-Control-Request-Private-Network': 'true' } });
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-origin')).toBe(origin);
    expect(options.headers.get('access-control-allow-private-network')).toBe('true');
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects foreign and absent origins, bad pairing, routes and methods without forwarding', async () => {
    for (const extra of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: 'http://127.0.0.1:9999' }]) {
      const response = await fetch(`${base}/v1/models`, { headers: { ...headers(), ...extra } });
      expect(response.status).toBe(403); expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect((await fetch(`${base}/health`)).status).toBe(403);
    expect((await fetch(`${base}/v1/models`, { headers: { ...headers(), 'X-PaperReader-Token': 'wrong' } })).status).toBe(401);
    expect((await fetch(`${base}/v1/models`, { headers: { Origin: origin, 'X-PaperReader-Token': bridge.pairingCode } })).status).toBe(401);
    for (const path of ['/v1/chat/completions', '/v1/models?url=https://evil.example', '/https://evil.example']) expect((await fetch(`${base}${path}`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${base}/v1/models`, { method: 'POST', headers: headers() })).status).toBe(405);
    expect((await fetch(`${base}/v1/models`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'cookie' } })).status).toBe(403);
    const hostStatus = await new Promise<number>(resolve => {
      const req = request(`${base}/health`, { headers: { Origin: origin, Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    expect(hostStatus).toBe(403); expect(upstream).not.toHaveBeenCalled();
  });
  it('forwards only to the CGU allowlist, strips local secrets/cookies and decoded encoding headers', async () => {
    const response = await fetch(`${base}/v1/models`, { headers: { ...headers(), Cookie: 'private-cookie=1' } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: [{ id: 'gpt-6-luna' }] });
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).not.toBe('999');
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://air.cgu.edu.tw/cgullmapi/v1/models');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: fakeKey, Accept: 'application/json', 'Accept-Encoding': 'identity' } });
    expect(Object.keys(init.headers).sort()).toEqual(['Accept', 'Accept-Encoding', 'Authorization']);
    expect(JSON.stringify(init)).not.toContain(bridge.pairingCode);
    expect(JSON.stringify(init)).not.toContain('private-cookie');
    await fetch(`${base}/v1/responses`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6-luna', input: 'TEST TEXT', store: true, reasoning: { effort: 'medium' } }) });
    expect(upstream.mock.calls[1][0]).toBe('https://air.cgu.edu.tw/cgullmapi/v1/responses');
    expect(JSON.parse(upstream.mock.calls[1][1].body)).toEqual({ model: 'gpt-6-luna', input: 'TEST TEXT', store: false, reasoning: { effort: 'medium' } });
  });
  it('rejects oversized, invalid, streaming and non-JSON generation requests', async () => {
    const post = (body: string, contentType = 'application/json') => fetch(`${base}/v1/responses`, { method: 'POST', headers: { ...headers(), 'Content-Type': contentType }, body });
    expect((await post('x'.repeat(1024 * 1024 + 1))).status).toBe(413);
    expect((await post('invalid')).status).toBe(400);
    expect((await post(JSON.stringify({ model: 'gpt-6-luna', input: 'test', stream: true }))).status).toBe(400);
    expect((await post('{}')).status).toBe(400);
    expect((await post('{}', 'text/plain')).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('preserves CGU permission errors while sanitizing network failures, redirects and timeouts', async () => {
    upstream.mockImplementationOnce(async () => new Response('{"error":{"code":"quota"}}', { status: 403 }));
    expect((await fetch(`${base}/v1/models`, { headers: headers() })).status).toBe(403);
    upstream.mockImplementationOnce(async () => { throw new Error('secret-error-must-not-escape'); });
    const failed = await fetch(`${base}/v1/models`, { headers: headers() });
    expect(failed.status).toBe(502); expect(await failed.json()).toEqual({ error: { code: 'paperreader_upstream_unavailable' } });
    upstream.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }));
    expect((await fetch(`${base}/v1/models`, { headers: headers() })).status).toBe(502);
    upstream.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('abort')))));
    const timeout = await fetch(`${base}/v1/models`, { headers: headers() });
    expect(timeout.status).toBe(504); expect(await timeout.json()).toEqual({ error: { code: 'paperreader_upstream_timeout' } });
  });
  it('aborts the CGU request when the browser disconnects', async () => {
    let signal: AbortSignal | undefined;
    upstream.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal!; signal.addEventListener('abort', () => reject(new Error('abort')));
    }));
    const req = request(`${base}/v1/models`, { headers: headers() }); req.on('error', () => {}); req.end();
    await vi.waitFor(() => expect(signal).toBeDefined(), { interval: 10, timeout: 500 });
    req.destroy();
    await vi.waitFor(() => expect(signal!.aborted).toBe(true), { interval: 10, timeout: 500 });
  });
});
