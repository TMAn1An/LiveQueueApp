import type { Request, Response } from 'express';
import * as counterService from '../services/counter.service';

export async function list(req: Request, res: Response) {
  const counters = await counterService.listCounters(
    req.auth!.organizationId,
    req.params.queueId as string,
  );
  res.status(200).json({ success: true, data: counters });
}

export async function create(req: Request, res: Response) {
  const counter = await counterService.createCounter(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body,
  );
  res.status(201).json({ success: true, data: counter });
}

export async function update(req: Request, res: Response) {
  const counter = await counterService.updateCounter(
    req.auth!.organizationId,
    req.params.counterId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: counter });
}

export async function updateStatus(req: Request, res: Response) {
  const counter = await counterService.setCounterStatus(
    req.auth!.organizationId,
    req.params.counterId as string,
    req.body.status,
  );
  res.status(200).json({ success: true, data: counter });
}

export async function remove(req: Request, res: Response) {
  await counterService.deleteCounter(req.auth!.organizationId, req.params.counterId as string);
  res.status(204).send();
}

export async function assign(req: Request, res: Response) {
  const counter = await counterService.assignCounter(
    req.auth!.organizationId,
    req.params.counterId as string,
    req.body.staffId,
  );
  res.status(200).json({ success: true, data: counter });
}
