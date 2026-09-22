-- `ProfileSignal.scoredAt`: cuándo el análisis juzgó esa señal para ese perfil.
--
-- Sin esta marca, la corrida siguiente no sabría qué señales ya se pagaron (el
-- análisis cuesta IA) y volvería a juzgar las mismas. `status` no sirve para eso:
-- ahí vive la relación del USUARIO con la señal (nueva, vista, usada, descartada),
-- que es otra cosa.

ALTER TABLE "ProfileSignal" ADD COLUMN "scoredAt" TIMESTAMP(3);

CREATE INDEX "ProfileSignal_profileId_scoredAt_idx" ON "ProfileSignal"("profileId", "scoredAt");
