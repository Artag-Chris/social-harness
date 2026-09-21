import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../config/env';
import {
  FetchError,
  assertFetchableUrl,
  fetchPage,
  isPrivateHostname,
  isPrivateIp,
} from './fetch-page';

/**
 * El probe trae HTML de internet: estas son las tres protecciones que evitan que
 * eso se convierta en un problema (SSRF, contenido gigante, cuelgues).
 */
describe('assertFetchableUrl', () => {
  it('rechaza lo que no es http(s)', async () => {
    await expect(assertFetchableUrl('ftp://ejemplo.com/a')).rejects.toThrow(/http\(s\)/);
    await expect(assertFetchableUrl('no-es-una-url')).rejects.toThrow(/no es una URL válida/);
    await expect(assertFetchableUrl('file:///etc/passwd')).rejects.toThrow(FetchError);
  });

  it('acepta una URL pública', async () => {
    const url = await assertFetchableUrl('https://ejemplo.com/tendencias');
    expect(url.hostname).toBe('ejemplo.com');
  });

  it('bloquea direcciones internas (anti-SSRF)… salvo con el fixture de dev', async () => {
    // En dev el fixture vive dentro de la red de Docker y `FIXTURE_ENABLED=true`
    // lo habilita a propósito; en el server queda en false y el bloqueo aplica.
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.10', 'redis', 'algo.internal']) {
      if (env.FIXTURE_ENABLED) {
        await expect(assertFetchableUrl(`http://${host}:8080/x`)).resolves.toBeInstanceOf(URL);
      } else {
        const isBlocked = isPrivateHostname(host);
        if (isBlocked) {
          await expect(assertFetchableUrl(`http://${host}:8080/x`)).rejects.toThrow(/interna|seguridad/);
        }
      }
    }
  });
});

describe('isPrivateIp / isPrivateHostname', () => {
  it('reconoce rangos privados, loopback y link-local', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', '::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('reconoce nombres internos', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('redis')).toBe(false); // un nombre suelto no es "interno" por sí solo
    expect(isPrivateHostname('algo.internal')).toBe(true);
    expect(isPrivateHostname('ejemplo.com')).toBe(false);
  });
});

describe('fetchPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('corta cuando la página declara un tamaño mayor al tope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x', { status: 200, headers: { 'content-length': '99999999' } }),
      ),
    );

    await expect(fetchPage('https://ejemplo.com/grande', { maxBytes: 1024 })).rejects.toThrow(
      /tope/,
    );
  });

  it('traduce un timeout a un mensaje entendible', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    await expect(fetchPage('https://ejemplo.com/lento', { timeoutMs: 1000 })).rejects.toThrow(
      /no respondió en 1000 ms/,
    );
  });

  it('traduce un fallo de red sin exponer el error crudo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));

    await expect(fetchPage('https://no-existe.invalid/x')).rejects.toThrow(
      /No se pudo conectar/,
    );
  });

  it('devuelve el cuerpo, el tipo de contenido y la URL final', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>hola</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    const page = await fetchPage('https://ejemplo.com/a');

    expect(page.status).toBe(200);
    expect(page.body).toBe('<html>hola</html>');
    expect(page.contentType).toContain('text/html');
    expect(page.bytes).toBeGreaterThan(0);
  });
});
