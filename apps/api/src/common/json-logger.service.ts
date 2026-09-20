import { Injectable, type LoggerService } from '@nestjs/common';
import { env } from '../config/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Regla de filtrado, aislada y pura.
 *
 * Está exportada porque es lo único que hay que probar del filtrado, y así se
 * prueba sin depender del `LOG_LEVEL` del entorno donde corren los tests.
 */
export function isLevelEnabled(level: LogLevel, configured: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured];
}

/**
 * Logger en una línea JSON por evento (mismo formato que atiende/cv-harness).
 *
 * Por qué importa: los logs de este harness se leen pegados en un chat cuando
 * algo falla en el server, así que tienen que ser autocontenidos (campos
 * buscables, sin `console.log` suelto) y con el nivel filtrable desde
 * `LOG_LEVEL`.
 *
 * Sin parámetros de constructor A PROPÓSITO: un parámetro con valor por defecto
 * hace que Nest emita `String` como dependencia e intente inyectarla, y el
 * contenedor no arranca. El nivel sale de la configuración ya validada (es una
 * decisión de boot, como el resto de la configuración: no cambia en caliente).
 */
@Injectable()
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  /**
   * Nest lo invoca en errores no atrapados del arranque y del ciclo de vida. Si
   * no existiera, esos casos se pierden (o se loguean con otro formato): el log
   * del contenedor dejaría de ser JSON uniforme justo cuando más se lee.
   */
  fatal(message: unknown, context?: string): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    if (!isLevelEnabled(level, env.LOG_LEVEL)) return;

    // Los campos del mensaje se escriben primero y `level`/`time` DESPUÉS: así un
    // mensaje que traiga su propia clave `level` no puede falsear la línea (el
    // nivel y el instante son del logger, no de quien escribe).
    const payload: Record<string, unknown> = {
      ...(this.normalize(message) as Record<string, unknown>),
      ...(context ? { context } : {}),
      level,
      time: new Date().toISOString(),
    };
    if (trace) payload.trace = trace;

    const line = `${JSON.stringify(payload)}\n`;
    if (level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  }

  /** Acepta string o un objeto con campos: el objeto se aplana en la línea. */
  private normalize(message: unknown): Record<string, unknown> {
    if (typeof message === 'string') return { msg: message };
    if (message instanceof Error) return { msg: message.message, stack: message.stack };
    if (message && typeof message === 'object') return message as Record<string, unknown>;
    return { msg: String(message) };
  }
}
