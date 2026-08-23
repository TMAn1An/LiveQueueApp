import { Outlet } from 'react-router-dom';

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-bold text-slate-900">LiveQueue</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
