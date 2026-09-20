# Flujo de eventos — social-harness

Todo el pipeline es **BullMQ** (mismo proceso Nest; sin Redis Streams porque no hay segunda lengua).
Las llaves se aíslan con `QUEUE_PREFIX=socialharness` sobre la Redis compartida.

```
[t=0] BullMQ repeatable "schedule-cycle" (cada CRON_INTERVAL_MINUTES)
  └ DispatchService.runCycle()
       lee Sources enabled con nextRunAt ≤ now
       └ por fuente:
            CollectionRun(RUNNING, requestId)
            job `collect`  { requestId, sourceId }
            Source.lastRunAt = now · nextRunAt = now + (intervalHours ?? perfil)

[t=1] CollectWorker (cola collect)
       connector = factory(source.kind)        // YOUTUBE_API | GOOGLE_TRENDS | RSS | PUBLIC_WEB
       items = connector.fetch(source.params, source.limits)
       valida con Zod (SignalItemSchema)        // un item inválido no tumba la corrida
       → publishes IngestService.ingest(requestId, items)

[t=2] IngestService (sincrónico dentro del collect, idempotente)
       por item:
         fingerprint = sha256(canonicalizeUrl(url) ?? 'manual:'+texto)
         ¿existe? → skip (y se cuentan como ya vistas)
         ¿nuevo?  → Signal(RAW) + embedding (OpenAI o mock)
         dupKey = buildDupKey(title, author) → si ya existe, se marca duplicateOfId
                                                (no se analiza ni se muestra por defecto)
       fan-out N:M: por cada perfil con ProfileSource habilitada de esa fuente
                    → ProfileSignal(NEW) + job `analyze`
       CollectionRun OK (itemsFound / itemsNew)

[t=3] AnalyzeWorker (cola analyze) — el paso que CUESTA, así que va por lotes
       por (perfil, lote de señales):
         1) prefilter determinístico (gratis): keywords del nicho, plataforma,
            antigüedad, métricas, similitud por embedding → ordena y corta a ANALYZE_BATCH_SIZE
         2) UNA llamada LLM batched → relevanceScore + reasons por señal
         score ≥ RELEVANCE_MIN_SCORE
            → Signal(ANALYZED) + ProfileSignal(relevanceScore, reasons) + job `ideas`

[t=4] IdeasWorker (cola ideas) — gate: AUTO_IDEAS_ENABLED
       por perfil: UNA llamada LLM batched sobre sus señales relevantes
         → ContentIdea[] (title, hook, angle, whyNow, format, hashtags, bestTimes)
         → status IDEA, scheduledFor sugerido (hueco del calendario)
         → job `notification`

[t=5] NotificationWorker (cola notification)
       NotificationPort.notify(event) → adaptador `dashboard` = fila en Notification
       El dashboard la lee por polling (no hay push en v1)

── A DEMANDA (NO están en el pipeline) ──────────────────────────────────────────────
[draft]        POST /ideas/:id/draft        → job `draft`  → ContentDraft (caption/guion)
[performance]  POST /profiles/:id/performance/run → job `performance` → PerformanceReport
[run manual]   POST /profiles/:id/run       → dispara `collect` de SUS fuentes (sin esperar cron)
[manual]       POST /signals/from-text · /from-url → mismo camino que [t=2], kind=INSPIRATION

── Puntos de falla y cómo se recuperan ──────────────────────────────────────────────
| Falla                                   | Recuperación                                                        |
|-----------------------------------------|---------------------------------------------------------------------|
| Conector caído / 403 / challenge         | La corrida queda FAILED con el motivo (diagnoseBlock) + notificación; las demás fuentes siguen |
| Ciclo sin llaves (LLM/embeddings)        | `mock` determinístico: el pipeline corre E2E sin red                 |
| Job de IA falla                          | Reintento del job con backoff exponencial (attempts 4)               |
| Proceso muere con jobs en vuelo          | BullMQ deja el job `waiting`/`active` y otro worker lo retoma        |
| Misma señal en dos fuentes               | `dupKey` + `duplicateOfId`: se marca y se oculta, nunca se borra     |
| Reingesta de la misma URL                | `fingerprint` único: se ignora                                      |
| Doble click en "Generar borrador"        | `jobId` determinístico + `version` del draft                         |

── Invariante de producto ───────────────────────────────────────────────────────────
Ningún camino del pipeline publica, ni genera borradores, ni gasta IA sin que el humano lo pida
(ver docs/adr-003). El gasto se mide en `CoachRun` y se expone en `GET /usage`.
```
