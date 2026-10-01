import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/** Organization names are unique like usernames: case-insensitive, spacing-insensitive. */

beforeEach(async () => {
  await resetDb();
});

function register(organizationName: string, email = `o-${Math.random().toString(36).slice(2, 8)}@example.com`) {
  return api().post('/api/auth/register').send({ organizationName, email, password: 'Password123' });
}

function availability(name: string) {
  return api().get('/api/auth/organization-name-availability').query({ name });
}

describe('unique organization names', () => {
  it('keeps the name as typed for display, and a lower-case key for uniqueness', async () => {
    const res = await register('  Volvo   Dhaka ');
    expect(res.status).toBe(201);
    expect(res.body.data.organization.name).toBe('Volvo   Dhaka');

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: res.body.data.organization.id } });
    expect(stored.nameKey).toBe('volvo dhaka');
    expect(res.body.data.organization).not.toHaveProperty('nameKey');
  });

  it('refuses the same name in any capitalisation or spacing', async () => {
    expect((await register('Volvo Dhaka')).status).toBe(201);

    for (const variant of ['volvo dhaka', 'VOLVO DHAKA', '  Volvo   Dhaka  ']) {
      const res = await register(variant);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORGANIZATION_NAME_TAKEN');
    }
    expect(await prisma.organization.count()).toBe(1);
  });

  it('two simultaneous registrations of one name: exactly one succeeds', async () => {
    const results = await Promise.all([0, 1, 2, 3].map(() => register('Race Clinic')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ORGANIZATION_NAME_TAKEN')).toBe(true);
  });

  it('a sign-up that expired unverified does not keep its name', async () => {
    const lapsed = await register('Abandoned Shop');
    await prisma.staff.update({
      where: { id: lapsed.body.data.staff.id as string },
      data: { registrationExpiresAt: new Date(Date.now() - 1000) },
    });

    expect((await availability('abandoned shop')).body.data.available).toBe(true);
    const claimed = await register('ABANDONED SHOP');
    expect(claimed.status).toBe(201);
    expect(await prisma.organization.findUnique({ where: { id: lapsed.body.data.organization.id } })).toBeNull();
  });

  it('a sign-up still inside its hour keeps its name', async () => {
    await register('Fresh Shop');
    expect((await availability('fresh shop')).body.data.available).toBe(false);
    expect((await register('Fresh Shop')).status).toBe(409);
  });
});

describe('GET /api/auth/organization-name-availability', () => {
  it('answers available / taken case-insensitively, and nothing more', async () => {
    await register('Acme Pharmacy');

    const taken = await availability('ACME pharmacy');
    expect(taken.status).toBe(200);
    expect(taken.body.data).toEqual({ available: false });

    const free = await availability('Acme Pharmacy North');
    expect(free.body.data).toEqual({ available: true });
  });

  it('validates the name like registration does', async () => {
    const res = await availability(' a ');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('renaming an organization', () => {
  function rename(accessToken: string, name: string) {
    return api().put('/api/organizations/me').set('Authorization', `Bearer ${accessToken}`).send({ name });
  }

  it('cannot take another organization’s name', async () => {
    await registerOwner({ organizationName: 'First Clinic' });
    const second = await registerOwner({ organizationName: 'Second Clinic' });

    const res = await rename(second.accessToken, 'first CLINIC');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORGANIZATION_NAME_TAKEN');
  });

  it('may change the capitalisation of its own name, and the key follows a real rename', async () => {
    const owner = await registerOwner({ organizationName: 'corner shop' });

    expect((await rename(owner.accessToken, 'Corner Shop')).status).toBe(200);
    const renamed = await rename(owner.accessToken, 'Corner Shop Two');
    expect(renamed.status).toBe(200);

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: owner.organizationId } });
    expect(stored.name).toBe('Corner Shop Two');
    expect(stored.nameKey).toBe('corner shop two');
    expect((await availability('corner shop')).body.data.available).toBe(true);
  });
});
