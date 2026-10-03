import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { classifyBrowser, currentBrowserSignals, isPortalAllowed, type BrowserKind } from './browserGate';
import { GatePage } from './pages/GatePage';
import { LandingPage } from './pages/LandingPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { JoinPage } from './pages/JoinPage';
import { TrackingPage } from './pages/TrackingPage';

export function PortalRoutes() {
  return (
    <Routes>
      <Route path="/visit/token/:tokenId" element={<TrackingPage />} />
      <Route path="/visit/:publicCode/q/:queueId" element={<JoinPage />} />
      <Route path="/visit/:publicCode" element={<OrganizationPage />} />
      <Route path="/visit" element={<LandingPage />} />
      <Route path="*" element={<Navigate to="/visit" replace />} />
    </Routes>
  );
}

/**
 * ADR-068: the iPhone/iPad portal. Everyone else gets a friendly pointer to
 * the right place — a product gate, not security (the backend trusts
 * nothing a browser says about itself).
 */
export function PortalApp({ kind = classifyBrowser(currentBrowserSignals()) }: { kind?: BrowserKind }) {
  if (!isPortalAllowed(kind)) {
    return <GatePage kind={kind as Exclude<BrowserKind, 'ios-safari' | 'ios-standalone'>} />;
  }
  return (
    <BrowserRouter>
      <PortalRoutes />
    </BrowserRouter>
  );
}
