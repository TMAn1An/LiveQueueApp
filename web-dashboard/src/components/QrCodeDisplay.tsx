import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Button } from './Button';

/**
 * Spec section 12: generate, display, download, and print a QR code per
 * active queue. Rendered entirely client-side from `qrCodeUri` (a bare
 * `livequeue://queue/{id}` string, ADR-015 decision 3) — no network call, no
 * private data in the code itself.
 */
export function QrCodeDisplay({
  qrCodeUri,
  organizationName,
  queueName,
}: {
  qrCodeUri: string;
  organizationName: string;
  queueName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, qrCodeUri, { width: 220, margin: 2 });
    }
  }, [qrCodeUri]);

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${queueName.replace(/\s+/g, '-').toLowerCase()}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div>
      <div id="qr-print-area" className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm text-slate-500">{organizationName}</p>
        <h3 className="text-lg font-semibold text-slate-900">{queueName}</h3>
        <p className="text-sm text-slate-500">Scan to Join</p>
        <canvas ref={canvasRef} aria-label={`QR code to join ${queueName}`} />
      </div>
      <div className="mt-4 flex justify-center gap-2 print:hidden">
        <Button variant="secondary" onClick={handleDownload}>
          Download QR
        </Button>
        <Button variant="secondary" onClick={handlePrint}>
          Print
        </Button>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #qr-print-area, #qr-print-area * { visibility: visible; }
          #qr-print-area { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        }
      `}</style>
    </div>
  );
}
