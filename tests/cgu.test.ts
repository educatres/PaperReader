import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeEndpoint, bridgeHeaders, checkBridge, hasBridgeToken, normalizeCguKey, setBridgeToken } from '../src/lib/cgu';
afterEach(() => { setBridgeToken(''); vi.unstubAllGlobals(); });
describe('CGU credentials and pairing', () => {
  it('accepts documented Bearer forms without changing the key, and rejects invalid pasted text', () => {
    for (const value of ['test-key', ' Bearer test-key ', 'Authorization: Bearer test-key', 'authorization: bearer test-key']) expect(normalizeCguKey(value)).toBe('test-key');
    expect(normalizeCguKey(' ')).toBe('');
    for (const value of ['Bearer', 'Authorization: Bearer', 'key with spaces', '中文', 'test\r\ninjected']) expect(() => normalizeCguKey(value)).toThrow('格式不正確');
  });
  it('requires a valid memory-only pairing code and checks identity before any API-key use', async () => {
    expect(() => bridgeHeaders()).toThrow('請先啟動');
    expect(() => setBridgeToken('bad-code')).toThrow('格式不正確');
    const token = 't'.repeat(32); setBridgeToken(token); expect(hasBridgeToken()).toBe(true);
    const mock = vi.fn(async () => Response.json({ app: 'PaperReader CGU Bridge', version: 1, paired: true })); vi.stubGlobal('fetch', mock);
    await checkBridge();
    expect(mock.mock.calls[0]).toEqual([`${bridgeEndpoint}/health`, expect.objectContaining({ headers: { 'X-PaperReader-Token': token }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })]);
    setBridgeToken(''); expect(hasBridgeToken()).toBe(false);
  });
  it('reports an unreachable helper, wrong code and unexpected health service clearly', async () => {
    setBridgeToken('t'.repeat(32));
    const mock = vi.fn(); vi.stubGlobal('fetch', mock);
    mock.mockRejectedValueOnce(new TypeError('Network failure'));
    await expect(checkBridge()).rejects.toThrow('無法連到本機助手');
    mock.mockResolvedValueOnce(Response.json({ app: 'PaperReader CGU Bridge', version: 1, paired: false }));
    await expect(checkBridge()).rejects.toThrow('連線碼不符');
    mock.mockResolvedValueOnce(Response.json(null));
    await expect(checkBridge()).rejects.toThrow('不是受支援');
  });
});
