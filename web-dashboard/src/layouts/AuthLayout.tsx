import { Outlet } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';

/**
 * Chrome shared by the authentication screens: a centred column, exactly one
 * LiveQueue lockup, and one card. Pages mounted here render only their own
 * contents — no wrapper, no card, no logo of their own.
 *
 * `brand` decides where that single lockup sits. Sign-in, registration and
 * email verification put it above the card, where it introduces the product
 * to someone who may have arrived cold, and it doubles as the page heading
 * because those pages have none of their own. The invitation setup screen
 * puts it inside instead: that visitor arrived from an email and already
 * knows what they were invited to, so the card reads better as one object —
 * and the page has a real `<h1>` of its own, which is why the inside
 * placement is deliberately not a heading.
 */
export function AuthLayout({ brand = 'above' }: { brand?: 'above' | 'inside' }) {
  // The full lockup (tagline included) reads cleanly at this column width —
  // these are the only screens wide enough for it.
  const logo = <BrandLogo variant="full" className="h-auto w-72 max-w-full" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-subtle px-4">
      <div className="w-full max-w-sm">
        {brand === 'above' && <h1 className="mb-6 flex justify-center">{logo}</h1>}
        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          {brand === 'inside' && <div className="mb-5 flex justify-center">{logo}</div>}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
