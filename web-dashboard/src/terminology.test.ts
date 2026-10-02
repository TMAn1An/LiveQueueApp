import { describe, expect, it } from 'vitest';

/**
 * ADR-066: the dashboard calls the people in a queue "person" / "people",
 * never the generic "customer". Internal identifiers (customerContext,
 * scheduleVisibleToCustomers, CUSTOMER_NOT_PRESENT …) and comments are not
 * user-facing and are allowed; a bare word in source text is.
 */
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BARE_WORD = /(?<![A-Za-z0-9_.$/:-])[Cc]ustomers?(?![A-Za-z0-9_:-])/;
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

describe('neutral terminology (ADR-066)', () => {
  it('has no user-facing "customer" in dashboard source', () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text
        .split('\n')
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter(({ text: line }) => !COMMENT.test(line) && BARE_WORD.test(line)),
    );
    expect(offenders).toEqual([]);
  });

  it('actually scanned the source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });
});
