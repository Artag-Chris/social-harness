import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { isLevelEnabled, JsonLogger } from './json-logger.service';

/**
 * La mayoría de las aserciones usan `error` porque es el único nivel que pasa
 * con CUALQUIER `LOG_LEVEL`: así los tests no dependen de cómo esté configurado
 * el entorno donde corren. La regla de filtrado se prueba aparte, como función
 * pura.
 */
describe('isLevelEnabled', () => {
  it('deja pasar lo que está en el nivel configurado o por encima', () => {
    expect(isLevelEnabled('debug', 'debug')).toBe(true);
    expect(isLevelEnabled('error', 'error')).toBe(true);
    expect(isLevelEnabled('warn', 'info')).toBe(true);
  });

  it('descarta lo que está por debajo', () => {
    expect(isLevelEnabled('debug', 'info')).toBe(false);
    expect(isLevelEnabled('info', 'warn')).toBe(false);
    expect(isLevelEnabled('warn', 'error')).toBe(false);
  });
});

describe('JsonLogger', () => {
  let out: string[];
  let err: string[];
  /**
   * Se guardan las funciones de restauración en vez de los spies: `process.stdout.write`
   * está sobrecargado y anotar el tipo del spy obliga a pelear con la firma, sin aportar nada.
   */
  let restores: Array<() => void>;
  let logger: JsonLogger;

  beforeEach(() => {
    out = [];
    err = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    });
    restores = [() => stdoutSpy.mockRestore(), () => stderrSpy.mockRestore()];
    logger = new JsonLogger();
  });

  afterEach(() => {
    // Restauración explícita de los spies de este test (no `restoreAllMocks`): si
    // uno sobreviviera, las escrituras de otro test caerían en el array viejo.
    restores.forEach((restore) => restore());
    restores = [];
  });

  it('escribe UNA línea JSON por evento, con nivel, instante y contexto', () => {
    logger.error({ msg: 'algo pasó', profileId: 'p1' }, undefined, 'MiServicio');

    expect(err).toHaveLength(1);
    const line = JSON.parse(err[0]);
    expect(line.level).toBe('error');
    expect(line.context).toBe('MiServicio');
    expect(line.msg).toBe('algo pasó');
    expect(line.profileId).toBe('p1');
    expect(Number.isNaN(Date.parse(line.time))).toBe(false);
  });

  it('un string se aplana como `msg` y un Error agrega el stack', () => {
    logger.error('texto suelto');
    logger.error(new Error('boom'));

    expect(err).toHaveLength(2);
    expect(JSON.parse(err[0]).msg).toBe('texto suelto');
    const errorLine = JSON.parse(err[1]);
    expect(errorLine.msg).toBe('boom');
    expect(errorLine.stack).toContain('boom');
  });

  it('las claves del mensaje NO pueden falsear el nivel ni el instante', () => {
    logger.error({ level: 'debug', time: 'ayer', msg: 'mentira' });

    const line = JSON.parse(err[0]);
    expect(line.level).toBe('error');
    expect(line.time).not.toBe('ayer');
  });

  it('los avisos van a stdout y los errores a stderr', () => {
    const warnEnabled = isLevelEnabled('warn', env.LOG_LEVEL);
    logger.warn('ojo');

    expect(out).toHaveLength(warnEnabled ? 1 : 0);
    expect(err).toHaveLength(0);
  });

  it('respeta el LOG_LEVEL con el que se configuró el proceso', () => {
    const debugEnabled = isLevelEnabled('debug', env.LOG_LEVEL);
    logger.debug('detalle');

    expect(out).toHaveLength(debugEnabled ? 1 : 0);
  });

  it('"fatal" existe, sale como error y va a stderr (Nest lo usa si algo no se atrapa)', () => {
    logger.fatal('se cayó', 'Bootstrap');

    expect(err).toHaveLength(1);
    const line = JSON.parse(err[0]);
    expect(line.level).toBe('error');
    expect(line.context).toBe('Bootstrap');
  });

  it('"verbose" se comporta EXACTAMENTE igual que "debug" (mapeo)', () => {
    const measure = (call: (target: JsonLogger) => void): { out: number; err: number } => {
      out = [];
      err = [];
      call(logger);
      return { out: out.length, err: err.length };
    };

    const viaDebug = measure((target) => target.debug('x'));
    const viaVerbose = measure((target) => target.verbose('x'));

    expect(viaVerbose).toEqual(viaDebug);
    // Y nunca se confunde con un error: no ensucia stderr.
    expect(viaVerbose.err).toBe(0);
  });
});
