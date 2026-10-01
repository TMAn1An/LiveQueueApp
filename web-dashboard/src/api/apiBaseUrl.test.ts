import { describe, expect, it } from 'vitest';
import { MISSING_API_BASE_URL_MESSAGE, resolveApiBaseUrl } from './client';

/**
 * The rule that matters: a built dashboard never guesses `localhost`. Only a
 * development server may, and only when nothing was configured.
 */
describe('resolveApiBaseUrl', () => {
  describe('a production build', () => {
    it('uses the configured API origin', () => {
      expect(
        resolveApiBaseUrl({
          configuredUrl: 'https://api.example.com',
          isDevelopment: false,
          pageHostname: 'dashboard.example.com',
        }),
      ).toBe('https://api.example.com');
    });

    it.each([undefined, '', '   '])('throws instead of falling back to localhost when it is %j', (configuredUrl) => {
      expect(() =>
        resolveApiBaseUrl({ configuredUrl, isDevelopment: false, pageHostname: 'dashboard.example.com' }),
      ).toThrow(MISSING_API_BASE_URL_MESSAGE);
    });

    it('throws even when the build is being previewed on this machine', () => {
      expect(() =>
        resolveApiBaseUrl({ configuredUrl: undefined, isDevelopment: false, pageHostname: 'localhost' }),
      ).toThrow(MISSING_API_BASE_URL_MESSAGE);
    });

    it('never rewrites a real API host just because the page is on a loopback address', () => {
      expect(
        resolveApiBaseUrl({
          configuredUrl: 'https://api.example.com',
          isDevelopment: false,
          pageHostname: 'localhost',
        }),
      ).toBe('https://api.example.com');
    });
  });

  describe('a development server', () => {
    it('falls back to the local backend when nothing is configured', () => {
      expect(resolveApiBaseUrl({ configuredUrl: undefined, isDevelopment: true, pageHostname: 'localhost' })).toBe(
        'http://localhost:4000',
      );
    });

    it('matches the fallback to a page served from 127.0.0.1', () => {
      expect(resolveApiBaseUrl({ configuredUrl: undefined, isDevelopment: true, pageHostname: '127.0.0.1' })).toBe(
        'http://127.0.0.1:4000',
      );
    });

    it('aligns a configured loopback URL with the page’s own loopback host', () => {
      expect(
        resolveApiBaseUrl({
          configuredUrl: 'http://localhost:4000',
          isDevelopment: true,
          pageHostname: '127.0.0.1',
        }),
      ).toBe('http://127.0.0.1:4000');
    });

    it('leaves a configured remote URL alone', () => {
      expect(
        resolveApiBaseUrl({
          configuredUrl: 'https://staging-api.example.com',
          isDevelopment: true,
          pageHostname: 'localhost',
        }),
      ).toBe('https://staging-api.example.com');
    });
  });
});
