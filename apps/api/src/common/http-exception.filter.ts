import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from './errors';

const GENERIC_MESSAGES: Record<number, string> = {
  400: 'Zahtev nije ispravan.',
  401: 'Prijavi se da nastaviš.',
  403: 'Nemaš dozvolu za ovu radnju.',
  404: 'Traženi podatak nije pronađen.',
  409: 'Radnja je u sukobu sa trenutnim stanjem podataka.',
  413: 'Fajl je prevelik.',
  429: 'Previše pokušaja. Sačekaj malo pa pokušaj ponovo.',
};

/**
 * Single place where errors become HTTP responses. Internal details
 * (stack traces, SQL, Prisma messages) are logged but never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Došlo je do greške. Pokušaj ponovo.';
    let fieldErrors: Record<string, string> | undefined;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      fieldErrors = exception.fieldErrors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'ERROR';
      message = GENERIC_MESSAGES[status] ?? message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE';
        message = 'Takav zapis već postoji.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = GENERIC_MESSAGES[404];
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'IN_USE';
        message = 'Zapis se koristi i ne može biti obrisan.';
      }
    }

    if (status >= 500) {
      // Path only – query strings and bodies can carry personal data or tokens.
      this.logger.error(
        `${req.method} ${req.path} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (res.headersSent) return;
    res.status(status).json({ statusCode: status, code, message, ...(fieldErrors ? { fieldErrors } : {}) });
  }
}
