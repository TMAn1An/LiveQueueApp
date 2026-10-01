import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SessionReconnecting } from '../components/SessionReconnecting';
import { Spinner } from '../components/Spinner';

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <Spinner label="Loading session…" />;
  }
  // The backend could not be reached to confirm the stored session. That is
  // not a sign-out — and not a sign-in either: the protected screen stays
  // closed until the backend has answered.
  if (status === 'reconnecting') {
    return <SessionReconnecting />;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
