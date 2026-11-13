import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application error with a stable machine-readable `code` and a Serbian,
 * user-safe `message`. Everything the client sees goes through this shape.
 */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super({ statusCode: status, code, message, fieldErrors }, status);
  }
}

export const badRequest = (code: string, message: string, fieldErrors?: Record<string, string>) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message, fieldErrors);

export const unauthorized = (message = 'Prijavi se da nastaviš.', code = 'UNAUTHORIZED') =>
  new AppError(HttpStatus.UNAUTHORIZED, code, message);

export const forbidden = (message = 'Nemaš dozvolu za ovu radnju.') => new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

/**
 * Used both for "does not exist" and "exists but belongs to someone else",
 * so the API never confirms the existence of another organizer's data.
 */
export const notFound = (message = 'Traženi podatak nije pronađen.') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);

export const conflict = (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message);
