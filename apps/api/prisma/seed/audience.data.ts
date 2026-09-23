/**
 * Segmentos de audiencia del perfil de ejemplo.
 *
 * Van marcados como `manual` a propósito: son "del usuario" (los escribe el seed en su
 * nombre), así la primera propuesta de IA no los archiva y el ejemplo muestra los dos
 * caminos: lo que escribís vos y lo que propone el modelo.
 */

export const DEMO_SEGMENTS = [
  {
    id: 'seed_segment_profesional',
    name: 'Profesional que probó IA y se quedó a medias',
    description:
      'Trabaja en relación de dependencia o como freelance. Usa ChatGPT para cosas sueltas y sospecha que podría hacer mucho más, pero no sabe por dónde empezar. Quiere resultados concretos, no otro curso.',
    pains: [
      'Pierde horas en tareas repetitivas.',
      'Probó herramientas y las abandonó a la semana.',
      'No sabe qué automatizar primero.',
    ],
    desires: [
      'Terminar antes la jornada.',
      'Que la IA le haga lo aburrido.',
      'Mostrarle un resultado concreto a su jefe o cliente.',
    ],
    objections: [
      'Cree que para esto hay que programar.',
      'Desconfía de los cursos que ya compró.',
      'No tiene tiempo para aprender.',
    ],
    channels: [
      'r/artificial',
      'comunidades de no-code',
      '#iaparaemprendedores',
    ],
    languageTips: 'Habla de trabajo y de horas, no de modelos ni de benchmarks.',
    evidence: ['El texto de audiencia del perfil.', 'El nicho declarado (tecnología, IA).'],
  },
  {
    id: 'seed_segment_pyme',
    name: 'Dueño de pyme que hace todo solo',
    description:
      'Negocio de 2 a 10 personas. Hace él mismo las redes, las ventas y la facturación. Compra cuando ve algo concreto que funcione rápido.',
    pains: [
      'No tiene equipo de marketing.',
      'Publica solo cuando le sobra tiempo.',
      'Pierde clientes por no contestar rápido.',
    ],
    desires: ['Que el negocio funcione sin estar encima.', 'Vender más sin contratar.'],
    objections: [
      'No confía en lo que no puede probar antes.',
      'Le da miedo que sea caro o difícil.',
      'Ya probó una agencia y no vio resultados.',
    ],
    channels: ['Grupos de empresarios pymes', '#pymes', 'Newsletters de negocios'],
    languageTips: 'Habla de costos, clientes y tiempo. Cero jerga técnica.',
    evidence: ['El texto de audiencia del perfil.', 'El tono declarado del perfil.'],
  },
] as const;
