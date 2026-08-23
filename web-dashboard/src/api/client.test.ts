import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiFetch, apiFetchBlob, ApiError, registerAuthHandlers } from './client';

function jsonResponse(status: number, body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('apiFetch', () => {
  let getAccessToken: ReturnType<typeof vi.fn<() => string | null>>;
  let refreshAccessToken: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  let onAuthExpired: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    getAccessToken = vi.fn(() => 'initial-access-token');
    refreshAccessToken = vi.fn(async () => null);
    onAuthExpired = vi.fn();
    registerAuthHandlers({ getAccessToken, refreshAccessToken, onAuthExpired });
    vi.restoreAllMocks();
  });

  it('returns data and pagination on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { success: true, data: { id: '1' }, pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })),
    );

    const result = await apiFetch<{ id: string }>('/api/queues');

    expect(result.data).toEqual({ id: '1' });
    expect(result.pagination?.total).toBe(1);
  });

  it('sends the current access token as a Bearer header', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/queues');

    const requestInit = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer initial-access-token');
  });

  it('treats 204 as success with no body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    const result = await apiFetch('/api/staff/123');

    expect(result.data).toBeUndefined();
  });

  it('throws ApiError with the server code/message on a non-401 failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'No permission.' } })),
    );

    await expect(apiFetch('/api/staff')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No permission.',
    });
  });

  it('on 401 TOKEN_EXPIRED, refreshes once and retries the same request', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'Expired.' } });
      }
      return jsonResponse(200, { success: true, data: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);
    refreshAccessToken.mockResolvedValue('new-access-token');

    const result = await apiFetch<{ ok: boolean }>('/api/staff');

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ok: true });
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it('on 401 TOKEN_EXPIRED, if refresh fails, throws without retrying again and calls onAuthExpired', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'Expired.' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    refreshAccessToken.mockResolvedValue(null);

    await expect(apiFetch('/api/staff')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never retried a second time
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
  });

  it('on a 401 that is not TOKEN_EXPIRED, does not attempt a refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { success: false, error: { code: 'UNAUTHENTICATED', message: 'No token.' } })),
    );

    await expect(apiFetch('/api/staff')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
  });

  it('omits undefined query parameters from the URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { success: true, data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/devices', { query: { page: 1, status: undefined } });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('page=1');
    expect(url).not.toContain('status');
  });
});

describe('apiFetchBlob', () => {
  it('resolves with whatever the response .blob() returns on success', async () => {
    const fakeBlob = { size: 3, type: 'text/csv' } as Blob;
    const blobFn = vi.fn(async () => fakeBlob);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: blobFn })));

    const result = await apiFetchBlob('/api/reports/export');

    expect(result).toBe(fakeBlob);
    expect(blobFn).toHaveBeenCalledTimes(1);
  });

  it('throws ApiError on a failed export, without calling .blob()', async () => {
    const blobFn = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, blob: blobFn })));

    await expect(apiFetchBlob('/api/reports/export')).rejects.toBeInstanceOf(ApiError);
    expect(blobFn).not.toHaveBeenCalled();
  });
});
