-- `ContentIdea.source`: distingue una idea redactada por el modelo (`ia`) de una
-- armada por el respaldo determinístico (`plantilla`). Sin esto, la UI no podría
-- evitar hacer pasar una plantilla por una sugerencia de la IA.
--
-- Nota sobre el índice HNSW: el SQL que generaba Prisma traía un
-- `DROP INDEX "Signal_embedding_hnsw_idx"` (no puede ver ese índice porque es sobre
-- una columna que marcó como `Unsupported`). Se quitó a mano: lo asegura el boot
-- (`prisma/ensure-database.ts`), así que las migraciones no lo pueden romper.

-- AlterTable
ALTER TABLE "ContentIdea" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ia';
