import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthLayout } from './layouts/AuthLayout';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './layouts/ProtectedRoute';
import { PermissionRoute } from './layouts/PermissionRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import { DashboardPage } from './pages/DashboardPage';
import { QueuesPage } from './pages/QueuesPage';
import { QueueDetailsPage } from './pages/QueueDetailsPage';
import { QueueCountersPage } from './pages/QueueCountersPage';
import { QueueLivePage } from './pages/QueueLivePage';
import { StaffPage } from './pages/StaffPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { ServiceHistoryPage } from './pages/ServiceHistoryPage';
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
      <ThemeProvider>
        <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
            </Route>

            {/* Same chrome, one lockup, placed inside the card instead of
                above it — see AuthLayout. */}
            <Route element={<AuthLayout brand="inside" />}>
              <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/queues" element={<QueuesPage />} />
                <Route path="/queues/:queueId" element={<QueueDetailsPage />} />
                <Route path="/queues/:queueId/live" element={<QueueLivePage />} />
                <Route path="/queues/:queueId/counters" element={<QueueCountersPage />} />
                <Route element={<PermissionRoute permission="manage_staff" />}>
                  <Route path="/staff" element={<StaffPage />} />
                </Route>
                <Route path="/reports" element={<ReportsPage />} />
                <Route element={<PermissionRoute permission="view_reports" />}>
                  <Route path="/service-history" element={<ServiceHistoryPage />} />
                </Route>
                <Route element={<PermissionRoute permission="view_audit_logs" />}>
                  <Route path="/audit-logs" element={<AuditLogsPage />} />
                </Route>
                <Route element={<PermissionRoute permission="manage_organization" />}>
                  <Route path="/organization" element={<OrganizationSettingsPage />} />
                </Route>
                <Route path="/profile" element={<ProfilePage />} />
              </Route>
            </Route>

            {/* Device Blocking is withdrawn from the dashboard: it blocks an
                installation, not a person, and leaving it on screen next to
                the verified-identity repeat rules implied a person-level ban
                the product cannot make good on. The backend, the data and
                BlockedDevicesPage are all still here — only the route is
                gone, so /devices falls through to the catch-all below and
                lands on the dashboard like any other unknown path. */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
