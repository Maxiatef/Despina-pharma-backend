import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';

/**
 * Turns database errors into clean HTTP answers instead of 500s:
 * unique violation -> 409, foreign key / check / bad enum -> 400, not found -> 404.
 */
@Catch(QueryFailedError, EntityNotFoundError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Database');

  catch(exception: QueryFailedError | EntityNotFoundError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof EntityNotFoundError) {
      return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, error: 'Not Found', message: 'Record not found' });
    }

    const err = exception as QueryFailedError & { code?: string; detail?: string; constraint?: string };
    const map: Record<string, [number, string, string]> = {
      '23505': [HttpStatus.CONFLICT, 'Conflict', 'A record with these values already exists'],
      '23503': [HttpStatus.BAD_REQUEST, 'Bad Request', 'Referenced record does not exist or is still in use'],
      '23514': [HttpStatus.BAD_REQUEST, 'Bad Request', 'Value is not allowed'],
      '23502': [HttpStatus.BAD_REQUEST, 'Bad Request', 'A required value is missing'],
      '22P02': [HttpStatus.BAD_REQUEST, 'Bad Request', 'Invalid value format'],
    };
    const hit = err.code ? map[err.code] : undefined;
    if (hit) {
      return res.status(hit[0]).json({ statusCode: hit[0], error: hit[1], message: hit[2], constraint: err.constraint });
    }
    this.logger.error(exception.message, exception.stack);
    return res.status(500).json({ statusCode: 500, error: 'Internal Server Error', message: 'Unexpected database error' });
  }
}
