import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/**
 * index.html is not covered by TypeScript or by any component test, so a
 * favicon path that no longer resolves would ship silently.
 */
describe('site icons', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);

  it('references at least the .ico, both PNG sizes and the apple touch icon', () => {
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/favicon.ico',
        '/favicon-32.png',
        '/favicon-16.png',
        '/apple-touch-icon.png',
      ]),
    );
  });

  it.each(hrefs)('%s exists in public/', (href) => {
    expect(existsSync(path.join(ROOT, 'public', href.replace(/^\//, '')))).toBe(true);
  });
});
