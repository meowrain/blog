import { ConsoleLogger, LoggerService, LogLevel } from '@nestjs/common';
import { currentRequestId } from './request-context';

/**
 * Single funnel for every log line in the process. Its only job is to attach the
 * requestId of the request currently being handled, so a line emitted three layers
 * down in FileService can still be correlated with the request that caused it.
 *
 * Registered through `app.useLogger()`; extra positional arguments (context, stack)
 * are forwarded untouched so Nest keeps inferring the context as usual.
 */
export class AppLogger implements LoggerService {
  private readonly console = new ConsoleLogger();

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.console.log(this.withRequestId(message), ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.console.error(this.withRequestId(message), ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.console.warn(this.withRequestId(message), ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.console.debug(this.withRequestId(message), ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.console.verbose(this.withRequestId(message), ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.console.fatal(this.withRequestId(message), ...optionalParams);
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.console.isLevelEnabled(level);
  }

  private withRequestId(message: unknown): unknown {
    const requestId = currentRequestId();
    if (!requestId || typeof message !== 'string') {
      return message;
    }
    return `${message} requestId=${requestId}`;
  }
}
