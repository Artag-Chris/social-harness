import { lookup } from 'node:dns/promises';
import { env } from '../../../config/env';

/**
 * Obtención de una página para VERIFICAR una fuente (no para recolectar: eso es
 * la fase 2, con su propio adaptador y su política de cortesía).
 *
 * Tres protecciones que importan:
 *  - solo `http(s)`;
 *  - **anti-SSRF**: no se consultan direcciones internas. Se chequea el nombre Y
 *    la IP resuelta (si no, un dominio que apunta a `127.0.0.1` pasaría el
 *    filtro por nombre);
 *  - **tope de tamaño**: se lee por streaming y se corta al pasar el límite, así
 *    una URL que devuelve gigas no tumba el proceso.
 *
 * La única excepción a lo de direcciones internas es el fixture E2E (dev), que
 * vive dentro de la red de Docker: se habilita con `FIXTURE_ENABLED=true`, que en
 * el server queda en `false`.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = 'social-harness/0.1 (verificación de fuentes)';

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface FetchPageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

export interface FetchedPage {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  bytes: number;
}

export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const parsed = await assertFetchableUrl(url);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed, {
      redirect: 'follow',
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
        ...options.headers,
      },
      signal: controller.signal,
    });

    const { body, bytes } = await readWithLimit(response, maxBytes);

    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
      finalUrl: response.url || parsed.toString(),
      bytes,
    };
  } catch (error) {
    if (error instanceof FetchError) throw error;
    if (isAbortError(error)) {
      throw new FetchError(`La página no respondió en ${timeoutMs} ms.`);
    }
    throw new FetchError(
      `No se pudo conectar: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Valida el esquema y que no sea una dirección interna. */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FetchError(`"${raw}" no es una URL válida.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchError('Solo se permiten URLs http(s).');
  }

  if (env.FIXTURE_ENABLED) return parsed; // dev: el fixture vive en la red interna

  if (isPrivateHostname(parsed.hostname)) {
    throw new FetchError(
      `"${parsed.hostname}" es una dirección interna y no se consulta por seguridad.`,
    );
  }

  const resolved = await resolveAddress(parsed.hostname);
  if (resolved && isPrivateIp(resolved)) {
    throw new FetchError(
      `"${parsed.hostname}" resuelve a una IP interna (${resolved}): no se consulta por seguridad.`,
    );
  }

  return parsed;
}

/** Nombres que nunca deben consultarse (antes de resolver DNS). */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.internal') || host.endsWith('.local')) return true;
  return isPrivateIp(host);
}

/** IPv4 privadas/loopback/link-local y IPv6 loopback. */
export function isPrivateIp(address: string): boolean {
  if (address === '::1' || address === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(address)) return true; // IPv6 unique-local
  if (/^fe80:/i.test(address)) return true; // IPv6 link-local
  if (/^127\./.test(address)) return true;
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  if (/^169\.254\./.test(address)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true;
  if (/^0\./.test(address)) return true;
  return false;
}

async function resolveAddress(hostname: string): Promise<string | null> {
  try {
    const result = await lookup(hostname);
    return result.address;
  } catch {
    // Si no resuelve, el fetch va a fallar con un mensaje claro; no se bloquea acá.
    return null;
  }
}

/** Lee el cuerpo cortando al pasar el límite (no confía en `content-length`). */
async function readWithLimit(response: Response, maxBytes: number): Promise<{ body: string; bytes: number }> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new FetchError(
      `La página declara ${Math.round(declared / 1024)} KB y el tope es ${Math.round(maxBytes / 1024)} KB.`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) return { body: '', bytes: 0 };

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new FetchError(`La página supera el tope de ${Math.round(maxBytes / 1024)} KB.`);
    }
    chunks.push(value);
  }

  return { body: Buffer.concat(chunks).toString('utf8'), bytes };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
