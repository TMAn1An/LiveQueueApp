import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import * as authApi from './auth.api';
import { REFRESH_TOKEN_STORAGE_KEY, isAuthRejection, refreshSession } from './sessionRefresh';

vi.mock('./auth.api');

/** A promise the test resolves by hand, to hold an exchange "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pair = (n: number) => ({ data: { accessToken: `access-${n}`, refreshToken: `refresh-${n}` } });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('refreshSession — one exchange at a time', () => {
  it('sends the stored token once however many callers ask together, and gives them all the result', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    const exchange = deferred<ReturnType<typeof pair>>();
    vi.mocked(authApi.refresh).mockReturnValue(exchange.promise);

    const callers = [refreshSession(), refreshSession(), refreshSession(), refreshSession()];
    exchange.resolve(pair(2));
    const results = await Promise.all(callers);

    expect(authApi.refresh).toHaveBeenCalledTimes(1);
    expect(authApi.refresh).toHaveBeenCalledWith('refresh-1');
    for (const result of results) expect(result).toEqual(pair(2).data);
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-2');
  });

  it('starts a new exchange, with the newly stored token, once the previous one has settled', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    vi.mocked(authApi.refresh).mockResolvedValueOnce(pair(2)).mockResolvedValueOnce(pair(3));

    await refreshSession();
    await refreshSession();

    expect(vi.mocked(authApi.refresh).mock.calls.map(([token]) => token)).toEqual(['refresh-1', 'refresh-2']);
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-3');
  });

  it('resolves null, without a request, when there is no refresh token', async () => {
    await expect(refreshSession()).resolves.toBeNull();
    expect(authApi.refresh).not.toHaveBeenCalled();
  });

  it('prefers the stored token over the caller’s in-memory copy (another tab may have rotated it)', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'rotated-by-other-tab');
    vi.mocked(authApi.refresh).mockResolvedValue(pair(9));

    await refreshSession('stale-in-memory');

    expect(authApi.refresh).toHaveBeenCalledWith('rotated-by-other-tab');
  });

  it('falls back to the caller’s token only when storage holds none', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(pair(9));

    await refreshSession('in-memory');

    expect(authApi.refresh).toHaveBeenCalledWith('in-memory');
  });

  it('rejects for every waiting caller when the backend refuses, and is usable again afterwards', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    vi.mocked(authApi.refresh).mockRejectedValueOnce(new ApiError(401, 'REFRESH_TOKEN_REUSED', 'reused'));

    const callers = [refreshSession(), refreshSession()];
    const outcomes = await Promise.allSettled(callers);
    expect(outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected']);
    expect(authApi.refresh).toHaveBeenCalledTimes(1);

    vi.mocked(authApi.refresh).mockResolvedValueOnce(pair(2));
    await expect(refreshSession()).resolves.toEqual(pair(2).data);
  });
});

describe('refreshSession — a token the backend says was just superseded', () => {
  it('retries once with the newer token that has been stored meanwhile', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    vi.mocked(authApi.refresh)
      .mockImplementationOnce(async () => {
        // Another tab (one without Web Locks) rotated it while this was in flight.
        localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-2');
        throw new ApiError(409, 'REFRESH_TOKEN_SUPERSEDED', 'superseded');
      })
      .mockResolvedValueOnce(pair(3));

    await expect(refreshSession()).resolves.toEqual(pair(3).data);

    expect(vi.mocked(authApi.refresh).mock.calls.map(([token]) => token)).toEqual(['refresh-1', 'refresh-2']);
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-3');
  });

  it('gives up, without looping, when no newer token exists', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    vi.mocked(authApi.refresh).mockRejectedValue(new ApiError(409, 'REFRESH_TOKEN_SUPERSEDED', 'superseded'));

    await expect(refreshSession()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_SUPERSEDED' });
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });

  it('never retries a token the backend reports as reused', async () => {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    vi.mocked(authApi.refresh).mockImplementationOnce(async () => {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-2');
      throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'reused');
    });

    await expect(refreshSession()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('refreshSession — across tabs', () => {
  /** A minimal Web Locks stand-in: one holder at a time, first come first served. */
  function installFakeLocks() {
    let tail: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => {
      const run = tail.then(task);
      tail = run.catch(() => undefined);
      return run;
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    return request;
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
  });

  /**
   * Two separately loaded copies of the module stand in for two tabs: each
   * has its own in-flight state, and they share storage, the lock and the
   * backend. The backend here rotates whatever it is given and records how
   * many exchanges were in progress at once.
   */
  async function twoTabs() {
    vi.resetModules();
    const tabA = await import('./sessionRefresh');
    vi.resetModules();
    const tabB = await import('./sessionRefresh');
    expect(tabA.refreshSession).not.toBe(tabB.refreshSession);

    const api = await import('./auth.api');
    const seen = { presented: [] as string[], active: 0, maxActive: 0 };
    vi.mocked(api.refresh).mockImplementation(async (token: string) => {
      seen.presented.push(token);
      seen.active += 1;
      seen.maxActive = Math.max(seen.maxActive, seen.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.active -= 1;
      return pair(seen.presented.length + 1);
    });
    return { tabA, tabB, seen };
  }

  it('takes the shared lock, so two tabs never present the same stored token', async () => {
    const request = installFakeLocks();
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    const { tabA, tabB, seen } = await twoTabs();

    await Promise.all([tabA.refreshSession(), tabB.refreshSession()]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe(request.mock.calls[1]?.[0]);
    // The second tab waited, then presented what the first one stored.
    expect(seen.presented).toEqual(['refresh-1', 'refresh-2']);
    expect(seen.maxActive).toBe(1);
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-3');
  });

  it('documents the gap the backend leeway exists for: without Web Locks, two tabs can present the same token', async () => {
    expect('locks' in navigator).toBe(false);
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-1');
    const { tabA, tabB, seen } = await twoTabs();

    await Promise.all([tabA.refreshSession(), tabB.refreshSession()]);

    expect(seen.presented).toEqual(['refresh-1', 'refresh-1']);
    expect(seen.maxActive).toBe(2);
  });
});

describe('isAuthRejection — did the backend refuse the session, or just not answer?', () => {
  it.each([
    [401, 'INVALID_REFRESH_TOKEN'],
    [401, 'REFRESH_TOKEN_EXPIRED'],
    [401, 'REFRESH_TOKEN_REUSED'],
    [401, 'UNAUTHENTICATED'],
    [403, 'ORGANIZATION_SUSPENDED'],
    [409, 'REFRESH_TOKEN_SUPERSEDED'],
    [400, 'VALIDATION_ERROR'],
  ])('%i %s is a refusal: the session really is over', (status, code) => {
    expect(isAuthRejection(new ApiError(status, code, code))).toBe(true);
  });

  it.each([
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['a timed-out request', new DOMException('The operation was aborted.', 'AbortError')],
    ['a gateway error page that is not JSON', new SyntaxError('Unexpected token < in JSON')],
    ['500', new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.')],
    ['502', new ApiError(502, 'BAD_GATEWAY', 'Bad gateway.')],
    ['503', new ApiError(503, 'UNAVAILABLE', 'Unavailable.')],
    ['being rate limited (429)', new ApiError(429, 'RATE_LIMITED', 'Too many requests.')],
    ['a request timeout (408)', new ApiError(408, 'REQUEST_TIMEOUT', 'Timeout.')],
    ['something that is not an error at all', undefined],
  ])('%s is not: nothing was learned about the session', (_label, err) => {
    expect(isAuthRejection(err)).toBe(false);
  });
});
