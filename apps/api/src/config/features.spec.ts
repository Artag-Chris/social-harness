import { describe, expect, it } from 'vitest';
import { SourceKind } from '@prisma/client';
import { env } from './env';
import { ALL_SOURCE_KINDS, buildFeatures, enabledConnectors, resolveConnectors } from './features';

describe('resolveConnectors', () => {
  it('devuelve un mapa COMPLETO construido desde el enum (un kind nuevo queda cubierto)', () => {
    const connectors = resolveConnectors([]);
    expect(Object.keys(connectors).sort()).toEqual([...ALL_SOURCE_KINDS].sort());
    expect(Object.values(connectors).every((enabled) => enabled === false)).toBe(true);
  });

  it('marca solo los habilitados', () => {
    const connectors = resolveConnectors(['RSS', 'MANUAL']);
    expect(connectors.RSS).toBe(true);
    expect(connectors.MANUAL).toBe(true);
    expect(connectors.YOUTUBE_API).toBe(false);
  });

  it('falla con un valor desconocido en vez de apagar el conector en silencio', () => {
    // Un typo ("RRS") dejaría RSS apagado y nadie lo notaría hasta ver que
    // faltan señales: mejor que el boot no arranque.
    expect(() => resolveConnectors(['RRS'])).toThrow(/desconocidos: RRS/);
  });

  it('el mensaje de error lista los valores válidos', () => {
    expect(() => resolveConnectors(['NOPE'])).toThrow(/GOOGLE_TRENDS/);
  });
});

describe('buildFeatures', () => {
  it('los conectores salen del feature flag, NO de si hay llave', () => {
    // Este es el punto: tener la llave de YouTube y querer apagar el conector
    // son cosas distintas.
    const features = buildFeatures({
      ...env,
      YOUTUBE_API_KEY: 'llave-presente',
      connectorKinds: ['RSS'],
    });
    expect(features.connectors.YOUTUBE_API).toBe(false);
    expect(features.connectors.RSS).toBe(true);
  });

  it('enabledConnectors devuelve solo los activos', () => {
    const features = buildFeatures({ ...env, connectorKinds: ['RSS', 'PUBLIC_WEB'] });
    expect(enabledConnectors(features).sort()).toEqual([SourceKind.PUBLIC_WEB, SourceKind.RSS].sort());
  });

  it('expone los defaults de fuentes que usan los conectores', () => {
    const features = buildFeatures({ ...env, TRENDS_REGION: 'MX', RESPECT_ROBOTS: false });
    expect(features.sources.region).toBe('MX');
    expect(features.sources.respectRobots).toBe(false);
  });

  it('propaga los frenos de costo e IA', () => {
    const features = buildFeatures({
      ...env,
      AUTO_IDEAS_ENABLED: false,
      IDEAS_PER_WEEK: 7,
      RELEVANCE_MIN_SCORE: 80,
      ANALYZE_BATCH_SIZE: 5,
    });
    expect(features.ideas).toEqual({
      auto: false,
      perWeek: 7,
      relevanceMinScore: 80,
      analyzeBatchSize: 5,
    });
  });
});

describe('configuración por defecto del proyecto', () => {
  it('los 5 conectores vienen habilitados por defecto', () => {
    expect(enabledConnectors(buildFeatures(env))).toHaveLength(ALL_SOURCE_KINDS.length);
  });
});
