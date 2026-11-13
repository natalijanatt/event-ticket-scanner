import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

/**
 * Validates and normalizes a request payload with a Zod schema. The schemas
 * live in `@event-platform/shared`, so the browser form and the API enforce
 * exactly the same rules. Unknown keys are stripped by Zod's default behavior.
 */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    const first = result.error.issues[0];
    throw badRequest('VALIDATION_ERROR', first?.path.length ? 'Proveri unete podatke.' : (first?.message ?? 'Proveri unete podatke.'), fieldErrors);
  }
}

export const zod = <S extends ZodTypeAny>(schema: S) => new ZodPipe(schema);
