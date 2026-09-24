/**
 * Comunidades del perfil de ejemplo.
 *
 * Van una aceptada y verificada (para que la pestaña muestre el estado "listo para usar") y
 * una propuesta sin verificar, que es como nace todo lo que propone la IA: el ejemplo enseña
 * la diferencia sin explicarla.
 */

export const DEMO_TARGETS = [
  {
    id: 'seed_target_reddit',
    kind: 'REDDIT',
    name: 'r/artificial',
    url: 'https://www.reddit.com/r/artificial/',
    size: '1M+ miembros',
    activity: 'alta',
    audienceFit: 75,
    why: 'Ahí se pregunta todos los días qué automatizar primero: es exactamente el dolor del segmento «Profesional que probó IA y se quedó a medias».',
    segmentId: 'seed_segment_profesional',
    status: 'ACCEPTED',
    verified: true,
  },
  {
    id: 'seed_target_pymes',
    kind: 'FACEBOOK_GROUP',
    name: 'Grupos de empresarios pymes',
    url: null,
    size: null,
    activity: 'media',
    audienceFit: 60,
    why: 'Lo declaraste como lugar donde está la audiencia pyme. Falta elegir el grupo concreto: por eso queda sin verificar.',
    segmentId: 'seed_segment_pyme',
    status: 'PROPOSED',
    verified: false,
  },
] as const;
