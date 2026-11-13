import { PipeTransform } from '@nestjs/common';
import { notFound } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects malformed ids with the same 404 a missing record would produce. */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw notFound();
    return value.toLowerCase();
  }
}

export const Uuid = new UuidPipe();
