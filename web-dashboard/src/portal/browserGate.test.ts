import { describe, expect, it } from 'vitest';
import { classifyBrowser, iosMajorVersion, isPortalAllowed } from './browserGate';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // iPadOS Safari asks for desktop sites by default: a Mac User-Agent.
  ipadDesktopClass:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.2903.68 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0.0',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const classify = (userAgent: string, maxTouchPoints = 5, standalone = false) =>
  classifyBrowser({ userAgent, maxTouchPoints, standalone });

describe('portal browser gate (ADR-068) — a product gate, not security', () => {
  it('allows Safari on iPhone and iPad, including iPadOS desktop-class Safari', () => {
    expect(classify(UA.iphoneSafari)).toBe('ios-safari');
    expect(classify(UA.ipadSafari)).toBe('ios-safari');
    expect(classify(UA.ipadDesktopClass, 5)).toBe('ios-safari');
    for (const ua of [UA.iphoneSafari, UA.ipadSafari]) expect(isPortalAllowed(classify(ua))).toBe(true);
  });

  it('allows the Home Screen web app', () => {
    expect(classify(UA.iphoneSafari, 5, true)).toBe('ios-standalone');
    expect(isPortalAllowed('ios-standalone')).toBe(true);
  });

  it('sends other iPhone browsers and in-app web views to Safari', () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge, UA.iphoneInstagram]) {
      expect(classify(ua)).toBe('ios-other');
      expect(isPortalAllowed('ios-other')).toBe(false);
    }
  });

  it('sends Android to the app and desktops away', () => {
    expect(classify(UA.android)).toBe('android');
    expect(classify(UA.windowsChrome, 0)).toBe('desktop');
    // A Mac without touch is a Mac, not an iPad.
    expect(classify(UA.macSafari, 0)).toBe('desktop');
    expect(isPortalAllowed('android')).toBe(false);
    expect(isPortalAllowed('desktop')).toBe(false);
  });

  it('reads the iOS version for the 16.4+ notification note', () => {
    expect(iosMajorVersion(UA.iphoneSafari)).toBe(18);
    expect(iosMajorVersion(UA.ipadSafari)).toBe(17);
    expect(iosMajorVersion(UA.ipadDesktopClass)).toBe(18);
  });
});
