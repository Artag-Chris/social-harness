# ADR-002 — Métricas de las cuentas: manual ahora, API oficial como base

Estado: **aceptado en su fase 1 (manual). Fases 2-3 propuestas / diferidas — NO implementadas.**

> Esta ADR es la base de diseño para cuando conectemos las APIs oficiales. Hoy el harness mide el
> avance con métricas **cargadas a mano** desde el dashboard, que es suficiente para que el coach
> aconseje y para no bloquear el MVP detrás de un trámite de apps y tokens.

## Contexto

El coach necesita saber **qué funcionó** para ajustar el próximo calendario. Eso exige métricas
reales de las cuentas (alcance, engagement, seguidores), no supuestos.

Lo que se puede y lo que no:

| Plataforma | Vía oficial para métricas propias | Realidad |
| --- | --- | --- |
| Instagram | Instagram Graph API (cuenta profesional) | Requiere app de Meta en revisión, cuenta business/creator vinculada a una página, y tokens de larga duración con refresh. Permisos de insights sujetos a revisión. |
| YouTube | YouTube Analytics API + Data API | La más accesible: OAuth por canal, cuotas generosas, datos ricos. |
| TikTok | TikTok for Developers (Display/Content Posting API) | Requiere app aprobada, alcance limitado y por región; los insights propios son acotados. |

Ninguna se puede activar sin crear apps, aprobar permisos y guardar tokens por cuenta — trámite que
no debe bloquear el resto del sistema.

## Decisión

**Fase 1 (implementada).** `MetricSnapshot` es la fuente de verdad y se carga desde el dashboard:

- `POST /accounts/:id/metrics` acepta un snapshot suelto o un **CSV** (una línea por fecha).
- Se guarda `source: MANUAL` y `raw` con lo que vino, para poder reprocesar.
- `POST /profiles/:id/performance/run` compara los snapshots del período contra las señales que
  estaban en circulación y produce un `PerformanceReport` (qué funcionó, qué no, qué ajustar).
- Sin LLM disponible, el reporte cae a un resumen **determinístico** (no rompe).

**Fases 2-3 (diseñadas, NO implementadas).** El `MetricSnapshot` ya tiene el campo `source` y el
`SocialAccount` ya tiene lo necesario para colgar credenciales:

1. **Contrato único de ingesta.** Un `MetricsConnectorPort` con un adaptador por plataforma
   (`instagram-graph`, `youtube-analytics`, `tiktok-display`) que devuelve **el mismo
   `MetricSnapshot`** — el resto del sistema no se entera de dónde vino el número.
2. **Credenciales fuera de la base.** Como en `atiende`/`cv-harness`: los tokens viven **solo** en
   `.env` (una variable por cuenta) y la columna guarda a lo sumo una referencia por nombre. Nunca
   un token en una tabla ni en un log.
3. **Un solo scheduler.** La recolección de métricas sería **una fuente más** (`kind` dedicado) del
   mismo `schedule-cycle`, con su cadencia en horas, reusando dedup, corridas y notificaciones.
4. **Degradación explícita.** Si la plataforma no entrega un dato, el campo va `null` y el reporte lo
   dice; **nunca** se inventa ni se interpola.

### Migración prevista (aditiva, sin downtime)

```sql
-- 1. Qué cuenta usa qué adaptador y con qué período.
ALTER TABLE "SocialAccount" ADD COLUMN "metricsConnector" TEXT;   -- null = manual
ALTER TABLE "SocialAccount" ADD COLUMN "metricsIntervalHours" INTEGER;
ALTER TABLE "SocialAccount" ADD COLUMN "metricsNextRunAt" TIMESTAMP(3);
CREATE INDEX "SocialAccount_metricsNextRunAt_idx" ON "SocialAccount"("metricsNextRunAt");

-- 2. Trazabilidad del origen (ya existe el enum MetricSource: MANUAL | API).
ALTER TABLE "MetricSnapshot" ADD COLUMN "connector" TEXT;         -- youtube-analytics | ...
ALTER TABLE "MetricSnapshot" ADD COLUMN "externalId" TEXT;        -- id del dato en la plataforma
CREATE UNIQUE INDEX "MetricSnapshot_dedupe_idx"
  ON "MetricSnapshot"("socialAccountId", "connector", "externalId");
```

`externalId` + índice único dan la **idempotencia** que hoy da el fingerprint en las señales: si la
API devuelve el mismo día dos veces, no se duplica el snapshot.

## Decisiones abiertas (requieren OK el día que se implemente)

1. **¿Qué se mide primero?** Recomendado empezar por **YouTube Analytics** (más simple), y dejar
   Instagram para cuando exista la app de Meta aprobada.
2. **¿OAuth por cuenta o token pegado a mano en `.env`?** Un token pegado dura poco y hay que
   refrescarlo a mano; OAuth implica guardar refresh tokens (cifrados, patrón AES-256-GCM de
   `atiende`). Recomendado: empezar con token en `.env` por cuenta y pasar a OAuth si se vuelve
   una molestia.
3. **¿La recolección de métricas corre sola?** Recomendado que sí (es barata y no usa IA), con
   cadencia en horas, y que el **reporte** siga siendo a demanda.

## Consecuencias

- Hoy el avance depende de que el usuario cargue los números; el sistema lo deja fácil (CSV + una
  sola acción) y guarda todo el histórico, así que migrar a API no pierde datos.
- El contrato (`MetricSnapshot` + `source`) ya está listo: implementar un adaptador **no toca** el
  reporte ni el pipeline de ideas.
- Riesgo asumido y explícito: sin API, el reporte tiene el sesgo de lo que el usuario se acuerde de
  cargar; por eso el MVP no depende de él para sugerir contenido (las tendencias vienen de las
  fuentes, no de las métricas).
