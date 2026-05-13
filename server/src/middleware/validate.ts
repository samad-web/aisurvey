import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body)   req.body   = schemas.body.parse(req.body);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        Object.assign(req.query, parsed);
      }
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const uuidParam = z.object({ id: z.string().uuid() });
