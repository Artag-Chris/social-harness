/**
 * Datos del perfil de ejemplo del seed.
 *
 * Regla del proyecto (heredada de cv-harness): el seed deja la base LISTA para
 * usarse, pero nada esencial depende de él. Un perfil real se crea y se edita
 * desde la pestaña Social del dashboard; esto es solo el punto de partida para
 * que la app no arranque vacía.
 *
 * Ids fijos a propósito: el seed es idempotente (upsert por id) y puede correr
 * en cada boot del contenedor sin duplicar filas.
 */

export const DEMO_PROFILE = {
  id: 'seed_profile_demo',
  name: 'Mi marca personal',
  niche: ['tecnología', 'inteligencia artificial', 'desarrollo de software'],
  audience: 'Profesionales y pequeñas empresas de LatAm que quieren aplicar IA sin humo',
  voice: 'directo, técnico y cercano; frases cortas, sin relleno ni emojis decorativos',
  language: 'es',
  scheduleHours: 24,
  ideasPerWeek: 3,
  autoIdeasEnabled: true,
  accounts: [
    {
      id: 'seed_account_instagram',
      platform: 'INSTAGRAM',
      handle: '@mimarca',
      url: 'https://www.instagram.com/mimarca',
      followersBaseline: 0,
      notes: 'Cuenta principal para reels y carruseles.',
    },
    {
      id: 'seed_account_tiktok',
      platform: 'TIKTOK',
      handle: '@mimarca',
      url: 'https://www.tiktok.com/@mimarca',
      followersBaseline: 0,
      notes: 'Mismo contenido recortado a vertical corto.',
    },
    {
      id: 'seed_account_youtube',
      platform: 'YOUTUBE',
      handle: '@mimarca',
      url: 'https://www.youtube.com/@mimarca',
      followersBaseline: 0,
      notes: 'Formato largo + shorts derivados.',
    },
  ],
  objectives: [
    {
      id: 'seed_objective_posts',
      metric: 'POSTS_PER_WEEK',
      targetValue: 3,
      notes: 'Constancia antes que volumen: 3 piezas por semana.',
    },
    {
      id: 'seed_objective_engagement',
      metric: 'ENGAGEMENT_RATE',
      targetValue: 4,
      notes: 'Interacción objetivo sobre el alcance (en %).',
    },
    {
      id: 'seed_objective_followers',
      metric: 'FOLLOWERS',
      targetValue: 5000,
      notes: 'Suma de las tres cuentas.',
    },
  ],
} as const;
