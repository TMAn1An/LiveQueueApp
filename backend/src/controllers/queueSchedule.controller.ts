import type { Request, Response } from 'express';
import * as scheduleService from '../services/queueSchedule.service';

export async function list(req: Request, res: Response) {
  const sessions = await scheduleService.listQueueSessions(
    req.auth!.organizationId,
    req.params.queueId as string,
  );
  res.status(200).json({ success: true, data: sessions });
}

export async function create(req: Request, res: Response) {
  const session = await scheduleService.createQueueSession(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body,
  );
  res.status(201).json({ success: true, data: session });
}

export async function update(req: Request, res: Response) {
  const session = await scheduleService.updateQueueSession(
    req.auth!.organizationId,
    req.params.sessionId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: session });
}

export async function remove(req: Request, res: Response) {
  await scheduleService.deleteQueueSession(req.auth!.organizationId, req.params.sessionId as string);
  res.status(204).send();
}
