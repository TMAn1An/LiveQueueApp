import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import type { SessionMeta } from '../services/session.service';

function sessionMeta(req: Request): SessionMeta {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body, sessionMeta(req));
  res.status(201).json({ success: true, data: result });
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body, sessionMeta(req));
  res.status(200).json({ success: true, data: result });
}

export async function me(req: Request, res: Response) {
  const result = await authService.getCurrentUser(req.auth!.staffId);
  res.status(200).json({ success: true, data: result });
}

export async function refresh(req: Request, res: Response) {
  const result = await authService.refresh(req.body.refreshToken, sessionMeta(req));
  res.status(200).json({ success: true, data: result });
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.body.refreshToken, req.auth!.staffId);
  res.status(204).send();
}
