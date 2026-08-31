import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = this.resolveStatus(exception, isHttpException);

    const raw = isHttpException ? exception.getResponse() : null;
    const details =
      typeof raw === 'object' && raw !== null ? raw : undefined;
    const message = this.extractMessage(exception, raw, status);

    const line = `${request.method} ${request.originalUrl} ${status} ${message}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(line, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(line);
    }

    response.status(status).json({
      code: this.toCode(status),
      message,
      details,
      requestId: request.requestId ?? null,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * body-parser and friends throw errors built by their own copy of http-errors, so
   * they are not `instanceof HttpException` here. Reading their status is what keeps
   * an oversized payload a 413 instead of turning it into a spurious 500.
   */
  private resolveStatus(exception: unknown, isHttpException: boolean): number {
    if (isHttpException) {
      return (exception as HttpException).getStatus();
    }

    const candidate = exception as { status?: unknown; statusCode?: unknown } | null;
    const raw = candidate?.status ?? candidate?.statusCode;
    if (typeof raw === 'number' && raw >= 100 && raw <= 599) {
      return raw;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private extractMessage(exception: unknown, raw: unknown, status: number): string {
    if (typeof raw === 'object' && raw !== null && 'message' in raw) {
      const value = (raw as { message: unknown }).message;
      if (Array.isArray(value)) return value.join('; ');
      if (typeof value === 'string') return value;
    }

    if (status < HttpStatus.INTERNAL_SERVER_ERROR && exception instanceof Error) {
      return exception.message;
    }
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
