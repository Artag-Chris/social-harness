-- `Signal.url` pasa a ser opcional: una inspiración pegada como TEXTO no tiene
-- URL y ahí el fingerprint se calcula sobre el texto (sha256('manual:'+texto)).
--
-- Nota sobre el índice HNSW: el SQL que genera Prisma incluye un
-- `DROP INDEX "Signal_embedding_hnsw_idx"` (no puede ver ese índice porque es
-- sobre una columna `Unsupported`). Se quitó a mano: el índice es infraestructura
-- que Prisma no expresa y lo asegura el boot (`prisma/ensure-database.ts`), igual
-- que la extensión `pgvector`.

ALTER TABLE "Signal" ALTER COLUMN "url" DROP NOT NULL;
