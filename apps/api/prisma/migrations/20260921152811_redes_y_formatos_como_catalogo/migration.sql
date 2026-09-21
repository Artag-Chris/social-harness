-- Redes y formatos: de enum a texto validado por el catálogo (`modules/platforms`).
--
-- ⚠️ Por qué va escrito a mano: el SQL que genera Prisma para este cambio
--    DROPEA y RECREA las columnas ("No cast exists... would lead to data loss").
--    Con eso se perderían las cuentas y las ideas ya guardadas (y de paso el
--    índice HNSW de `Signal.embedding`). Acá se convierte con un CAST explícito
--    (enum → text), que conserva los valores y la restricción NOT NULL.
--
-- Los valores guardados ya son los del catálogo en MAYÚSCULAS (INSTAGRAM,
-- TIKTOK, YOUTUBE), así que ninguna fila se reescribe: el cambio es lo que
-- habilita LINKEDIN sin una migración futura por cada red nueva.
--
-- Los índices que incluyen estas columnas los reconstruye Postgres solo
-- (`Signal_platform_publishedAt_idx` y el unique `(profileId, platform, handle)`),
-- así que no hay que recrearlos.

ALTER TABLE "SocialAccount" ALTER COLUMN "platform" SET DATA TYPE TEXT USING "platform"::text;
ALTER TABLE "Signal"        ALTER COLUMN "platform" SET DATA TYPE TEXT USING "platform"::text;
ALTER TABLE "ContentIdea"   ALTER COLUMN "platform" SET DATA TYPE TEXT USING "platform"::text;
ALTER TABLE "ContentIdea"   ALTER COLUMN "format"   SET DATA TYPE TEXT USING "format"::text;

DROP TYPE IF EXISTS "IdeaFormat";
DROP TYPE IF EXISTS "Platform";
