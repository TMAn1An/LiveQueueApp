import { Modal } from './Modal';
import { Button } from './Button';

/**
 * The one place a destructive dashboard action asks "are you sure?" (V2
 * Product Completion checkpoint, Part B: any action that actually deletes,
 * clears, or permanently removes data must ask first, through one reusable
 * component rather than each page inventing its own).
 *
 * Deliberately not for Organization deletion — that flow's "type the name
 * to confirm" step is intentionally stronger than a plain Cancel/Confirm and
 * stays exactly as it is (see OrganizationSettingsPage).
 *
 * Cancel is the safe/default action: it is what the Escape key and the
 * modal's own ✕ both already do (Modal's onClose), and the destructive
 * button is the one styled `danger` so it reads as different from an
 * ordinary confirmation. Nothing is deleted before `onConfirm` is called —
 * this component only ever asks, the caller's own mutation is what acts.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  confirming = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** True while the caller's own mutation is in flight. */
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-4 text-sm text-fg-soft">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={confirming}>
          {cancelLabel}
        </Button>
        <Button variant="danger" loading={confirming} onClick={onConfirm}>
          {confirming ? 'Deleting…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
