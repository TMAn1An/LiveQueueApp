import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { adoptInstallationFromUrl } from './installation';
import { PortalApp } from './PortalApp';

// A Home Screen launch may carry this browser's installation id (ADR-068).
adoptInstallationFromUrl(window.location, window.history);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
);
