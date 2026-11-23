// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '../scripts/fjfi-fetch.mjs';

function interruptedResponse() {
  return new Response(new ReadableStream({
    start(controller) { controller.error(new Error('connection reset during transfer')); },
  }));
}

describe('FJFI transfer retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries an interrupted successful response and returns only the complete body', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(interruptedResponse())
      .mockResolvedValueOnce(new Response('%PDF complete', { headers: { etag: 'new' } }));
    vi.stubGlobal('fetch', fetch);
    const request = get('https://example.test/timetable.pdf', { 'If-None-Match': 'old' });
    await vi.runAllTimersAsync();
    const result = await request;
    expect(result.data.toString()).toBe('%PDF complete');
    expect(result.headers.get('etag')).toBe('new');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![1].headers['If-None-Match']).toBe('old');
  });

  it('stops after four failed body transfers', async () => {
    const fetch = vi.fn(async () => interruptedResponse());
    vi.stubGlobal('fetch', fetch);
    const assertion = expect(get('https://example.test/page')).rejects.toThrow(/connection reset during transfer/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps conditional responses intact without retrying or reading a cached file', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetch);
    const result = await get('https://example.test/timetable.pdf');
    expect(result.status).toBe(304);
    expect(result.data.byteLength).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a permanent HTTP error', async () => {
    const fetch = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(get('https://example.test/missing')).rejects.toThrow(/HTTP 404/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
