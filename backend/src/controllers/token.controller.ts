import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import * as tokenService from '../services/token.service';

function requireIdempotencyKey(req: Request): string {
  const header = req.headers['idempotency-key'];
  if (typeof header !== 'string' || header.trim().length === 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Idempotency-Key header is required.');
  }
  return header;
}

export async function create(req: Request, res: Response) {
  const idempotencyKey = requireIdempotencyKey(req);
  const token = await tokenService.createToken(req.body, idempotencyKey);
  res.status(201).json({ success: true, data: token });
}

export async function get(req: Request, res: Response) {
  const token = await tokenService.getToken(req.params.tokenId as string, req.auth);
  res.status(200).json({ success: true, data: token });
}

export async function getStatus(req: Request, res: Response) {
  const status = await tokenService.getTokenStatus(req.params.tokenId as string);
  res.status(200).json({ success: true, data: status });
}

export async function call(req: Request, res: Response) {
  const token = await tokenService.callToken(
    req.auth!.organizationId,
    req.params.tokenId as string,
    req.body.counterId,
  );
  res.status(200).json({ success: true, data: token });
}

export async function start(req: Request, res: Response) {
  const token = await tokenService.startToken(req.auth!.organizationId, req.params.tokenId as string);
  res.status(200).json({ success: true, data: token });
}

export async function complete(req: Request, res: Response) {
  const token = await tokenService.completeToken(req.auth!.organizationId, req.params.tokenId as string);
  res.status(200).json({ success: true, data: token });
}

export async function skip(req: Request, res: Response) {
  const token = await tokenService.skipToken(req.auth!.organizationId, req.params.tokenId as string);
  res.status(200).json({ success: true, data: token });
}

export async function next(req: Request, res: Response) {
  const token = await tokenService.nextToken(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body.counterId,
  );
  res.status(200).json({ success: true, data: token });
}
