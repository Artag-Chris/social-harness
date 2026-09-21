import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JsonLogger } from './json-logger.service';
import type { AuthPayload } from '../modules/auth/auth.types';

/**
 * Filtro global de errores.
 *
 * Dos motivos:
 *  1. **Un formato de error único.** El dashboard y yo leemos los errores de la
 *     misma forma, y un 400 por validación se ve distinto de un 404 de negocio.
 *  2. **No filtrar internos.** Un error de Prisma (o de red) NO es una
 *     `HttpException`: se loguea completo del lado del servidor y al cliente le
 *     llega un 500 genérico. Sin esto, un mensaje de Prisma podría terminar en
 *     la UI contando detalles de la base.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { auth?: AuthPayload }>();

    const where = {
      method: request.method,
      path: request.url,
      user: request.auth?.sub ?? null,
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Un 5xx sí es un error del servidor (se loguea); un 4xx es una respuesta
      // de negocio esperable y no ensucia el log con stack.
      if (status >= 500) {
        this.logger.error({ msg: 'Error de servidor', status, ...where }, 'Exception');
      }

      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    this.logger.error(
      {
        msg: 'Error no controlado',
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        ...where,
      },
      'Exception',
    );

    response.status(500).json({
      statusCode: 500,
      message: 'Error interno del servidor',
      path: request.url,
    });
  }
}
