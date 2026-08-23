import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob } from './csv';

describe('downloadBlob', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an anchor, clicks it with the given filename, and revokes the object URL', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv' });

    downloadBlob(blob, 'report.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('does not leave the anchor element attached to the document', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = new Blob(['x'], { type: 'text/csv' });

    downloadBlob(blob, 'report.csv');

    expect(document.querySelectorAll('a[download="report.csv"]')).toHaveLength(0);
  });
});
