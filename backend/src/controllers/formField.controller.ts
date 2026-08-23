import type { Request, Response } from 'express';
import * as formFieldService from '../services/formField.service';

export async function list(req: Request, res: Response) {
  const result = await formFieldService.getFormFields(
    req.auth!.organizationId,
    req.params.queueId as string,
  );
  res.status(200).json({ success: true, data: result });
}

export async function replace(req: Request, res: Response) {
  const result = await formFieldService.replaceFormFields(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: result });
}
