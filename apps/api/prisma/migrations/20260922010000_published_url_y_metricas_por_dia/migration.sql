-- `ContentIdea.publishedUrl`: dónde quedó publicado lo que el humano marcó como
-- publicado. Es lo que permite atribuir el rendimiento después (y abrir la pieza).
--
-- `MetricSnapshot`: único por (cuenta, día). Reimportar el mismo CSV, o cargar dos
-- veces los números del mismo día, **actualiza** en vez de duplicar — si no, el
-- reporte de rendimiento contaría el mismo día dos veces.
--
-- Nota sobre el índice HNSW: el SQL que generaba Prisma traía un
-- `DROP INDEX "Signal_embedding_hnsw_idx"`. Se quitó a mano: lo asegura el boot
-- (`prisma/ensure-database.ts`).

ALTER TABLE "ContentIdea" ADD COLUMN "publishedUrl" TEXT;

CREATE UNIQUE INDEX "MetricSnapshot_socialAccountId_capturedAt_key"
  ON "MetricSnapshot"("socialAccountId", "capturedAt");
