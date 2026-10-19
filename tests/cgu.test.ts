import { describe, expect, it } from 'vitest';
import { normalizeCguKey } from '../src/lib/cgu';
describe('CGU credentials', () => {
  it('accepts documented Bearer forms without changing the key, and rejects invalid pasted text', () => {
    for (const value of ['test-key', ' Bearer test-key ', 'Authorization: Bearer test-key', 'authorization: bearer test-key']) expect(normalizeCguKey(value)).toBe('test-key');
    expect(normalizeCguKey(' ')).toBe('');
    for (const value of ['Bearer', 'Authorization: Bearer', 'key with spaces', '中文', 'test\r\ninjected']) expect(() => normalizeCguKey(value)).toThrow('格式不正確');
  });
});
