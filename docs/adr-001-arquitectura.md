# ADR-001 — Arquitectura del Social Harness (coach de redes sociales)

Estado: aceptado (2026-09-20)

## Contexto

Necesitábamos un harness que ayude a **crecer perfiles en redes sociales** (Instagram, TikTok,
YouTube): que recolecte **señales de tendencia**, las evalúe contra los objetivos de cada perfil y
devuelva **sugerencias** (ideas, calendario, formato/timing/hashtags y borradores a demanda).

Restricciones y experiencia previa:
- Ya existen dos harness hermanos **en producción**: `atiende` (NestJS hexagonal, router LLM con
  circuit breaker, feature flags, multitenant) y `cv-harness` (NestJS + worker Rust por Redis
  Streams + Prisma/pgvector + perfil N:M con catálogo de fuentes + cron por perfil).
- El usuario despliega a mano en un server privado: infra compartida (Redis `redis:6379`, Postgres
  `atiende-postgres` con pgvector, red `microservices-network`), `docker compose up -d`, migraciones
  y seed automáticos en el boot, y `.env.example` sincronizado 1:1 con lo real.
- El front es el `dashboard/` de atiende (pestaña nueva), con **una sola sesión** (JWT de atiende).
- **La IA nunca publica**: todo es sugerencia; el humano copia/exporta y marca "ya publiqué".
- Las APIs públicas de tendencias de Instagram/TikTok no existen; el scraping logueado está
  prohibido por sus ToS y bloqueado técnicamente (anti-bot).

## Decisiones

1. **Orquestador NestJS 11** (`apps/api`) con el patrón de puertos/adaptadores de `atiende`:
   puerto por capacidad, un adaptador por proveedor, selector por `.env` (`auto` con fallbacks) y
   `mock` obligatorio para poder correr el pipeline E2E sin llaves ni red.

2. **Sin worker Rust y sin Redis Streams.** Los Streams de `cv-harness` existen para la frontera
   Nest↔Rust; acá no hay segunda lengua, así que todo el pipeline es **BullMQ**. Se documenta que
   un conector externo futuro (otra lengua, otro proceso) puede entrar por Streams sin tocar el
   pipeline — la ingestión ya está escrita para aceptar un `payload` JSON validado con Zod.

3. **Capa de conectores propia** (`modules/connectors/`) como corazón del sistema. Un puerto
   (`TrendConnectorPort`) y un adaptador por `kind` de fuente:

   | `kind` | Fuente | Credencial |
   | --- | --- | --- |
   | `YOUTUBE_API` | YouTube Data API v3 (search, stats, tendencias por región) | `YOUTUBE_API_KEY` (gratis) |
   | `GOOGLE_TRENDS` | endpoints públicos de Trends (interés y consultas relacionadas) | ninguna |
   | `RSS` | RSS/Atom genérico (incluye Google News por keyword) | ninguna |
   | `PUBLIC_WEB` | receta de selectores CSS sobre páginas públicas de tendencias | ninguna |
   | `MANUAL` | intake por texto/URL (inspiración y competencia) | ninguna |

   Sumar una fuente = **registrar un adaptador** + configurar una fila `Source`. No se integra cada
   portal con código ni se guarda ningún secreto en la base.

   Qué conectores se despachan es un **feature flag explícito** (`FEATURE_CONNECTORS`, CSV), no una
   deducción de si hay llave: tener la `YOUTUBE_API_KEY` y querer ese conector apagado son cosas
   distintas. Un `kind` que no está en la lista no se despacha aunque tenga fuentes configuradas, y
   un valor desconocido **hace fallar el boot** (un typo apagaría un conector en silencio, que es la
   peor forma de fallar: nadie lo nota hasta que faltan señales).

4. **No se scrapea con sesión iniciada** (Instagram/TikTok/LinkedIn): sus ToS lo prohíben y el
   anti-bot (TLS/JA3, challenge gestionado) lo hace inviable. Lo que no se puede automatizar entra
   por `MANUAL` (pegar URL/texto/capturas) y **alimenta el mismo pipeline**, con la misma calidad de
   salida. Se advierte una vez en el README y la decisión queda del usuario.

5. **Modelo de dominio en torno a perfiles N:M.** `Profile` (persona/marca) ↔ `Source` vía
   `ProfileSource` (catálogo de fuentes **reutilizable**: la URL se guarda una vez y se
   selecciona/re-selecciona por perfil), y `Profile` ↔ `Signal` vía `ProfileSignal` (cada perfil
   tiene su propio score/estado sobre la misma señal). Cadencia **por perfil en horas**.

6. **Pipeline por etapas**, cada una su cola BullMQ:
   `schedule-cycle → collect (conector) → ingestión (dedup) → analyze (relevancia) → ideas
   (calendario) → notification`. Los **borradores NO están en el pipeline**: se generan solo con
   `POST /ideas/:id/draft`.

7. **Control de costo explícito.** El análisis hace primero un **prefilter determinístico** (gratis)
   y después **una sola llamada LLM batched por perfil y por ciclo** (no una por señal). Frenos:
   `AUTO_IDEAS_ENABLED`, `IDEAS_PER_WEEK`, `ANALYZE_BATCH_SIZE`. Todo consumo queda en `CoachRun` y
   se ve en `GET /usage`. Las acciones caras (borrador, reporte de rendimiento) son **a demanda**.

8. **Multiusuario desde el día 1.** El harness **no tiene login propio**: valida el JWT de atiende
   con el `JWT_SECRET` compartido y de ahí toma `sub`/`businessId`/`role`. `Profile.ownerId` se sella
   al crear y todo lo demás se filtra por relación. (En `cv-harness` esto quedó como deuda
   documentada en su ADR-002 y no implementado; acá se hace bien desde el principio.)

9. **Notificación por puerto** (`NotificationPort`) con adaptador `dashboard` (bandeja en BD) como
   único canal activo; WhatsApp/Discord quedan como adaptadores futuros. Ver ADR-003.

10. **Nada se publica automáticamente.** No hay integración de publicación en v1; el `PublishPort`
    queda diseñado y sin implementar (ADR-003), y siempre detrás de una acción humana.

## Consecuencias

- Reprocesar es idempotente: `fingerprint = sha256(URL canónica)` (o `sha256('manual:'+texto)`) y,
  para el mismo aviso en otra fuente, `dupKey` + `duplicateOfId` (se **marca y se oculta**, nunca se
  borra).
- Un conector caído no rompe el ciclo: la corrida queda `FAILED` con su error, se notifica, y las
  demás fuentes siguen. Los reintentos son del job (backoff exponencial).
- El sistema arranca y se prueba completo sin llaves (`LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`).
- Costo acotado por diseño: el gasto crece con perfiles × ciclos, no con la cantidad de señales.
- Se hereda de `atiende`/`cv-harness`: env Zod fail-fast, logger JSON, `ensure-database` + migración
  + seed idempotente en el boot, compose que **no** crea infra en el server.

## Notas operativas

- Puertos elegidos para no chocar: API **3200** (atiende 3013, cv-harness 3100), Postgres local
  **5435** (atiende 5433, cv-harness 5434), fixture **8091** (cv-harness 8090). El dashboard sigue
  en 3001.
- **Redis: se reutiliza la compartida** (`redis:6379` en la red, publicada en el host como 6380 por
  cv-harness). No se levanta un contenedor propio — duplicarla no aportaba nada y el prefijo ya
  aísla las llaves. En el server es la misma que usan atiende y cv-harness.
- Postgres: **en el server es el de atiende** (`atiende-postgres`), con la base `socialharness`
  propia que se crea sola al boot. En local cada proyecto tiene el suyo
  (`socialharness-postgres`, 5435), igual que los hermanos.
- `QUEUE_PREFIX=socialharness` es lo único que separa las llaves de los tres proyectos en la Redis
  compartida (`socialharness:…` vs `cvharness:…` vs `atiende:dev:queue:…`).
