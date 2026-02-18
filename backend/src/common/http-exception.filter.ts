import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw = isHttpException ? exception.getResponse() : null;
    const details =
      typeof raw === 'object' && raw !== null ? raw : undefined;
    const message = this.extractMessage(exception, raw);

    response.status(status).json({
      code: this.toCode(status),
      message,
      details,
      requestId: request.requestId ?? null,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private extractMessage(exception: unknown, raw: unknown): string {
    if (typeof raw === 'object' && raw !== null && 'message' in raw) {
      const value = (raw as { message: unknown }).message;
      if (Array.isArray(value)) return value.join('; ');
      if (typeof value === 'string') return value;
    }

    if (exception instanceof Error) return exception.message;
    return 'Internal server error';
  }

  private toCode(status: number): string {
    if (status >= 500) return 'INTERNAL_ERROR';
    if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    return 'REQUEST_ERROR';
  }
}
