import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from './Button';
import { Card } from './Card';
import { SectionHeading } from './SectionHeading';
import { organizationQrUrl } from '../utils/organizationQrUrl';

/**
 * ADR-068: the organization's one QR code. It opens a page listing every
 * listed queue, so it never needs reprinting when queues are added, renamed
 * or removed. iPhone/iPad users open it in Safari; the Android app reads the
 * same code.
 */
export function OrganizationQrCard({ organizationName, publicCode }: { organizationName: string; publicCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const url = organizationQrUrl(publicCode);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 });
    }
  }, [url]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${organizationName.replace(/\s+/g, '-').toLowerCase()}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return (
    <Card>
      <SectionHeading
        title="Organization QR code"
        help="One code for all your queues. People scan it, choose a queue and join. Queues you add, rename or remove appear here automatically — no need to reprint. Hide a queue from this page in its settings."
      />
      <div id="org-qr-print-area" className="flex flex-col items-center gap-2 text-center">
        <h3 className="text-lg font-semibold text-fg">{organizationName}</h3>
        <p className="text-sm text-muted">Scan to choose a queue</p>
        <canvas ref={canvasRef} aria-label={`QR code for ${organizationName}`} />
        <p className="break-all font-mono text-xs text-muted" data-testid="org-qr-url">
          {url}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2 print:hidden">
        <Button variant="secondary" onClick={download}>
          Download QR
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #org-qr-print-area, #org-qr-print-area * { visibility: visible; }
          #org-qr-print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </Card>
  );
}
