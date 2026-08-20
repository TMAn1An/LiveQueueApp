import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

describe('Tenant isolation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("GET /me only ever returns the authenticated staff member's own organization", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });

    const resA = await api().get('/api/auth/me').set('Authorization', `Bearer ${orgA.accessToken}`);
    const resB = await api().get('/api/auth/me').set('Authorization', `Bearer ${orgB.accessToken}`);

    expect(resA.body.data.organization.id).toBe(orgA.organizationId);
    expect(resB.body.data.organization.id).toBe(orgB.organizationId);
    expect(resA.body.data.organization.id).not.toBe(resB.body.data.organization.id);
  });

  it('ignores a forged organizationId claim and uses the database-authoritative tenant instead', async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });

    // Simulates a token whose embedded organizationId claim has been tampered
    // with (or is simply stale) to point at another tenant. The staff id
    // (sub) still belongs to Org A.
    const forgedToken = jwt.sign(
      { sub: orgA.staffId, organizationId: orgB.organizationId, role: 'OWNER' },
      process.env.JWT_SECRET as string,
      { expiresIn: '15m' },
    );

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${forgedToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(orgA.organizationId);
    expect(res.body.data.organization.id).not.toBe(orgB.organizationId);
  });
});
