-- `Signal.summary`: el texto corto que trae la fuente (o el que se pega a mano).
-- Sin esto, una señal era solo un título, y el análisis no tenía ni con qué juzgar
-- relevancia ni qué embeber.
--
-- Nota sobre el índice HNSW: el SQL que generaba Prisma traía un
-- `DROP INDEX "Signal_embedding_hnsw_idx"` (no puede ver ese índice porque es
-- sobre una columna que marcó como `Unsupported`). Se quitó a mano: el índice lo
-- asegura el boot (`prisma/ensure-database.ts`), así que las migraciones no lo
-- pueden romper.

-- AlterTable
ALTER TABLE "Signal" ADD COLUMN "summary" TEXT;
