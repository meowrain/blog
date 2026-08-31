import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LIMITS } from './constants';

/**
 * One line per successful request; AppLogger adds the requestId. Failures are logged
 * by GlobalHttpExceptionFilter instead, so a bad request produces exactly one entry.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = http.getResponse<Response>();
        const durationMs = Date.now() - startedAt;
        const message = `${request.method} ${request.originalUrl} ${response.statusCode} ${durationMs}ms`;
        if (durationMs >= LIMITS.SLOW_REQUEST_MS) {
          this.logger.warn(message);
          return;
        }
        this.logger.log(message);
      }),
    );
  }
}
