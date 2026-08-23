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
        // Express 5 defines req.query as a getter that recomputes a fresh
        // object from the raw URL on every access — neither a plain
        // assignment (throws: no setter) nor mutating the object returned by
        // one access (silently lost: the next access recomputes) sticks.
        // Redefining the property itself is what actually persists the
        // parsed/coerced/defaulted result for downstream handlers.
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsedQuery,
          writable: true,
          configurable: true,
          enumerable: true,
        });
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
