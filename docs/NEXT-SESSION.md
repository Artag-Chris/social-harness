# Constancia — próxima sesión (continuar)

> Estado: 2026-09-20. Proyecto **social-harness** + pestaña **Social Coach** en el front
> `dashboard/` (hermano de atiende).
>
> Plan completo de la sesión: `~/.commandcode/plans/social-harness-coach-plan.md` (aprobado).
> Decisiones de arquitectura: `docs/adr-001-arquitectura.md`.

## Qué es esto (en una línea)

Coach de redes sociales: recibe **perfiles** con objetivos, recolecta **señales de tendencia**
(YouTube, Google Trends, RSS, páginas públicas, inspiración manual), y devuelve **sugerencias**
(ideas + calendario + formato/timing/hashtags + borradores a demanda). **Nunca publica solo.**

## Decisiones cerradas con el usuario (no reabrir sin motivo)

- Plataformas: **Instagram + TikTok + YouTube**.
- Recolección: **capa de conectores propia en TypeScript** (sin worker Rust, sin Redis Streams).
- Métricas de sus cuentas: **manuales en v1**; API oficial documentada como base (ADR-002), **sin
  implementar**.
- Avisos: **solo dashboard** en v1, detrás de `NotificationPort` (ADR-003) para sumar WhatsApp/Discord.
- MVP: ideas + calendario, sugerencias de posteo, **borradores a demanda**, análisis de rendimiento.
- **La IA no publica ni genera borradores sola.** `AUTO_IDEAS_ENABLED` es el único automatismo con
  IA y se puede apagar.
- Un perfil **no** depende de correr un seed: todo se crea y edita desde el dashboard.

## Estado de las fases

| Fase | Qué | Estado |
| --- | --- | --- |
| 0 | Scaffolding: repo, compose, `.env.example`, schema Prisma, `ensure-database`, seed, ADRs 001-003 + event-flow | **entregado y verificado E2E** |
| — | Capa de IA (ADR-004) y catálogo de redes con LinkedIn (ADR-005) | **entregado y verificado** |
| 1 | Auth (JWT de atiende) + perfiles/cuentas/objetivos + catálogo de fuentes con `probe` + `GET /config` | **entregado y verificado E2E** (ver `docs/IMPLEMENTADO.md`) |
| 2 | Conectores (`youtube`, `google-trends`, `rss`, `public-web`, `manual`) + dedup + `GET /signals` + `schedule-cycle`/`collect` | **entregado y verificado E2E** (ver `docs/IMPLEMENTADO.md`) |
| 3 | Análisis (prefilter + LLM batched) + ideas/calendario + notificación | **entregado y verificado E2E con IA real** (ver `docs/IMPLEMENTADO.md`) |
| 4 | Borradores a demanda + "ya publiqué" + métricas manuales/CSV + `PerformanceReport` + `GET /usage` | **siguiente** |
| 5 | Pestaña "Social Coach" en `dashboard/` (cliente + rutas + `navItems`) | pendiente |
| 6 | Verificación E2E final, README portafolio, git + instrucciones de deploy | parcial (README hecho) |

### Fase 3 — qué quedó hecho (2026-09-22)

- **Análisis** (`modules/analysis`): prefilter determinístico (nicho, frescura, tracción, red) que ordena
  y recorta **antes** de gastar IA + **una sola llamada** por perfil con el lote (`json()` con contrato
  Zod). `ProfileSignal.scoredAt` evita volver a pagar por la misma señal. Sin proveedor, el score
  determinístico es el que queda (el pipeline corre sin llaves).
- **Ideas** (`modules/ideas`): hasta `ideasPerWeek` por corrida, atadas a las señales (`IdeaSignal`), con
  hook/ángulo/whyNow/hashtags/horarios, formato validado contra el catálogo de la red y hueco sugerido en
  el calendario. Respaldo de **plantilla** marcado como tal. `GET/POST/PATCH/DELETE /ideas` y
  `POST /profiles/:id/ideas` (a demanda: el camino con la generación automática apagada).
- **Avisos** (`modules/notifications`): `NotificationPort` + adaptador `dashboard` (ADR-003), fail-soft,
  con `SIGNALS_READY`, `IDEAS_READY` y `COLLECTION_FAILED`.
- **Gasto**: cada llamada queda en `CoachRun` (tokens, latencia, modelo).
- **Bugs reales que cazaron el E2E y los tests** (todos arreglados):
  1. **Carrera en el dedup**: dos fuentes en paralelo con la misma URL canónica pasaban las dos el
     `findUnique` y una reventaba con `Unique constraint failed on fingerprint`. Ahora el `create` maneja
     `P2002` y lo cuenta como "ya conocida". Verificado en vivo: las 3 corridas quedan OK.
  2. **Dos llamadas de IA por ciclo** (una por fuente): el `jobId` del análisis va por minuto + retraso,
     así se agrupan; verificado (3 fuentes → 1 análisis de 11 señales).
  3. **Pegar una inspiración no la analizaba**: el pegado manual ahora encola el análisis del perfil.
  4. El puerto de IA infería el tipo de **entrada** del schema Zod (`default` → campo opcional para el
     llamador): ahora infiere la **salida** (`z.ZodType<T, z.ZodTypeDef, any>`).
- Verificación: **312 tests en 35 archivos**, `tsc` limpio, y el pipeline completo con IA real
  (topScore 95 → 2 ideas generadas por el modelo, avisos en la bandeja, tokens medidos).

### Fase 2 — qué quedó hecho (2026-09-21)

- **Conectores** (`modules/connectors`): puerto + registro por tipo, con `RSS`, `PUBLIC_WEB`, `YOUTUBE_API`,
  `GOOGLE_TRENDS` y `MANUAL`. Reutilizan el **motor** que ya usaba el probe (`connectors/engine/`:
  `fetch-page`, `parse-feed`, `parse-recipe` — se movieron desde `sources/probe`, que ahora solo verifica).
  `isConfigured` permite saltear una fuente sin credenciales en vez de fallar en cada ciclo.
- **Scheduler** (`modules/scheduler`): BullMQ sobre la Redis compartida, ciclo repetible `schedule-cycle`,
  `DispatchService` (unidad de trabajo = fuente; reloj = perfil; cadencia = la más exigente de sus
  fuentes) y `CollectionService` (corrida idempotente por `requestId` + auditoría en `CollectionRun`).
  `POST /profiles/:profileId/run` = "Buscar ahora" (202).
- **Ingestión** (`modules/ingestion`): fingerprint por URL canónica, `dupKey` (título+autor) para marcar
  la misma pieza con otra URL, fan-out N:M a los perfiles suscritos (un duplicado no se reparte) y
  escritura del **embedding** con SQL crudo (columna `Unsupported`), best-effort.
- **Señales** (`modules/signals`): listado con filtros y scoping por perfil, detalle, y el pegado manual
  (texto sin URL → fingerprint por texto; con URL → por canónica). Fuente sintética `MANUAL` para colgar
  lo pegado.
- **Deps nuevas**: `@nestjs/bullmq`, `bullmq`, `ioredis`.
- **Trampas de migración que quedaron documentadas** (costaron tiempo):
  1. `prisma migrate dev` **siempre** agrega un `DROP INDEX` del HNSW (no puede ver ese índice). Ahora el
     índice lo asegura el **boot** (`ensure-database`) y se limpia ese `DROP INDEX` de cada migración.
  2. No correr `migrate reset` en paralelo con la edición de la migración (aplica la versión vieja).
  3. Una migración de enum a texto se escribe a mano con `USING` (la generada dropea columnas).
- Verificación: **276 tests en 31 archivos**, `tsc` limpio y la recolección ejercitada contra el stack
  (dedup por URL canónica con datos reales, idempotencia en la segunda corrida, 11 señales con su vector,
  llaves de Redis todas con prefijo `socialharness:`). Detalle en `docs/IMPLEMENTADO.md`.

### Fase 1 — qué quedó hecho (2026-09-21)

- **Auth**: `AuthGuard` global (JWT de atiende, `@Public()` solo en `/health`), `@CurrentUser()`,
  `AccessScope` (el dueño sale del `sub`; `SUPER_ADMIN` ve todo; 404 en vez de 403) y
  `npm run dev-token` para curl/Swagger.
- **Perfiles**: CRUD + cadencia en horas (rearma `nextRunAt`) + cuentas (agregar/quitar RED, validada
  contra el catálogo, 409 si se repite) + objetivos.
- **Fuentes**: catálogo compartido con CRUD, `GET /sources/templates` y **`POST /sources/probe`**
  (red real: timeout, tope de tamaño por streaming, anti-SSRF, parseo de RSS y de recetas CSS con
  diagnóstico por selector, detección de challenge, métricas y fechas bien parseadas).
- **Transversal**: `ZodValidationPipe` (400 con campo + motivo) y `GlobalExceptionFilter`
  (4xx no ensucia el log; los internos no se filtran al cliente). Nuevas deps: `@nestjs/jwt`,
  `cheerio`, `rss-parser`.
- **Bugs propios encontrados por los tests** (y arreglados): métrica `1.2M` se leía como 12 millones;
  la fecha salía del texto ("18 sep" → 2001) en vez del atributo `datetime`; el contador de items sin
  fecha incluía los descartados; el mensaje de "selector obligatorio" no aparecía si faltaba la clave;
  `setSources` dejaba `nextRunAt` en null.
- **Pie de banco del entorno**: el `nest start --watch` **no recompila** al editar desde Windows (el
  bind mount de OneDrive no propaga los eventos de archivo; el archivo sí llega al contenedor).
  Probado con `TSC_WATCHFILE=FixedPollingInterval`: **tampoco**. → Después de tocar código,
  `docker compose restart api`.
- Verificación: **212 tests en 22 archivos**, `tsc` limpio, `nest build` OK y el flujo completo
  ejercitado contra el stack (detalle en `docs/IMPLEMENTADO.md`).

## Fase 0 — lo que quedó hecho

- **Raíz**: `package.json` (scripts `docker:*`), `.gitignore`, `.env.example` completo con checklist
  de server, `docker-compose.yml` (server: **solo** `api`) y `docker-compose.infra.yml` (dev local:
  `socialharness-postgres` 5435 + override del api; **la Redis NO se levanta**, se reutiliza el
  contenedor `redis` compartido).
- **Fixture E2E** (`fixtures/www/`, profile `fixture`): `trends.html` (para la receta CSS del
  conector `PUBLIC_WEB`, con `.trend-card` repetido a propósito), `feed.xml` y `news.xml` (mismo
  enlace con `utm_*` distinto para probar el dedup por URL canónica).
- **Docs**: `adr-001-arquitectura.md`, `adr-002-metricas-api-oficial.md` (base diseñada, NO
  implementada, con migración aditiva), `adr-003-notificaciones-y-publicacion.md` (puerto de avisos +
  `PublishPort` apagado por diseño), `event-flow.md`.
- **`apps/api`**: Prisma schema completo, `ensure-database.ts` (crea la base **y** la extensión
  `vector` antes de migrar), `seed.ts` idempotente (siembra las fuentes fixture solo con
  `FIXTURE_ENABLED=true`), env Zod fail-fast, logger JSON, `PrismaService`, `/api/health` y el puerto
  `TrendConnectorPort`.
- **Capa de IA con patrón adaptador** (`modules/llm` + `modules/embeddings`): puerto + un adaptador por
  proveedor (DeepSeek principal, Groq respaldo, `mock`), base compartida `OpenAiCompatibleProvider`
  (timeout, reintentos, modo JSON con reintento si el modelo no lo soporta, validación con Zod),
  router con respaldo, tabla de precios con override por `.env`, y `npm run llm:check`. Ver
  `docs/adr-004-proveedores-de-ia.md`.
- **Redes y formatos como catálogo** (`modules/platforms`): LinkedIn sumada, `GET /platforms` para que
  la UI no hardcodee nada, validación red ↔ formato, y `Platform`/`IdeaFormat` convertidos de enum de
  Postgres a texto validado (agregar o quitar una red ya no es una migración). Ver
  `docs/adr-005-redes-y-formatos-como-catalogo.md`.

### LinkedIn y el catálogo de redes — verificado (2026-09-21)

- **Migración sin pérdida de datos**: había 3 cuentas (`INSTAGRAM, TIKTOK, YOUTUBE`); después de
  `migrate deploy` siguen las 3 con sus valores, las columnas quedaron en `text` y **los 3 índices
  siguen ahí** (incluido el HNSW, que el SQL generado por Prisma se llevaba).
  ⚠️ El SQL de Prisma para este cambio **dropeaba las columnas**: hubo que escribirlo a mano con
  `USING "col"::text`. Si hay que tocar tipos de enum, revisar el SQL antes de aplicarlo.
- **Seed con 4 cuentas** (`INSTAGRAM, LINKEDIN, TIKTOK, YOUTUBE`).
- **`GET /platforms`** → las 4 redes con formatos y detalle:
  `LinkedIn → POST, CAROUSEL, VIDEO, ARTICLE, POLL` (por defecto POST y CAROUSEL), con
  `scrapingAllowed: false` y `trendsStrategy: 'manual'`.
- `npm run check` → **144 tests en 13 archivos** + `tsc` limpio.
- **Bug encontrado por el E2E**: el contenedor tenía el **cliente Prisma viejo** (la imagen lo genera
  al construir y en dev el schema se monta desde el host) → el seed fallaba *dentro* de Docker aunque
  en el host pasara. Se arregló agregando `npx prisma generate` al CMD del boot del Dockerfile.
- **Bug de los scripts**: `npm run docker:infra:up` estaba roto (el archivo de infra solo no valida
  porque su bloque `api` es un override). Ahora los scripts pasan siempre los dos archivos y arrancan
  o paran solo `postgres`.

### Para sumar o quitar una red (procedimiento corto)

1. `PLATFORM_KEYS` + `PLATFORMS` en `apps/api/src/modules/platforms/platforms.catalog.ts` (y sus
   formatos en `FORMAT_KEYS`/`FORMATS` si trae nuevos). **No hay migración.**
2. `GET /platforms` y la UI (que se arma del catálogo) lo toman solos.
3. Por perfil: agregar una red = una fila en `SocialAccount`; quitarla = borrarla (los endpoints
   `…/accounts` son de la fase 1).

### Capa de IA — verificado contra las APIs reales (2026-09-20)

- **DeepSeek responde de verdad**: `GET /models` OK y un `json()` real devolvió
  `{"ok":true,"ejemplo":"hola"}` en ~900-1000 ms (122 tokens de entrada). La llave es la MISMA que ya
  usan atiende y cv-harness.
- **⚠️ El modelo se llama `deepseek-flash` del lado de la API** (alias de `deepseek-v4-flash` del
  `.env`): al no estar en la tabla de precios, el costo se registra en **0** y sale un aviso. Para el
  medidor de gasto hay que poner el precio en `LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M`.
- **⚠️ La cuenta de OpenAI no tiene créditos** (`You have no credits remaining`): con
  `EMBEDDING_PROVIDER=openai` los embeddings fallan SIEMPRE, así que el `.env` quedó en **`mock`**
  (vector determinístico de 1536 dims: corre, pero la similitud no es semántica). **Afecta también a
  atiende**, que usa esa misma llave para su RAG y su caché semántica. Al cargar créditos: cambiar a
  `openai` **y re-embebir** lo guardado (vectores de espacios distintos no son comparables).
- Boot y `/health` reportan proveedor/respaldo/modelo (sin llaves):
  `{"llm":{"provider":"deepseek","fallback":"groq","model":"deepseek-v4-flash"},"embeddings":{"provider":"mock",...}}`.
- `npm run check` → **126 tests en 12 archivos** + `tsc` limpio · `nest build` OK.

**Ojo al recrear el contenedor**: `docker compose restart` NO recarga el `.env` (las variables se
fijan al crear el contenedor). Después de tocar llaves/proveedores hay que usar
`docker compose up -d --force-recreate api`.

### Verificación real (no solo "compila")

Levantado con `npm run docker:up:local` (compose + infra local + profile `fixture`):

- `npx tsc --noEmit` → **0 errores** · `npm run build` → OK (`dist/main.js` en la raíz, sin `dist/src`)
  · `npx vitest run` → **27 tests / 3 archivos en verde**.
- **Boot completo**: `ensure-database` (base + `pgvector`) → `migrate deploy` (1 migración aplicada) →
  `seed` → Nest escuchando. `GET /api/health` → `{"status":"ok","db":"up","llmMode":"mock","embedMode":"mock"}`.
- **Seed idempotente probado de verdad**: dos boots seguidos → `Profile=1, SocialAccount=3,
  Objective=3, Source=3, ProfileSource=3, _prisma_migrations=1` (sin duplicados).
- **Rama crítica del server probada**: apuntando `ensure-database` a una base inexistente
  (`socialharness_scratch`) la **creó desde cero** y aplicó la extensión; después se borró la base de
  prueba. Es el camino que va a correr en el server sobre una base vacía.
- **Esquema**: extensión `vector` presente e **índice HNSW** `Signal_embedding_hnsw_idx` creado
  (va a mano en la migración: Prisma no puede expresar índices sobre columnas `Unsupported`).
- **Fixture E2E**: `feed.xml` 200 con 4 items y `trends.html` 200 con las tarjetas `.trend-card`.
- `GET /api/docs` y `/api/docs-json` → 200.

**Verificación de los arreglos de la auditoría** (todo medido, no supuesto):

- **Migración nueva desde cero**: se borró el volumen local (`down -v`) y se levantó de nuevo → 16
  tablas, con **`IdeaSignal`** creada y **sin** la columna `sourceSignals`. Índice
  `Signal_embedding_hnsw_idx` y columna `embedding vector(1536)` presentes.
- **Seed idempotente** tras un segundo boot: `Profile=1, SocialAccount=3, Objective=3, Source=3,
  ProfileSource=3, IdeaSignal=0, _prisma_migrations=1`.
- **Fail-fast del flag**: dentro del contenedor con `FEATURE_CONNECTORS=RRS`,
  `npx ts-node src/main.ts` → **exit 1** con `FEATURE_CONNECTORS tiene valores desconocidos: RRS.
  Válidos: YOUTUBE_API, GOOGLE_TRENDS, ...` y **sin** llegar a servir el puerto.
- **Cierre limpio (prueba decisiva)**: se levantó el api con `--entrypoint node` (node como PID 1, sin
  el `sh` del CMD de desarrollo) y se le mandó SIGTERM → salió en **360 ms con código 0**. Sin
  `enableShutdownHooks()` node habría terminado con **143** (SIGTERM por defecto sin cerrar) y con
  SIGKILL habría dado 137.
- El log de arranque ahora incluye `connectors: [...]`, que es lo primero que se mira cuando una
  fuente no trae señales.
- `npm run check` → **58 tests en 7 archivos** + `tsc` sin errores · `npm run build` OK. (De paso:
  `check` atrapó un error de tipos en un spec que `vitest` no ve, porque vitest no typechequea.)

### Gotcha encontrado en el arranque (no repetirlo)

`JsonLogger` tenía `constructor(level: Level = env.LOG_LEVEL)`. Un parámetro **con valor por defecto**
hace que Nest emita `String` como dependencia e intente inyectarla:
`Nest can't resolve dependencies of the JsonLogger (?) … argument String at index [0]`.
Compilaba perfecto y fallaba solo al arrancar. La clase quedó **sin parámetros de constructor** y lee
el nivel de la configuración ya validada. Regla: en un provider de Nest, no usar parámetros de
constructor con default (el `emitDecoratorMetadata` los transforma en dependencias).

### Auditoría de calidad (revisión crítica) — hallazgos y arreglos

Se revisó el código buscando problemas **reales** de robustez y de extensibilidad, no estilo. Lo que
se encontró y se arregló:

| Hallazgo | Por qué importaba | Arreglo |
| --- | --- | --- |
| **Inyección de SQL en el boot** | `CREATE DATABASE "${database}"` interpola un identificador que sale de `DATABASE_URL`, y Postgres no admite parámetros ahí | `assertSafeIdentifier()` valida `^[A-Za-z_][A-Za-z0-9_]*$` y falla con un mensaje claro antes de tocar la base |
| **Sin cierre limpio** | Faltaba `app.enableShutdownHooks()`: en SIGTERM Nest nunca corría `onModuleDestroy`, así que el pool de Prisma quedaba abierto y (fase 2) los workers de BullMQ dejarían jobs a medias | `enableShutdownHooks()` en `main.ts` |
| **CORS hardcodeado y abierto** | No había forma de restringirlo sin tocar código | `CORS_ALLOWED_ORIGINS` (mismo nombre que en atiende), `*` por defecto, aviso si es `*` en producción |
| **Flags de conector derivados de la llave** | No se podía apagar un conector teniendo la llave, y "apagado a propósito" era indistinguible de "sin configurar" | `FEATURE_CONNECTORS` (CSV) como flag real; un valor desconocido **rompe el boot** en vez de apagar el conector en silencio |
| **Config muerta** | `SOURCE_DEFAULT_INTERVAL_HOURS` existía y nadie la leía: el default real estaba hardcodeado en el seed | El seed usa el valor validado; además ahora usa el MISMO `env` que la app (antes leía `process.env` a mano, con otra regla para el booleano) |
| **`REDIS_URL` sin validar** | Una URL mal escrita reventaba en un `new URL()` durante el import, sin decir qué variable era | Refine de URL en Zod (también en `FIXTURE_BASE_URL`) |
| **URLs de señal sin restringir** | `z.string().url()` acepta `file:`, `ftp:` o `javascript:`, y el pipeline hace fetch de eso | Solo `http(s)` |
| **Trazabilidad sin integridad** | `ContentIdea.sourceSignals String[]`: ids colgando si se borra una señal, y sin consulta inversa indexada | Tabla N:M **`IdeaSignal`** con FK y `onDelete: Cascade` + `contribution` (por qué esa señal sostiene esa idea) |
| **Precedencia de cadencia ambigua** | Tres niveles (`ProfileSource` / `Profile` / `Source`) podían definirla y cada servicio habría inventado su orden | `resolveIntervalHours()` puro, con el orden documentado y probado |
| **Logger: `level`/`time` falseables y sin `fatal`** | Un mensaje con su propia clave `level` podía mentir en la línea; Nest llama `fatal` en errores no atrapados y no existía | Claves reservadas se escriben al final; `fatal` implementado |
| **Validación que no corría** | `features.ts` no lo importaba nadie todavía, así que el fail-fast de `FEATURE_CONNECTORS` **no se ejecutaba** en el boot: se habría descubierto recién en la fase 2 | `main.ts` (composition root) resuelve las features al arrancar y loguea los conectores activos |
| **Tests frágiles (mío)** | El spec del logger usaba `vi.resetModules()` + import dinámico: pasaba aislado y fallaba en la suite completa | La regla de filtrado quedó como función pura `isLevelEnabled()` y el spec ya no depende de recargar módulos |

**Lo que se revisó y está bien** (no se tocó): el dedup no destructivo, el fan-out N:M, la
idempotencia del seed (probada con dos boots), la resolución de `auto` para LLM/embeddings, el
`ensure-database` (probado creando una base desde cero) y el `ValidationPipe` global.

**Falta por decisión, no por olvido:** `MetricSnapshot` no tiene clave de idempotencia (importar dos
veces el mismo CSV duplicaría snapshots). La semántica queda definida como **upsert por (cuenta,
día)** y se implementa en la fase 4 junto con el import — está anotado en `adr-002`. Poner ahora un
`@@unique([socialAccountId, capturedAt])` sería adivinar: dos snapshots del mismo día pueden ser
legítimos.

## Puertos (no chocar con los hermanos)

| Recurso | atiende | cv-harness | **social-harness** |
| --- | --- | --- | --- |
| Postgres en el **server** | contenedor `atiende-postgres`, DB `atiende` | mismo contenedor, DB `cvharness` | **mismo contenedor, DB `socialharness`** (auto-creada) |
| Postgres **local** | `atiende-postgres` : 5433 | `cvharness-postgres` : 5434 | **`socialharness-postgres` : 5435** |
| Redis | `redis:6379` compartida | `redis:6379` compartida | **`redis:6379` la MISMA** |
| Prefijo de colas | `atiende:dev:queue` | `cvharness` | **`socialharness`** |
| API en el host | 3013 | 3100 | **3200** |
| Fixture E2E | — | 8090 | **8091** |
| Dashboard | 3001 (compartido por los tres) | — | — |

### Verificación de convivencia y reutilización (2026-09-20, ejecutada)

Lo que se probó **con los contenedores reales de los tres proyectos corriendo a la vez**:

- **Sin choques de puertos ni de nombres**: con `redis` (6380) y `cvharness-postgres` (5434) ya
  arriba se levantó este stack y convivieron 5 contenedores —
  `socialharness-api` (3200), `socialharness-fixture` (8091), `socialharness-postgres` (5435),
  `redis` (6380) y `cvharness-postgres` (5434). Ningún puerto ni nombre repetido; `GET /api/health`
  en verde.
- **Se reutiliza la Redis compartida**: dentro del contenedor `REDIS_URL=redis://redis:6379` y
  `redis` resuelve a `172.18.0.2` en `microservices-network`; `redis-cli -h redis ping` → `PONG`.
  Se **eliminó** el contenedor `socialharness-redis` que había en `docker-compose.infra.yml`: era
  duplicar algo que ya corre. Se fue también la variable `REDIS_HOST_PORT` (ya no hay puerto que
  reservar).
- **Simulación del server (lo más importante)**: con `atiende-postgres` levantado, se corrió la
  cadena real de boot (`ensure-database` → `migrate deploy` → `seed`) apuntando al **mismo postgres
  de atiende**:
  - `[ensure-database] base "socialharness" creada` → el usuario `atiende` **sí** puede crear la
    base (es el superusuario de la imagen), así que no hace falta aprovisionar nada a mano.
  - La base quedó con **16 tablas + pgvector + índice HNSW + 1 migración**.
  - El postgres pasó a tener `atiende`, `postgres` y `socialharness`.
  - **La base `atiende` quedó intacta**: sus 21 tablas igual que antes.
  - Después se **borró** la base de prueba y se quitó el contenedor, dejando la máquina como estaba.
- **Entorno restaurado**: al terminar quedaron corriendo solo `redis` (6380) y
  `cvharness-postgres` (5434) — exactamente lo que ya estaba antes de verificar.

### Qué NO se pudo verificar (y por qué)

- **Nada del server remoto**: no tengo acceso, así que el checklist de 5 comandos del README
  (puerto 3200 libre, bases del postgres compartido, `ping` a la Redis, `JWT_SECRET` idéntico, boot)
  lo corre él. Lo único que este harness publica al host es `API_PORT` (3200): si estuviera ocupado,
  se cambia esa variable en el `.env` y no se toca código ni compose.
- **Aislamiento real de llaves en Redis**: los prefijos son distintos por inspección
  (`socialharness` vs `cvharness` vs `atiende:dev:queue`), pero las llaves de BullMQ recién se
  crean en la fase 2 — ahí se comprueba con las llaves vivas.

## Pasos exactos para la próxima sesión

1. **Fase 1**: `modules/auth` (guard global que valida el Bearer contra `JWT_SECRET` de atiende +
   `@Public()` + `@CurrentUser()` con `sub`/`businessId`/`role`) y `scripts/dev-token.ts` para probar
   por CLI/Swagger. Luego `modules/profiles` (perfiles, cuentas, objetivos) y `modules/sources`
   (catálogo + `templates` + `probe`) con el `AccessScope`/sellado de `ownerId` desde el primer
   endpoint.
2. **Fase 2**: `modules/connectors` con la factory por `kind` y los 5 adaptadores. Reusar de
   cv-harness el **patrón** de `common/http.ts` (cabeceras de navegador, `diagnoseBlock`,
   `looksLikeChallenge`, anti-SSRF, tope de tamaño) y el `extract` con cheerio espejando la semántica
   de la receta. `modules/scheduler` + `modules/ingestion` (dedup).
3. **Fases 3-5** según `docs/event-flow.md`. Recordar: los borradores **no** van en el pipeline.
4. **Fase 6**: levantar el stack real y verificar el flujo E2E (contra los servicios, no solo que
   compile), README tipo portafolio (Mermaid, features, decisiones, verificación), y git con
   `origin` a `Artag-Chris/social-harness`.

## Pendientes / recordatorios

- **`.env`**: este proyecto **agrega** variables (`NEXT_PUBLIC_SOCIAL_API_URL` en el dashboard y todo
  el `.env` de `social-harness`). **No cambia nada de atiende ni de cv-harness**, así que sus `.env`
  actuales no requieren tocarse. En Vercel, `NEXT_PUBLIC_*` se hornea en el build → **requiere
  redeploy**.
- **Server**: `JWT_SECRET` debe ser **el mismo de atiende**; `YOUTUBE_API_KEY` para el conector de
  YouTube; `DEEPSEEK_API_KEY` y `OPENAI_API_KEY` para IA y embeddings reales; `FIXTURE_ENABLED=false`.
- **ToS**: no se scrapea con sesión iniciada (Instagram/TikTok/LinkedIn). Lo no automatizable entra
  por `MANUAL`. Se advierte una vez, no se insiste.
- **`apps/web`**: no existe a propósito. El front es la pestaña del `dashboard/` hermano.
- Deuda conocida que **no** se replicó de `cv-harness`: sin `AdminUser`/login local, sin worker Rust,
  sin Redis Streams.
