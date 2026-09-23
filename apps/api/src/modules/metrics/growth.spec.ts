import { describe, expect, it } from 'vitest';
import type { ObjectiveMetric } from '@prisma/client';
import {
  buildGrowth,
  formatGrowthForPrompt,
  formatGrowthForTemplate,
  type GrowthAccount,
  type GrowthObjective,
  type GrowthSnapshot,
} from './growth';

/**
 * Lo que se prueba acá son las dos reglas que hacen confiable al gap de objetivos:
 *
 *  1. Los números salen del histórico, no de una estimación: 1000 → 1150 en 20 días es
 *     +52,5 por semana, y eso es lo que tiene que decir.
 *  2. Cuando los datos no alcanzan, lo dice (`NO_PACE`): no inventa un ritmo con una
 *     sola medición ni un veredicto sin plazo.
 */

const NOW = new Date('2026-09-21T12:00:00Z');
const IN_45_DAYS = new Date('2026-11-05T12:00:00Z');

const ACCOUNT: GrowthAccount = { id: 'a-1', platform: 'LINKEDIN', handle: '@marca' };

/** Dos mediciones a 20 días: +150 seguidores, +12 000 de alcance, engagement 3 → 4. */
function twoSnapshots(): GrowthSnapshot[] {
  return [
    {
      socialAccountId: 'a-1',
      capturedAt: new Date('2026-09-01T00:00:00Z'),
      followers: 1000,
      reach: 40_000,
      engagementRate: 3,
    },
    {
      socialAccountId: 'a-1',
      capturedAt: new Date('2026-09-21T00:00:00Z'),
      followers: 1150,
      reach: 52_000,
      engagementRate: 4,
    },
  ];
}

function objective(
  metric: ObjectiveMetric,
  targetValue: number,
  extra: { currentValue?: number | null; dueDate?: Date | null } = {},
): GrowthObjective {
  return {
    metric,
    targetValue,
    currentValue: extra.currentValue ?? null,
    dueDate: extra.dueDate === undefined ? IN_45_DAYS : extra.dueDate,
  };
}

function build(options: {
  accounts?: GrowthAccount[];
  objectives?: GrowthObjective[];
  snapshots?: GrowthSnapshot[];
  measuredByCode?: Partial<Record<ObjectiveMetric, number>>;
}) {
  return buildGrowth({
    accounts: options.accounts ?? [ACCOUNT],
    objectives: options.objectives ?? [],
    snapshots: options.snapshots ?? [],
    now: NOW,
    ...(options.measuredByCode ? { measuredByCode: options.measuredByCode } : {}),
  });
}

describe('growth: los números por cuenta', () => {
  it('calcula el ritmo semanal de seguidores y el alcance acumulado', () => {
    const growth = build({ snapshots: twoSnapshots() });

    expect(growth.windowDays).toBe(20);
    expect(growth.accounts[0]).toMatchObject({
      platform: 'LINKEDIN',
      daysMeasured: 2,
      followers: { from: 1000, to: 1150, delta: 150, perWeek: 52.5 },
      reach: 92_000,
      engagementRate: 3.5,
    });
  });

  it('sin métricas cargadas no hay cuentas y lo dice', () => {
    const growth = build({ snapshots: [] });

    expect(growth.accounts).toEqual([]);
    expect(growth.measured).toEqual({ accounts: 0, snapshots: 0 });
    expect(formatGrowthForPrompt(growth)[0]).toContain('no hay métricas cargadas');
  });
});

describe('growth: el gap de objetivos', () => {
  it('atrasado: proyecta al ritmo actual y dice que NO llega', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('FOLLOWERS', 5000)],
    });

    expect(growth.objectives[0]).toMatchObject({
      unit: 'COUNT',
      current: 1150,
      remaining: 3850,
      daysLeft: 45,
      neededPerWeek: 598.89,
      currentPerWeek: 52.5,
      projected: 1487.5,
      verdict: 'BEHIND',
    });
  });

  it('a paso: mismo cálculo, veredicto ON_TRACK', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('ENGAGEMENT_RATE', 5)],
    });

    // Ojo: en una tasa, "hoy" es la ÚLTIMA medición (4 %), no el promedio del período (3,5 %):
    // el objetivo se compara contra dónde estás hoy, no contra lo que promediaste.
    expect(growth.objectives[0]).toMatchObject({
      unit: 'PERCENT',
      current: 4,
      remaining: 1,
      neededPerWeek: 0.16,
      currentPerWeek: 0.35,
      projected: 6.25,
      verdict: 'ON_TRACK',
    });
  });

  it('el alcance se proyecta como flujo semanal, no como stock', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('REACH', 300_000)],
    });

    // 92 000 acumulados en 20 días = 32 200 por semana → en 45 días llega a 299 000.
    expect(growth.objectives[0]).toMatchObject({
      current: 92_000,
      currentPerWeek: 32_200,
      projected: 299_000,
      verdict: 'BEHIND',
    });
  });

  it('una TASA no se acumula: publicar 1,5 de 3 por semana está atrasado', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('POSTS_PER_WEEK', 3)],
      measuredByCode: { POSTS_PER_WEEK: 1.5 },
    });

    expect(growth.objectives[0]).toMatchObject({
      unit: 'PER_WEEK',
      current: 1.5,
      currentPerWeek: 1.5,
      // Se mantiene en 1,5 por semana (acumularlo daría 11 y un falso "llegás").
      projected: 1.5,
      verdict: 'BEHIND',
    });
  });

  it('con UNA sola medición no hay ritmo: NO_PACE en vez de inventar', () => {
    const growth = build({
      snapshots: [
        { socialAccountId: 'a-1', capturedAt: new Date('2026-09-21T00:00:00Z'), followers: 1000 },
      ],
      objectives: [objective('FOLLOWERS', 5000)],
    });

    expect(growth.objectives[0]).toMatchObject({
      current: 1000,
      remaining: 4000,
      currentPerWeek: null,
      projected: null,
      verdict: 'NO_PACE',
    });
  });

  it('sin plazo no se puede estar atrasado: NO_PACE aunque haya ritmo', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('FOLLOWERS', 5000, { dueDate: null })],
    });

    expect(growth.objectives[0]).toMatchObject({
      daysLeft: null,
      neededPerWeek: null,
      currentPerWeek: 52.5,
      verdict: 'NO_PACE',
    });
  });

  it('ya cumplido: ACHIEVED y no queda nada pendiente', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('FOLLOWERS', 1000)],
    });

    expect(growth.objectives[0]).toMatchObject({ remaining: 0, verdict: 'ACHIEVED' });
  });

  it('el valor cargado a mano manda sobre el derivado', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('FOLLOWERS', 5000, { currentValue: 9000 })],
    });

    expect(growth.objectives[0]).toMatchObject({ current: 9000, verdict: 'ACHIEVED' });
  });

  it('sin forma de saber el valor actual: NO_CURRENT (no lo adivina)', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('LEADS', 10)],
    });

    expect(growth.objectives[0]).toMatchObject({
      current: null,
      remaining: null,
      verdict: 'NO_CURRENT',
    });
  });

  it('suma el ritmo de las cuentas, pero solo el de las que tienen dos mediciones', () => {
    const accounts: GrowthAccount[] = [
      ACCOUNT,
      { id: 'a-2', platform: 'INSTAGRAM', handle: '@marca' },
    ];

    const growth = build({
      accounts,
      snapshots: [
        ...twoSnapshots(),
        { socialAccountId: 'a-2', capturedAt: new Date('2026-09-01T00:00:00Z'), followers: 500 },
        { socialAccountId: 'a-2', capturedAt: new Date('2026-09-21T00:00:00Z'), followers: 560 },
      ],
      objectives: [objective('FOLLOWERS', 5000)],
    });

    // 52,5 (LinkedIn) + 21 (Instagram) y el total de hoy es la suma de las dos.
    expect(growth.objectives[0]).toMatchObject({ current: 1710, currentPerWeek: 73.5 });

    const conUnaSola = build({
      accounts,
      snapshots: [
        ...twoSnapshots(),
        { socialAccountId: 'a-2', capturedAt: new Date('2026-09-21T00:00:00Z'), followers: 560 },
      ],
      objectives: [objective('FOLLOWERS', 5000)],
    });

    expect(conUnaSola.objectives[0]?.currentPerWeek).toBe(52.5);
  });
});

describe('growth: las líneas que reciben los prompts', () => {
  it('llevan los números y el veredicto en palabras (sin que el modelo recalcule)', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('FOLLOWERS', 5000)],
    });

    const lines = formatGrowthForPrompt(growth).join('\n');

    expect(lines).toContain('seguidores: 1000 → 1150');
    expect(lines).toContain('+52.5/semana');
    expect(lines).toContain('faltan 3850 en 45 día(s)');
    expect(lines).toContain('hace falta +598.89/semana');
    expect(lines).toContain('NO llegás');
  });

  it('marca cuando todavía no se puede saber', () => {
    const growth = build({
      snapshots: [
        { socialAccountId: 'a-1', capturedAt: new Date('2026-09-21T00:00:00Z'), followers: 1000 },
      ],
      objectives: [objective('FOLLOWERS', 5000)],
    });

    expect(formatGrowthForPrompt(growth).join('\n')).toContain('no alcanza para saber si llegás');
  });

  it('la plantilla sin IA solo menciona los objetivos atrasados', () => {
    const growth = build({
      snapshots: twoSnapshots(),
      objectives: [objective('FOLLOWERS', 5000), objective('ENGAGEMENT_RATE', 4)],
    });

    const template = formatGrowthForTemplate(growth).join('\n');

    expect(template).toContain('FOLLOWERS');
    expect(template).not.toContain('ENGAGEMENT_RATE');
  });
});
