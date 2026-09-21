import { describe, expect, it } from 'vitest';
import {
  FORMAT_KEYS,
  FORMATS,
  PLATFORMS,
  PLATFORM_KEYS,
  formatBelongsToPlatform,
  formatLabel,
  formatsFor,
  isFormatKey,
  isPlatformKey,
  platformLabel,
  platformsCatalog,
} from './platforms.catalog';
import { PlatformFormatSchema, PlatformKeySchema } from './platforms.schema';

/**
 * Estos tests fijan la propiedad que pidió el usuario: **agregar o quitar una red
 * no tiene que ser duro**. Por eso se comprueba la consistencia del catálogo
 * (que no se pueda olvidar una mitad) y la validación por red.
 */
describe('consistencia del catálogo', () => {
  it('cada clave de red tiene su definición (no se puede olvidar una mitad)', () => {
    expect(Object.keys(PLATFORMS).sort()).toEqual([...PLATFORM_KEYS].sort());
  });

  it('cada clave de formato tiene su definición', () => {
    expect(Object.keys(FORMATS).sort()).toEqual([...FORMAT_KEYS].sort());
  });

  it('cada red declara solo formatos que existen', () => {
    for (const key of PLATFORM_KEYS) {
      for (const formatKey of PLATFORMS[key].formats) {
        expect(isFormatKey(formatKey), `${key} declara "${formatKey}", que no existe`).toBe(true);
      }
    }
  });

  it('los formatos por defecto son un subconjunto de los permitidos y no está vacío', () => {
    for (const key of PLATFORM_KEYS) {
      const definition = PLATFORMS[key];
      expect(definition.defaultFormats.length).toBeGreaterThan(0);
      for (const formatKey of definition.defaultFormats) {
        expect(definition.formats).toContain(formatKey);
      }
    }
  });

  it('ninguna red declara formatos repetidos ni queda sin formatos', () => {
    for (const key of PLATFORM_KEYS) {
      const formats = PLATFORMS[key].formats;
      expect(formats.length).toBeGreaterThan(0);
      expect(new Set(formats).size).toBe(formats.length);
    }
  });

  it('la clave interna de cada definición coincide con su lugar en el catálogo', () => {
    for (const key of PLATFORM_KEYS) {
      expect(PLATFORMS[key].key).toBe(key);
    }
  });
});

describe('LinkedIn (la red nueva)', () => {
  it('existe y ofrece sus formatos propios', () => {
    expect(isPlatformKey('LINKEDIN')).toBe(true);
    expect(formatsFor('LINKEDIN')).toEqual(['POST', 'CAROUSEL', 'VIDEO', 'ARTICLE', 'POLL']);
    expect(platformLabel('LINKEDIN')).toBe('LinkedIn');
  });

  it('no permite automatizar el scraping y sus tendencias son manuales', () => {
    // Decisión explícita del ADR-001: LinkedIn prohíbe el scraping por sus ToS.
    expect(PLATFORMS.LINKEDIN.scrapingAllowed).toBe(false);
    expect(PLATFORMS.LINKEDIN.trendsStrategy).toBe('manual');
  });

  it('no tiene API de métricas para perfiles personales (solo páginas)', () => {
    expect(PLATFORMS.LINKEDIN.officialMetricsApi).toMatch(/perfiles personales/i);
  });

  it('trae la guía que usan los prompts (horarios y hashtags)', () => {
    expect(PLATFORMS.LINKEDIN.contentHint.length).toBeGreaterThan(20);
    expect(PLATFORMS.LINKEDIN.bestTimesHint.length).toBeGreaterThan(10);
    expect(PLATFORMS.LINKEDIN.hashtagsHint.length).toBeGreaterThan(5);
  });
});

describe('validación por red', () => {
  it('un formato que no existe en la red se rechaza, y el mensaje dice cuáles sirven', () => {
    const result = PlatformFormatSchema.safeParse({ platform: 'INSTAGRAM', format: 'POLL' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('REEL');
    }
  });

  it('acepta las combinaciones válidas de cada red', () => {
    expect(PlatformFormatSchema.safeParse({ platform: 'LINKEDIN', format: 'ARTICLE' }).success).toBe(true);
    expect(PlatformFormatSchema.safeParse({ platform: 'INSTAGRAM', format: 'REEL' }).success).toBe(true);
    expect(PlatformFormatSchema.safeParse({ platform: 'TIKTOK', format: 'SHORT' }).success).toBe(true);
    expect(PlatformFormatSchema.safeParse({ platform: 'YOUTUBE', format: 'LIVE' }).success).toBe(true);
  });

  it('rechaza una red que no existe (con el nombre, no con un error genérico)', () => {
    expect(PlatformKeySchema.safeParse('MYSPACE').success).toBe(false);
    expect(PlatformKeySchema.safeParse('LINKEDIN').success).toBe(true);
  });

  it('formatBelongsToPlatform responde por red', () => {
    expect(formatBelongsToPlatform('LINKEDIN', 'POLL')).toBe(true);
    expect(formatBelongsToPlatform('INSTAGRAM', 'POLL')).toBe(false);
    expect(formatBelongsToPlatform('YOUTUBE', 'ARTICLE')).toBe(false);
  });
});

describe('helpers de etiqueta', () => {
  it('traduce claves a texto legible y deja pasar lo desconocido sin romper', () => {
    expect(formatLabel('REEL')).toBe('Reel');
    expect(platformLabel('TIKTOK')).toBe('TikTok');
    expect(formatLabel('OTRO' as never)).toBe('OTRO');
    expect(platformLabel('OTRA')).toBe('OTRA');
  });
});

describe('catálogo para la UI', () => {
  it('expone los formatos de cada red con su detalle (el front no hardcodea nada)', () => {
    const catalog = platformsCatalog();

    expect(catalog).toHaveLength(PLATFORM_KEYS.length);

    const linkedin = catalog.find((entry) => entry.key === 'LINKEDIN');
    expect(linkedin?.formatDetails.map((detail) => detail.key)).toEqual([
      'POST',
      'CAROUSEL',
      'VIDEO',
      'ARTICLE',
      'POLL',
    ]);
    expect(linkedin?.formatDetails[0]?.label).toBe('Post');
    expect(linkedin?.formatDetails[0]?.isVideo).toBe(false);
  });

  it('cada red del catálogo trae todo lo que la UI necesita para pintarse', () => {
    for (const entry of platformsCatalog()) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.formatDetails.length).toBeGreaterThan(0);
      expect(['api', 'public-web', 'manual']).toContain(entry.trendsStrategy);
    }
  });
});
