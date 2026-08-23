import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/Spinner';

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <Spinner label="Loading session…" />;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
