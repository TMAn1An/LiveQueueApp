import { beforeEach, describe, expect, it } from 'vitest';
import {
  adoptInstallationFromUrl,
  forgetVisit,
  getBrowserInstallationId,
  rememberVisit,
  rememberedVisits,
  urlCarryingInstallation,
} from './installation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/visit/token/t1');
});

describe('browser installation identity (ADR-068)', () => {
  it('is a random UUID, created once and kept', () => {
    const id = getBrowserInstallationId();
    expect(id).toMatch(UUID);
    expect(getBrowserInstallationId()).toBe(id);
    expect(localStorage.getItem('livequeue.portal.browserInstallationId')).toBe(id);
  });

  it('a cleared browser gets a new one, as expected', () => {
    const first = getBrowserInstallationId();
    localStorage.clear();
    const fresh = '6a1f3c2e-1b2c-4d3e-8f40-0123456789ab';
    // Simulate a new profile by seeding a different id.
    localStorage.setItem('livequeue.portal.browserInstallationId', fresh);
    expect(getBrowserInstallationId()).toBe(fresh);
    expect(fresh).not.toBe(first);
  });

  it('the page added to the Home Screen carries the id once', () => {
    const id = getBrowserInstallationId();
    expect(urlCarryingInstallation(window.location)).toBe(`/visit/token/t1?install=${id}`);
  });

  it('a Home Screen launch adopts the carried id and removes it from the address', () => {
    const carried = '0b5c2a10-7d3e-4f51-9a62-abcdefabcdef';
    window.history.replaceState(null, '', `/visit/token/t1?install=${carried}&x=1`);
    adoptInstallationFromUrl(window.location, window.history);
    expect(getBrowserInstallationId()).toBe(carried);
    expect(window.location.search).toBe('?x=1');
  });

  it('never overwrites an existing id, and ignores anything that is not a UUID', () => {
    const mine = getBrowserInstallationId();
    window.history.replaceState(null, '', '/visit?install=0b5c2a10-7d3e-4f51-9a62-abcdefabcdef');
    adoptInstallationFromUrl(window.location, window.history);
    expect(getBrowserInstallationId()).toBe(mine);

    localStorage.clear();
    window.history.replaceState(null, '', '/visit?install=not-a-uuid');
    adoptInstallationFromUrl(window.location, window.history);
    expect(getBrowserInstallationId()).toMatch(UUID);
    expect(window.location.search).toBe('');
  });

  it('remembers this browser’s visits, newest first, and forgets them', () => {
    rememberVisit({ tokenId: 'a', serialNumber: 'A001', queueName: 'Pharmacy', organizationCode: 'x', joinedAt: '1' });
    rememberVisit({ tokenId: 'b', serialNumber: 'B001', queueName: 'Billing', organizationCode: 'x', joinedAt: '2' });
    expect(rememberedVisits().map((v) => v.tokenId)).toEqual(['b', 'a']);
    forgetVisit('b');
    expect(rememberedVisits().map((v) => v.tokenId)).toEqual(['a']);
  });
});
