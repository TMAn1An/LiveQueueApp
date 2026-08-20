import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../utils/AppError';

interface Schemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Validates and replaces req.body/params/query with the parsed, typed result.
 * Never trust unvalidated external input (CLAUDE.md section 9).
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new AppError(422, 'VALIDATION_ERROR', formatZodError(err)));
        return;
      }
      next(err);
    }
  };
}
