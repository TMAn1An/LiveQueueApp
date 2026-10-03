import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrganizationQrCard } from './OrganizationQrCard';
import { organizationQrUrl } from '../utils/organizationQrUrl';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => undefined) } }));

describe('Organization QR (ADR-068)', () => {
  it('encodes one stable /visit/{publicCode} address on the portal origin', () => {
    expect(organizationQrUrl('abc123def456', 'https://app.livequeue.example/')).toBe(
      'https://app.livequeue.example/visit/abc123def456',
    );
  });

  it('shows the organization, the address it encodes, and download/print/copy', async () => {
    const QRCode = (await import('qrcode')).default;
    render(<OrganizationQrCard organizationName="ABC Hospital" publicCode="abc123def456" />);
    const url = `${window.location.origin}/visit/abc123def456`;
    expect(screen.getByRole('heading', { name: 'ABC Hospital' })).toBeInTheDocument();
    expect(screen.getByTestId('org-qr-url')).toHaveTextContent(url);
    expect(QRCode.toCanvas).toHaveBeenCalledWith(expect.anything(), url, expect.anything());
    for (const name of ['Download QR', 'Print', 'Copy link']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
