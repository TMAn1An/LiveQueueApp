import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler';
import { AppError } from '../src/utils/AppError';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

/**
 * Phase 7 Step 6 — structured error logging confirmation. errorHandler.ts's
 * "no leak" guarantee is almost impossible to exercise honestly through a
 * real HTTP request: every service in this codebase pre-validates existence
 * and known failure modes before touching Prisma (CLAUDE.md's tenant-scoped
 * lookup pattern), so the generic 500 / raw-Prisma-error branches are, by
 * design, dead code under normal operation. Unit-testing errorHandler
 * directly — a pure (err, req, res, next) => void function — with
 * constructed Error/Prisma-error instances proves the guarantee exhaustively
 * without mocking the database or contorting it into a failure state, which
 * this codebase's own conventions avoid for integration tests.
 */
function mockReq(path = '/api/test'): Request {
  return { path } as Request;
}

function mockRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler — no leak guarantee (unit)', () => {
  it('returns exactly the AppError code/message, nothing else', () => {
    const res = mockRes();
    errorHandler(new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.'), mockReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'QUEUE_NOT_FOUND', message: 'Queue not found.' },
    });
  });

  it('maps a Prisma unique-constraint violation (P2002) to a generic 409, never the raw constraint detail', () => {
    const res = mockRes();
    const prismaErr = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '6.12.0' },
    );

    errorHandler(prismaErr, mockReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'A record with this value already exists.' },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('constraint');
  });

  it('a Prisma error other than P2002 falls back to the generic 500 without leaking Prisma detail', () => {
    const res = mockRes();
    const prismaErr = new Prisma.PrismaClientKnownRequestError(
      'An operation failed because it depends on one or more records that were required but not found.',
      { code: 'P2025', clientVersion: '6.12.0' },
    );

    errorHandler(prismaErr, mockReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  });

  it('maps a raw unexpected error to a generic 500 — the error message/stack never reach the client', () => {
    const res = mockRes();
    const secretDetail = 'connection failed: postgres://livequeue:hunter2@db-internal.local:5432/livequeue_dev';
    const err = new Error(secretDetail);

    errorHandler(err, mockReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain(secretDetail);
  });

  it('never includes a stack trace or filesystem path in any error response body', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), mockReq(), res, vi.fn());

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).not.toHaveProperty('stack');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('.ts:');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toContain('at ');
  });
});

describe('error responses — real HTTP wiring (integration)', () => {
  it('a 404 through the real app returns only the typed code/message, no internal detail', async () => {
    await resetDb();
    const ctx = await registerOwner();

    const res = await api()
      .get('/api/queues/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'QUEUE_NOT_FOUND', message: 'Queue not found.' },
    });
    expect(res.body).not.toHaveProperty('stack');
  });

  it('a validation error through the real app never echoes back a submitted secret value', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ organizationName: '', email: 'not-an-email', password: 'super-secret-password-value' });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-password-value');
  });
});
