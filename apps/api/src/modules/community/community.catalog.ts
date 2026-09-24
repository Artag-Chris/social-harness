import { z } from 'zod';

/**
 * Catálogo de tipos de comunidad.
 *
 * Igual que el catálogo de redes (`modules/platforms`): es la fuente de verdad de las claves
 * y sus etiquetas, y la validación de frontera sale de acá. Sumar un tipo nuevo (¿un foro
 * que aparece mañana?) es una entrada en este objeto: cero migraciones, cero cambios en la UI
 * (que se arma desde `GET /config` o desde la etiqueta que devuelve la API).
 *
 * No es un enum de Postgres a propósito: los lugares donde se junta la gente cambian más
 * rápido que los deploys, y quitar un valor de un enum es imposible sin recrear el tipo.
 */
export const COMMUNITY_KINDS = {
  REDDIT: { label: 'Subreddit', hint: 'Comunidad dentro de Reddit.' },
  FACEBOOK_GROUP: { label: 'Grupo de Facebook', hint: 'Grupo cerrado o abierto.' },
  DISCORD: { label: 'Servidor de Discord', hint: 'Comunidad de chat.' },
  TELEGRAM: { label: 'Grupo de Telegram', hint: 'Canal o grupo de chat.' },
  FORO: { label: 'Foro', hint: 'Foro de nicho (propio o ajeno).' },
  HASHTAG: { label: 'Hashtag', hint: 'Etiqueta que la audiencia sigue.' },
  CANAL: { label: 'Canal o creador', hint: 'Canal de YouTube, newsletter de alguien, podcast.' },
  NEWSLETTER: { label: 'Newsletter', hint: 'Correo periódico de nicho.' },
  OTRO: { label: 'Otro', hint: 'Cualquier otro lugar donde esté la audiencia.' },
} as const;

export const COMMUNITY_KIND_KEYS = Object.keys(COMMUNITY_KINDS) as [CommunityKindKey];

export type CommunityKindKey = keyof typeof COMMUNITY_KINDS;

export const CommunityKindSchema = z.enum(COMMUNITY_KIND_KEYS);

/** Estados posibles de una comunidad propuesta. */
export const COMMUNITY_STATUSES = ['PROPOSED', 'ACCEPTED', 'DISCARDED', 'JOINED'] as const;

export const CommunityStatusSchema = z.enum(COMMUNITY_STATUSES);

export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

export function communityKindLabel(key: string): string {
  return COMMUNITY_KINDS[key as CommunityKindKey]?.label ?? key;
}

export function isCommunityKind(key: string): key is CommunityKindKey {
  return key in COMMUNITY_KINDS;
}

/**
 * Deduce el tipo a partir del nombre, para el respaldo sin IA.
 *
 * Es heurística y se usa solo cuando no hay modelo: los canales que ya declaró la audiencia
 * ("r/artificial", "#pymes") tienen forma reconocible, y adivinar el tipo es mejor que
 * dejarlos todos como "Otro".
 */
export function guessCommunityKind(name: string): CommunityKindKey {
  const value = name.trim().toLowerCase();
  if (value.startsWith('#')) return 'HASHTAG';
  if (value.startsWith('r/') || value.includes('subreddit')) return 'REDDIT';
  if (value.includes('discord')) return 'DISCORD';
  if (value.includes('telegram')) return 'TELEGRAM';
  if (value.includes('newsletter') || value.includes('correo')) return 'NEWSLETTER';
  if (value.includes('grupo') || value.includes('facebook')) return 'FACEBOOK_GROUP';
  if (value.includes('foro')) return 'FORO';
  if (value.includes('canal') || value.includes('podcast') || value.includes('youtube')) return 'CANAL';
  return 'OTRO';
}
