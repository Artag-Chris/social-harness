/**
 * Seed idempotente — corre en CADA boot del contenedor, después de
 * `migrate deploy`. Se puede ejecutar las veces que haga falta: todo es upsert
 * por id fijo, así que no duplica nada.
 */
import 'dotenv/config';
import { ObjectiveMetric, Platform, Prisma, PrismaClient, SourceKind } from '@prisma/client';
import { env } from '../src/config/env';
import { DEMO_PROFILE } from './seed/profiles.data';
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
      platform: account.platform as Platform,
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
      notes: objective.notes,
    };
    await prisma.objective.upsert({
      where: { id: objective.id },
      update: data,
      create: { id: objective.id, ...data },
    });
  }

  console.log(
    `[seed] perfil "${DEMO_PROFILE.name}" listo (${DEMO_PROFILE.accounts.length} cuentas, ${DEMO_PROFILE.objectives.length} objetivos)`,
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
