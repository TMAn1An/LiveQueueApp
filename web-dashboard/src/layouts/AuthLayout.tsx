import { Outlet } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        {/* The full lockup (tagline included) reads cleanly at this column
            width — this is the one screen wide enough for it. */}
        <h1 className="mb-6 flex justify-center">
          <BrandLogo variant="full" className="h-auto w-72 max-w-full" />
        </h1>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
