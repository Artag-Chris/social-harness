import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_KIND_KEYS,
  CommunityKindSchema,
  communityKindLabel,
  guessCommunityKind,
} from './community.catalog';

/**
 * El catálogo es la frontera de los tipos de comunidad: si esto se rompe, entran claves que
 * ningún conector ni la UI saben mostrar.
 */
describe('catálogo de comunidades', () => {
  it('acepta los tipos conocidos y rechaza los inventados', () => {
    expect(CommunityKindSchema.safeParse('REDDIT').success).toBe(true);
    expect(CommunityKindSchema.safeParse('MYSPACE').success).toBe(false);
  });

  it('traduce las claves a etiquetas legibles, sin inventar las desconocidas', () => {
    expect(communityKindLabel('FACEBOOK_GROUP')).toBe('Grupo de Facebook');
    expect(communityKindLabel('RARO')).toBe('RARO');
  });

  it('deduce el tipo del nombre para el respaldo sin IA', () => {
    expect(guessCommunityKind('r/artificial')).toBe('REDDIT');
    expect(guessCommunityKind('#pymes')).toBe('HASHTAG');
    expect(guessCommunityKind('Grupo de Facebook: pymes LatAm')).toBe('FACEBOOK_GROUP');
    expect(guessCommunityKind('Newsletter de negocios')).toBe('NEWSLETTER');
    expect(guessCommunityKind('mi lista de correo')).toBe('NEWSLETTER');
    expect(guessCommunityKind('Servidor de Discord')).toBe('DISCORD');
    expect(guessCommunityKind('algo sin forma reconocible')).toBe('OTRO');
  });

  it('las claves del schema salen del catálogo', () => {
    expect(COMMUNITY_KIND_KEYS).toContain('OTRO');
    expect(COMMUNITY_KIND_KEYS.length).toBeGreaterThan(5);
  });
});
