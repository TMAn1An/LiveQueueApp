import { BrandLogo } from './BrandLogo';

/**
 * The branded wait screen for signing in and creating an organization —
 * only there, and only once the request has taken longer than
 * AUTH_LOADER_DELAY_MS, so a quick sign-in never flashes it.
 */
export function AuthLoadingOverlay({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-surface/95 px-6 backdrop-blur-sm"
    >
      <BrandLogo variant="full" className="h-auto w-56 max-w-full" />
      <span
        aria-hidden="true"
        className="h-9 w-9 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600 motion-reduce:animate-none"
      />
      <p className="text-sm font-medium text-fg-soft">{message}</p>
    </div>
  );
}
