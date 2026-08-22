import type { Request, Response } from 'express';
import * as queueService from '../services/queue.service';
import * as realtime from '../realtime/emit';

export async function list(req: Request, res: Response) {
  const queues = await queueService.listQueues(req.auth!.organizationId);
  res.status(200).json({ success: true, data: queues });
}

export async function create(req: Request, res: Response) {
  const queue = await queueService.createQueue(req.auth!.organizationId, req.body);
  res.status(201).json({ success: true, data: queue });
  await realtime.emitQueueCreated(queue);
}

export async function get(req: Request, res: Response) {
  const queue = await queueService.getQueue(req.auth!.organizationId, req.params.queueId as string);
  res.status(200).json({ success: true, data: queue });
}

export async function update(req: Request, res: Response) {
  const queue = await queueService.updateQueue(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: queue });
  await realtime.emitQueueUpdated(queue);
}

export async function updateStatus(req: Request, res: Response) {
  const queue = await queueService.updateQueueStatus(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body.status,
  );
  res.status(200).json({ success: true, data: queue });
  await realtime.emitQueueStatusChanged(queue);
}

export async function remove(req: Request, res: Response) {
  const queue = await queueService.softDeleteQueue(
    req.auth!.organizationId,
    req.params.queueId as string,
  );
  res.status(200).json({ success: true, data: queue });
}
