/**
 * Seed idempotente — corre en CADA boot del contenedor, después de
 * `migrate deploy`. Se puede ejecutar las veces que haga falta: todo es upsert
 * por id fijo, así que no duplica nada.
 */
import 'dotenv/config';
import { ObjectiveMetric, Prisma, PrismaClient, SourceKind } from '@prisma/client';
import { env } from '../src/config/env';
import { DEMO_PROFILE } from './seed/profiles.data';
import { DEMO_SEGMENTS } from './seed/audience.data';
import { DEMO_TARGETS } from './seed/community.data';
import { fixtureSources } from './seed/sources.data';

/**
 * Este script usa el MISMO `env` validado que la aplicación (y no `process.env`
 * a mano): así el booleano de `FIXTURE_ENABLED` se parsea con una sola regla y
 * una variable mal escrita falla en el seed en vez de comportarse distinto que
 * en el api.
 */
const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
});

async function seedDemoProfile(): Promise<string> {
  const base = {
    name: DEMO_PROFILE.name,
    niche: [...DEMO_PROFILE.niche],
    audience: DEMO_PROFILE.audience,
    voice: DEMO_PROFILE.voice,
    language: DEMO_PROFILE.language,
    scheduleHours: DEMO_PROFILE.scheduleHours,
    ideasPerWeek: DEMO_PROFILE.ideasPerWeek,
    autoIdeasEnabled: DEMO_PROFILE.autoIdeasEnabled,
  };

  await prisma.profile.upsert({
    where: { id: DEMO_PROFILE.id },
    update: base,
    create: { id: DEMO_PROFILE.id, ...base, nextRunAt: new Date() },
  });

  for (const account of DEMO_PROFILE.accounts) {
    const data = {
      profileId: DEMO_PROFILE.id,
      // Texto validado por el catálogo de redes (no un enum de la base).
      platform: account.platform,
      handle: account.handle,
      url: account.url,
      followersBaseline: account.followersBaseline,
      notes: account.notes,
    };
    await prisma.socialAccount.upsert({
      where: { id: account.id },
      update: data,
      create: { id: account.id, ...data },
    });
  }

  for (const objective of DEMO_PROFILE.objectives) {
    const data = {
      profileId: DEMO_PROFILE.id,
      metric: objective.metric as ObjectiveMetric,
      targetValue: objective.targetValue,
      // El seed es DUEÑO del perfil demo: recalcula la fecha en cada boot a propósito (así
      // el ejemplo siempre tiene un plazo con el que se puede leer el gap de objetivos).
      // Los objetivos de un perfil real no pasan por acá.
      dueDate: new Date(Date.now() + objective.dueDays * 86_400_000),
      notes: objective.notes,
    };
    await prisma.objective.upsert({
      where: { id: objective.id },
      update: data,
      create: { id: objective.id, ...data },
    });
  }

  for (const segment of DEMO_SEGMENTS) {
    const data = {
      profileId: DEMO_PROFILE.id,
      description: segment.description,
      pains: [...segment.pains],
      desires: [...segment.desires],
      objections: [...segment.objections],
      channels: [...segment.channels],
      languageTips: segment.languageTips,
      evidence: [...segment.evidence],
      // `manual`: son "del usuario". Así el ejemplo muestra que una propuesta de IA no
      // pisa lo que ya escribiste.
      source: 'manual',
      archivedAt: null,
    };

    await prisma.audienceSegment.upsert({
      where: { profileId_name: { profileId: DEMO_PROFILE.id, name: segment.name } },
      update: data,
      create: { id: segment.id, name: segment.name, ...data },
    });
  }

  for (const target of DEMO_TARGETS) {
    const data = {
      profileId: DEMO_PROFILE.id,
      kind: target.kind,
      name: target.name,
      url: target.url,
      size: target.size,
      activity: target.activity,
      audienceFit: target.audienceFit,
      why: target.why,
      segmentId: target.segmentId,
      status: target.status,
      source: 'manual',
      verifiedAt: target.verified ? new Date() : null,
    };

    await prisma.communityTarget.upsert({
      where: { profileId_kind_name: { profileId: DEMO_PROFILE.id, kind: target.kind, name: target.name } },
      update: data,
      create: { id: target.id, ...data },
    });
  }

  console.log(
    `[seed] perfil "${DEMO_PROFILE.name}" listo (${DEMO_PROFILE.accounts.length} cuentas, ${DEMO_PROFILE.objectives.length} objetivos, ${DEMO_SEGMENTS.length} segmentos de audiencia, ${DEMO_TARGETS.length} comunidades)`,
  );

  return DEMO_PROFILE.id;
}

async function seedFixtureSources(profileId: string): Promise<void> {
  const baseUrl = env.FIXTURE_BASE_URL;
  const sources = fixtureSources(baseUrl, env.SOURCE_DEFAULT_INTERVAL_HOURS);

  for (const source of sources) {
    const data = {
      name: source.name,
      kind: source.kind as SourceKind,
      // Los params de cada conector son JSON libre: el tipo se valida con Zod en
      // el adaptador (signal-draft.schema.ts), no en la base.
      params: source.params as Prisma.InputJsonValue,
      limits: source.limits as Prisma.InputJsonValue,
      enabled: true,
      intervalHours: source.intervalHours,
    };
    await prisma.source.upsert({
      where: { id: source.id },
      update: data,
      create: { id: source.id, ...data, nextRunAt: new Date() },
    });

    // La fuente se selecciona para el perfil demo (N:M). Si ya estaba, no se toca
    // su `enabled`: si el usuario la apagó a mano, el seed no la vuelve a activar.
    await prisma.profileSource.upsert({
      where: { profileId_sourceId: { profileId, sourceId: source.id } },
      update: {},
      create: { profileId, sourceId: source.id, enabled: true },
    });
  }

  console.log(`[seed] ${sources.length} fuentes del fixture E2E listas (${baseUrl})`);
}

async function main(): Promise<void> {
  const profileId = await seedDemoProfile();

  if (env.FIXTURE_ENABLED) {
    await seedFixtureSources(profileId);
  } else {
    console.log(
      '[seed] FIXTURE_ENABLED=false: no se siembran fuentes E2E (las que piden llave nunca se siembran)',
    );
  }
}

void main()
  .catch((err: unknown) => {
    const detail = err instanceof Error ? err.stack : String(err);
    process.stderr.write(`[seed] FALLO: ${detail}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
