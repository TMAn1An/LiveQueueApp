import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { AuthLayout } from './layouts/AuthLayout';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './layouts/ProtectedRoute';
import { PermissionRoute } from './layouts/PermissionRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { QueuesPage } from './pages/QueuesPage';
import { QueueDetailsPage } from './pages/QueueDetailsPage';
import { QueueCountersPage } from './pages/QueueCountersPage';
import { StaffPage } from './pages/StaffPage';
import { BlockedDevicesPage } from './pages/BlockedDevicesPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { OrganizationSettingsPage } from './pages/OrganizationSettingsPage';
import { ProfilePage } from './pages/ProfilePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/queues" element={<QueuesPage />} />
                <Route path="/queues/:queueId" element={<QueueDetailsPage />} />
                <Route path="/queues/:queueId/counters" element={<QueueCountersPage />} />
                <Route element={<PermissionRoute permission="manage_staff" />}>
                  <Route path="/staff" element={<StaffPage />} />
                </Route>
                <Route element={<PermissionRoute permission="manage_blocked_devices" />}>
                  <Route path="/devices" element={<BlockedDevicesPage />} />
                </Route>
                <Route path="/reports" element={<ReportsPage />} />
                <Route element={<PermissionRoute permission="view_audit_logs" />}>
                  <Route path="/audit-logs" element={<AuditLogsPage />} />
                </Route>
                <Route element={<PermissionRoute permission="manage_organization" />}>
                  <Route path="/organization" element={<OrganizationSettingsPage />} />
                </Route>
                <Route path="/profile" element={<ProfilePage />} />
              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
