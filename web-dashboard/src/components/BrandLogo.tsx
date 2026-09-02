/**
 * The official LiveQueue logo, in the two lockups that actually fit this UI.
 *
 * `full` keeps the tagline and is only legible at roughly 280px wide or
 * more, so it is reserved for the authentication screens. `horizontal` is
 * the same artwork cropped to symbol + wordmark, for narrow places like the
 * sidebar. Both assets live in `public/` and are served from the site root.
 */
export function BrandLogo({
  variant = 'horizontal',
  className = '',
}: {
  variant?: 'full' | 'horizontal';
  className?: string;
}) {
  const src = variant === 'full' ? '/logo-full.png' : '/logo-horizontal.png';
  return <img src={src} alt="LiveQueue" className={className} />;
}
