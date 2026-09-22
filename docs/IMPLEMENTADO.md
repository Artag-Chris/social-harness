# Implementado — Social Harness

Inventario honesto de **qué funciona hoy**, cómo se usa y qué falta. Se actualiza al cerrar cada
fase. Última actualización: **2026-09-21** (Fase 1 terminada).

> Para entender el *por qué* de las decisiones, los ADR están en `docs/adr-00X-*.md`.
> Para el flujo de usuario completo (incluido lo que todavía no existe), ver la explicación por fases.

---

## Estado por fase

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Esqueleto: composes, schema, `ensure-database` (DB + pgvector), seed idempotente, fixture E2E | **hecho** |
| — | Capa de IA con patrón adaptador (DeepSeek/Groq/mock + embeddings) · catálogo de redes (LinkedIn) | **hecho** |
| 1 | Auth con el JWT de atiende + perfiles/cuentas/objetivos + catálogo de fuentes con verificación | **hecho** |
| 2 | Conectores que recolectan + ingestión con dedup + scheduler por perfil + señales | **hecho** |
| 3 | Análisis de relevancia + ideas y calendario + avisos | **hecho** |
| 4 | Borradores a demanda + "ya publiqué" + métricas y reporte de rendimiento | **hecho** |
| 5 | Pestaña "Social Coach" en el dashboard | **hecho** |
| 6 | Verificación E2E en el server + conector oficial de métricas | pendiente |

**Lo que NO existe todavía** (para no buscarlo en vano): el conector oficial de métricas (hoy se cargan
a mano, ADR-002), el `PublishPort` (publicar sigue siendo un acto humano, ADR-003) y la verificación
final en el server. Lo que ya funciona es el ciclo completo: recolectar → analizar → sugerir ideas →
escribir el borrador a pedido → registrar que se publicó → medir y reportar.

---

## Lo implementado

### Base (fase 0)

- **`docker-compose.yml`** (server): **solo el api**. Usa la Redis compartida (`redis:6379`) y el
  Postgres de atiende (`atiende-postgres`), con base propia `socialharness` que **se crea sola**.
- **`docker-compose.infra.yml`** (dev local): postgres propio en 5435 + override del api que apunta a
  la Redis compartida. El archivo **no se usa solo** (su bloque `api` es un override): los scripts
  pasan siempre los dos.
- **`prisma/ensure-database.ts`**: crea la base y la extensión `pgvector` antes de migrar
  (idempotente; verifica el nombre de la base para no interpolar SQL).
- **`prisma/seed.ts`**: idempotente. Deja un perfil de ejemplo con **4 cuentas** (Instagram, TikTok,
  YouTube, LinkedIn), 3 objetivos y las 3 fuentes del fixture.
- **Fixture E2E** (`fixtures/www/`, profile `fixture`): un feed RSS, otro con el mismo enlace con
  `utm_*` (para probar el dedup) y una página de tendencias con tarjetas `.trend-card`.
- **Migraciones**: `init` y `redes_y_formatos_como_catalogo` (esta última **escrita a mano** con
  `USING ...::text`, porque la que generaba Prisma dropeaba las columnas y se llevaba el índice HNSW).

### Capa de IA — patrón adaptador

- Puerto `LlmProviderPort` (`chat` / `json` / `isHealthy`) + `EmbeddingProviderPort`, publicados como
  tokens (`LLM_PROVIDER_TOKEN`, `EMBEDDING_PROVIDER_TOKEN`): el pipeline nunca nombra a un proveedor.
- Adaptadores: **DeepSeek** (principal), **Groq** (respaldo), **mock** (determinístico, sin red), con
  una base compartida `OpenAiCompatibleProvider` (timeout, reintentos con backoff, modo JSON con
  reintento si el modelo no lo soporta, validación con Zod del contrato).
- Router principal → respaldo; si fallan los dos, el error explica **los dos** motivos.
- Precios en `pricing.ts` (con override por `.env`) para el medidor de gasto.
- **Verificado contra la API real**: DeepSeek respondió un JSON válido en ~900 ms con la misma llave
  de atiende/cv-harness.
- `npm run llm:check` (o `docker compose exec api npm run llm:check`) dice qué quedó resuelto y hace
  una llamada mínima.

### Catálogo de redes y formatos

- `modules/platforms/platforms.catalog.ts` es la **fuente de verdad**: redes, formatos, y por red su
  guía de contenido, horarios, política de hashtags, de dónde salen sus tendencias y si el scraping
  está permitido.
- Redes: **Instagram** (Reel, Carrusel, Historia, Post) · **TikTok** (Short, Carrusel, Historia) ·
  **YouTube** (Short, Video, En vivo, Post) · **LinkedIn** (Post, Carrusel, Video, Artículo,
  Encuesta; por defecto Post y Carrusel).
- `GET /platforms` alimenta los selectores del dashboard: **agregar o quitar una red no toca el
  front ni pide migración** (eran enums de Postgres; ahora son texto validado).

### Auth (una sola sesión)

- **`AuthGuard` global**: todo endpoint exige el JWT de atiende (`Authorization: Bearer …`), salvo los
  marcados `@Public()` — hoy solo `/health`. Si el `JWT_SECRET` del server no coincide con el de
  atiende, la respuesta es 401 y la pestaña lo muestra.
- **`@CurrentUser()`** inyecta `sub` / `email` / `businessId` / `role`.
- **`AccessScope`**: un único lugar decide qué alcanza cada usuario. El dueño se sella con el `sub`
  del token (nunca con un id del body) y todo lo demás se filtra por relación. `SUPER_ADMIN` ve todo;
  un perfil sin dueño (el del seed) se trata como compartido. Detalle y transición: comentado en
  `access-scope.service.ts`.
- **`npm run dev-token`** firma un token de prueba (para curl/Swagger). Avisa que los perfiles creados
  con ese token quedan a nombre de su `sub`.

### Perfiles, cuentas y objetivos

| Endpoint | Para qué |
| --- | --- |
| `GET /profiles` | Lista tus perfiles con cuentas, objetivos y fuentes |
| `POST /profiles` | Crear perfil (nicho, audiencia, voz, idioma, cadencia en horas, ideas/semana, auto-ideas) |
| `GET /profiles/:id` · `PATCH` · `DELETE` | Detalle, edición y borrado (arrastra cuentas, objetivos, ideas y selecciones) |
| `PATCH /profiles/:id/schedule` | Cadencia en horas (`null` = solo a mano); rearma la próxima corrida |
| `GET/POST /profiles/:id/accounts` · `PATCH/DELETE …/:accountId` | **Agregar o quitar una red** (la red se valida contra el catálogo; repetir cuenta → 409) |
| `GET/POST /profiles/:id/objectives` · `PATCH/DELETE …/:objectiveId` | Objetivos medibles (métrica, meta, fecha, estado) |
| `PUT /profiles/:id/sources` | Seleccionar las fuentes que vigila el perfil (N:M) |
| `PATCH/DELETE /profiles/:id/sources/:sourceId` | Activar/desactivar una fuente para ese perfil o darle cadencia propia |

### Catálogo de fuentes + verificación

| Endpoint | Para qué |
| --- | --- |
| `GET /sources` | Catálogo compartido + en qué perfiles está usada cada fuente |
| `POST /sources` · `PATCH` · `DELETE` | Alta, edición (validando `params` según el tipo) y baja |
| `GET /sources/templates` | Plantillas por tipo (RSS, Google News, YouTube, Google Trends, página pública, manual, + fixtures en dev) |
| `POST /sources/probe` | **Verificar antes de guardar**: no guarda nada, devuelve previsualización, avisos y diagnóstico |

**El probe** (lo que evita guardar una fuente que no trae nada):

- Trae la página con timeout, **tope de tamaño** (corta al pasarse, leyendo por streaming) y
  **anti-SSRF** (rechaza direcciones internas por nombre y por IP resuelta; el fixture de dev se
  habilita con `FIXTURE_ENABLED=true`).
- **RSS/Atom**: parsea el feed y avisa de items sin enlace (se descartan) o sin fecha.
- **Página pública**: aplica la receta de selectores CSS, **absolutiza las URLs**, convierte métricas
  ("1.2M" → 1200000, "1.200" → 1200) y lee la fecha del atributo `datetime` antes que del texto
  visible (el texto "18 sep" sin año JavaScript lo interpreta como 2001).
- Devuelve **diagnóstico por selector** (cuántos items matcheó cada uno): una receta que no trae nada
  se depura en un vistazo.
- Detecta páginas con **challenge anti-bot** (Cloudflare/Turnstile) y lo explica.
- Tipos que todavía no puede verificar (`YOUTUBE_API`, `GOOGLE_TRENDS`) validan sus params y avisan
  que su verificación real llega con los conectores.

### Conectores, recolección e ingestión (fase 2)

- **Cinco conectores** detrás de un puerto (mismo patrón que la IA): `RSS`, `PUBLIC_WEB` (receta CSS),
  `YOUTUBE_API` (búsqueda por tema + estadísticas, solo lo reciente), `GOOGLE_TRENDS` (endpoint
  público *no oficial*, best-effort) y `MANUAL`. Todos comparten el **mismo motor de scraping** que usa
  el probe, así que lo que se ve al verificar es lo que entra.
- **Scheduler con BullMQ** sobre la **Redis compartida** (prefijo `socialharness`, sin pisar a atiende
  ni a cv-harness): un ciclo repetible cada `CRON_INTERVAL_MINUTES` busca los perfiles vencidos y encola
  sus fuentes. `POST /profiles/:id/run` ("Buscar ahora") dispara lo mismo sin esperar la cadencia.
  La unidad de trabajo es la **fuente** (una descarga sirve a todos los perfiles suscritos) y el reloj
  es el **perfil**; con varias fuentes, el perfil se despierta con la cadencia **más exigente**.
- **Ingestión con idempotencia real**: `fingerprint` = sha256 de la URL **canónica** (así el mismo
  enlace con `?utm_…` no entra dos veces), `dupKey` = título + autor para marcar la misma pieza con otra
  URL (**se marca y se oculta, nunca se borra**), y fan-out N:M a los perfiles que seleccionaron la
  fuente. Un duplicado **no** se reparte: el perfil ya tiene el original y analizarlo costaría IA por
  nada.
- **Embeddings escritos con SQL crudo** (`Signal.embedding` es una columna que Prisma no tipa), en modo
  *best-effort*: si el proveedor falla, la señal entra igual y el fallo se cuenta en el resumen.
- **Una fuente sin credenciales se saltea** con un aviso (no se marca FAILED): una fuente que falla
  siempre llena la bandeja de errores y tapa los problemas reales.
- **Auditoría por corrida**: `CollectionRun` (RUNNING → OK/FAILED) guarda items encontrados, nuevos y
  los **avisos del conector** en el campo de error — es donde se mira cuando una fuente "anduvo pero no
  trajo nada". Idempotente por `requestId`, así que un reintento no duplica filas.

| Endpoint | Para qué |
| --- | --- |
| `GET /signals` | Señales que le tocaron a mis perfiles, con filtros (perfil, red, tipo, relevancia, días, texto, duplicados) y paginación |
| `GET /signals/:id` | Detalle, con el original si es duplicada |
| `POST /signals/from-text` | Pegar una inspiración (texto y/o URL) para un perfil |
| `POST /signals/from-url` | Pegar una URL de lo que no se puede automatizar |
| `POST /profiles/:profileId/run` | **Buscar ahora**: recolecta las fuentes del perfil (202 = encolado) |

### Análisis, ideas y avisos (fase 3)

- **Análisis de relevancia por perfil** (`modules/analysis`), pensado para que el gasto de IA crezca con
  los **perfiles** y no con la cantidad de señales:
  1. **Prefilter determinístico** (gratis): puntúa cada señal nueva por nicho (30-45), frescura (hasta
     25), tracción (hasta 20) y si el perfil publica en esa red (10), y deja sus razones.
  2. **Una sola llamada de IA** por perfil con el lote (`json()` con contrato Zod), no una por señal.
  3. **Respaldo determinístico**: si no hay proveedor (o el modelo devuelve algo inválido) queda el
     score del prefilter, así el pipeline funciona sin llaves.
  - `ProfileSignal.scoredAt` marca lo juzgado: la corrida siguiente **no vuelve a pagar** por esa señal.
- **Ideas y calendario** (`modules/ideas`): hasta `ideasPerWeek` ideas por corrida, cada una atada a las
  señales que la sostienen (`IdeaSignal`), con hook, ángulo, `whyNow`, hashtags y pistas de horario. El
  **formato se valida contra la red** (un "Reel de LinkedIn" se descarta). Se programan en un hueco
  sugerido (días hábiles a las 10) que el usuario mueve en el calendario. Sin IA, cae a una **plantilla
  determinística** marcada como `plantilla` (no se hace pasar por sugerencia del modelo).
- **Avisos** (`modules/notifications`) detrás de un `NotificationPort` con adaptador `dashboard`
  (ADR-003): señales analizadas, ideas listas y recolección fallida. Fail-soft: un canal caído no tumba
  el trabajo ya hecho.
- **Gasto medido**: cada llamada de IA queda en `CoachRun` (tokens de entrada/salida, latencia, modelo).
- **Concurrencia**: el análisis agrupa las fuentes de un mismo ciclo en **una sola** llamada de IA
  (`jobId` por minuto + retraso). Y en la ingestión, si dos fuentes traen la misma URL a la vez, la que
  pierde la carrera contra el índice único se cuenta como "ya conocida" en vez de tumbar la corrida.

| Endpoint | Para qué |
| --- | --- |
| `GET /ideas` | Calendario con filtros por perfil, estado, red y rango de fechas |
| `POST /ideas` · `GET /ideas/:id` · `PATCH /ideas/:id` · `DELETE /ideas/:id` | Cargar a mano, ver, mover/aprobar/descartar/marcar publicada y borrar |
| `POST /profiles/:profileId/ideas` | **Generar ideas ahora** (encolado, 202): es el camino cuando la generación automática está apagada |
| `POST /ideas/:id/draft` · `GET /drafts/:id` · `PATCH /drafts/:id` | **Pedir un borrador** (202, es una llamada de IA), verlo y editarlo |
| `POST /ideas/:id/published` | **Ya publiqué** + el enlace de la pieza |
| `GET/POST /accounts/:id/metrics` | Historial y carga de métricas (snapshot o CSV pegado) |
| `GET /profiles/:id/performance` · `POST /profiles/:id/performance/run` | Reportes del perfil y armar uno ahora |
| `GET /usage` | Gasto de IA: totales, por trabajo y por día |
| `GET /notifications` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` | Bandeja de avisos |

### Borradores, medición y dashboard (fases 4 y 5)

- **Borradores a demanda** (`modules/drafts`): `POST /ideas/:id/draft` encola (202) y el worker escribe
  caption, guion (vacío si no es video), 2-3 arranques alternativos, cierre y notas de producción.
  **Regenerar crea una versión nueva**: si el usuario editó (`editedByUser`), su texto no se pisa. Sin IA
  cae a una plantilla que lo dice. El pipeline **nunca** escribe solo.
- **"Ya publiqué"**: `POST /ideas/:id/published` (lo marca el humano) con el enlace de la pieza, que es
  lo que después permite atribuir rendimiento.
- **Métricas** (`modules/metrics`): `POST /accounts/:id/metrics` acepta un snapshot o un **CSV pegado**
  (una fila por día). El parser es tolerante a propósito (`;` o `,`, encabezados en español o inglés,
  `1.200`, `4,5 %`, `dd/mm/yyyy`) y **no inventa**: una fila sin fecha se descarta y se avisa. El snapshot
  es único por **cuenta y día**, así que reimportar el mismo CSV actualiza en vez de duplicar.
- **Reporte de rendimiento** (`modules/performance`): los deltas los calcula el código (seguidores
  primero→último, alcance/impresiones/likes sumados, engagement promediado) y **la IA solo interpreta**.
  Sin métricas cargadas **no se llama a la IA** y el aviso dice que faltan datos: un análisis sin números
  es una opinión con formato de dato.
- **Control de gasto**: `GET /usage` devuelve totales, por trabajo y por día (tokens, latencia, costo).
- **Pestaña "Social Coach" en el dashboard** (fase 5, repo `dashboard/`): ocho vistas —Resumen,
  Tendencias, Ideas y calendario, detalle de idea con borrador, Pegar inspiración, Perfiles, Fuentes,
  Métricas y reportes, Avisos— usando la sesión de atiende (sin segundo login) y el mismo estilo que la
  pestaña de CV. `NEXT_PUBLIC_SOCIAL_API_URL` en `.env.local`; CORS del harness ya abre el origen.

### Config para la UI

- `GET /config`: proveedor de IA y embeddings (y si son mock), umbrales de ideas, cadencia por defecto,
  **opciones de cadencia en horas**, dedup, canales de aviso, conectores habilitados y cuáles tienen
  credenciales.

### Transversal

- **`ZodValidationPipe`**: toda entrada se valida con Zod (misma librería que el resto del proyecto) y
  un 400 devuelve **campo + motivo**, que es lo que el dashboard mostrará tal cual.
- **`GlobalExceptionFilter`**: formato único de error; un 4xx de negocio no ensucia el log y un error
  interno (Prisma, red) se loguea completo del lado del servidor y al cliente le llega un 500 genérico.
- El log de arranque dice puerto, proveedores de IA, embeddings y conectores activos.

---

## Cómo probarlo (con el stack levantado)

```bash
# 1. Stack local (postgres propio + Redis compartida + fixture)
npm run docker:up:local

# 2. Token de prueba
docker compose exec api npm run dev-token -- --sub=e2e-user

# 3. Con ese token:
TOKEN=...   # el JWT que imprime el paso 2

curl -s http://localhost:3200/api/health                       # público, sin token
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3200/api/profiles
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3200/api/platforms
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3200/api/config

# Crear un perfil y agregarle LinkedIn
curl -s -X POST http://localhost:3200/api/profiles -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mi marca","niche":["ia"],"scheduleHours":24}'

curl -s -X POST http://localhost:3200/api/profiles/<id>/accounts -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"platform":"LINKEDIN","handle":"/in/mimarca"}'

# Verificar una fuente antes de guardarla (RSS del fixture)
curl -s -X POST http://localhost:3200/api/sources/probe -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"RSS","params":{"feedUrl":"http://socialharness-fixture/feed.xml"}}'
```

Swagger: `http://localhost:3200/api/docs` (botón *Authorize* con el token del paso 2).

---

## Verificación de esta entrega (2026-09-21)

Ejercitado contra el stack real, no solo con tests:

- `npm run check` → **341 tests en 39 archivos** + `tsc --noEmit` sin errores · `npm run build` OK.
- **Guard**: `/api/health` responde sin token; `/api/profiles` sin token → **401**.
- **Arranque desde base vacía** (el escenario del server): `ensure-database` (base + extensión) →
  `migrate deploy` (las 7 migraciones) → `ensure-index` (índice HNSW) → seed → escuchando, con **0
  reinicios** del contenedor. Antes de este arreglo, ese mismo arranque fallaba con `relation "Signal"
  does not exist` y reiniciaba en bucle.

### Fases 4 y 5: borradores, medición y el dashboard (con IA real)

- **Borrador real** (DeepSeek) pedido a mano: caption, guion, **3 arranques alternativos** y un cierre que
  invita a comentar, escrito con el material de las señales y sin datos inventados. Editarlo quedó
  marcado (`editedByUser: true`) y regenerar crea la versión siguiente.
- **"Ya publiqué"** con enlace: la idea quedó `PUBLISHED` con `publishedUrl` (y un aviso `IDEAS_READY`
  previo en la bandeja).
- **CSV de métricas**: 3 días importados; al **reimportar el mismo CSV** siguen siendo **3 snapshots**
  (no 6) con los valores actualizados: la regla de "un día por cuenta" se cumple.
- **Reporte de rendimiento** (DeepSeek) con 3 días de métricas y 1 publicación: calculó los deltas
  (1000 → 1185 seguidores, 136.000 de alcance, engagement 3,7 %) y **declaró lo que no puede sostener**
  ("solo 3 de 30 días medidos", "la única publicación es de LinkedIn y las métricas son de Instagram:
  el resultado de esa pieza es indeterminado"). Es exactamente el comportamiento pedido en el prompt.
- **El modelo encontró un hueco real**: cuestionó que el engagement fuera inconsistente con los conteos
  crudos y pidió documentar la fórmula. Tenía razón en que el prompt no decía qué significa el número;
  se aclaró (viene dado por la plataforma y promediado) y se le pidió no recalcularlo.
- **Gasto**: 10 llamadas medidas en `CoachRun` (analyze, ideas, draft, performance) con 9.448 tokens de
  entrada y 18.646 de salida, latencias de 3-15 s. El costo sigue en 0 porque el modelo real
  (`deepseek-flash`) no está en la tabla de precios.
- **Pestaña del dashboard**: `npm run build` compila las 8 vistas de `/social` y `tsc` limpio. La
  verificación visual queda para el navegador del usuario (la pestaña necesita su sesión de atiende).

### Fase 3: análisis, ideas y avisos (con IA real)

- **Pipeline completo en una corrida**: recolección → ingestión → análisis → ideas → avisos.
  Medido con DeepSeek: análisis con **una sola llamada** por ciclo (las 3 fuentes del fixture se
  agruparon: `analyzed: 11`, `usedLlm: true`), y con dos inspiraciones que sí tocan el nicho:
  **`topScore: 95`** → `ideas: true` → **2 ideas creadas** por el modelo.
- **La calidad de las ideas** (lo que devolvió el modelo con esas dos señales): título, hook, ángulo y un
  `whyNow` atado a cada señal; plataforma y formato validados contra el catálogo
  (`LINKEDIN/CAROUSEL` y `LINKEDIN/POST`) y programadas en días hábiles a las 10.
- **Lo pegado a mano también se analiza**: al pegar una inspiración se encola el análisis de ese perfil.
- **Gasto medido** en `CoachRun`: 4 filas con tokens de entrada/salida (p. ej. `analyze 929/1001`,
  `ideas 1198/2456`) y latencias de 3-12 s. El **costo sigue en 0** porque el modelo que devuelve la API
  (`deepseek-flash`) no está en la tabla de precios: se arregla poniendo el precio en
  `LLM_PRICE_*_PER_1M` (ya documentado).
- **Avisos**: `SIGNALS_READY`, `IDEAS_READY` y `COLLECTION_FAILED` en la bandeja, con `profileId` (se
  ven bajo el perfil que corresponda).
- **La carrera de concurrencia, verificada**: al reintentar la recolección con las señales borradas,
  las 3 corridas quedaron **OK** y una contó el enlace compartido como `alreadyKnown: 1` (antes una
  fallaba con `Unique constraint failed on fingerprint`).
- **Idempotencia del análisis**: un segundo ciclo sin señales nuevas no gasta IA
  (`skipped: "No hay señales nuevas que analizar."`).

### Fase 2: la recolección, de punta a punta

Con el perfil del seed apuntando a las 3 fuentes del fixture:

- `POST /profiles/:id/run` → **202**, `sourcesDispatched=3`, `skipped=0`. Los workers registraron las 3
  corridas: 4 items (feed), 5 (página pública) y 3 (noticias) con sus estadísticas.
- **Dedup por URL canónica comprobado con datos reales**: el feed de noticias trajo **3 items y solo 2
  eran nuevos** — el tercero es el mismo enlace del otro feed con `utm_source=news&utm_campaign=…`, y
  la canonicalización lo unió.
- **Idempotencia**: una segunda corrida de las 3 fuentes → **0 nuevos** (`alreadyKnown` 3, 4 y 5). Es lo
  que hace seguro reintentar cualquier corrida.
- Resultado en la base: **11 señales**, 11 `ProfileSignal` (una por señal, para el perfil suscrito) y 6
  corridas auditadas. **Las 11 señales quedaron con su vector** en `Signal.embedding` (prueba de que la
  escritura cruda a pgvector funciona).
- `GET /signals` devuelve las 11 con su fuente, tipo y relevancia (0 = todavía no se analizó, eso es la
  fase 3); el filtro `?platform=YOUTUBE` devuelve 0 porque no hay llave de YouTube.
- **Pegado manual**: pegar un texto crea una inspiración para ese perfil; pegarlo otra vez **no la
  duplica** (mismo id, `created: false`); pegar una URL con `utm_*` guarda la original pero deduplica por
  la canónica.
- **Aislamiento en la Redis compartida, con llaves vivas**: 19 llaves en total y **todas** con el
  prefijo `socialharness:` (`socialharness:collect:*`, `socialharness:schedule:repeat:*`), ninguna de
  `cvharness` ni `atiende`.
- **El índice HNSW lo asegura el boot**: `[ensure-database] índice HNSW de señales listo`.

### Fase 1 y 0 (ya verificadas antes)

- **Perfiles**: crear → dueño del token y `nextRunAt` armado; con cadencia `null` sin corrida automática.
  Agregar LINKEDIN y TIKTOK → OK; una red fuera del catálogo (`MYSPACE`) → **400**; quitar TikTok → el
  perfil quedó con LinkedIn; borrar el perfil → **204** y los hijos se fueron en cascada.
- **Probe real contra el fixture**: RSS → 4 items; página pública → 5 items con **métricas bien
  convertidas** (1.2M → 1200000) y **fecha del atributo `datetime`**; receta mala → `verified=false` con
  diagnóstico `item=0`; params malos → **400** con `{"field":"feedUrl","message":"Falta esta URL…"}`.

---

## Bugs reales encontrados y arreglados en esta ronda

| Bug | Cómo se detectó | Arreglo |
| --- | --- | --- |
| `parseMetricNumber('1.2M')` daba **12 millones** | Test: el separador decimal se trataba como de miles | Se distingue decimal (1.2) de miles (1.200) antes de multiplicar |
| La fecha de una tarjeta salía **2001** | Test: se leía el texto "18 sep" en vez del atributo `datetime` | Se prefiere el atributo máquina (`datetime`/`content`) |
| El aviso de "items sin fecha" contaba items ya descartados | Test: `itemsWithoutDate=2` esperando 1 | Se cuenta sobre los items que se van a usar |
| El mensaje de "selector obligatorio" no aparecía si faltaba la clave | Test: Zod devolvía "Required" | `required_error` explícito (y también en las URLs) |
| `setSources` dejaba `nextRunAt` en `null` (mataba la cadencia) | Revisión del propio servicio | Se rearma la corrida al cambiar fuentes/cadencia |
| **Faltaba la columna `Signal.summary`**: la ingestión recibía el resumen y lo tiraba | El compilador, al filtrar por `summary` en la búsqueda | Columna nueva (una señal sin resumen es solo un título, y el análisis no tiene qué embeber) |
| `Source.nextRunAt` es obligatorio y lo traté como opcional | El compilador | Se dejó el default; el que manda es `enabled` |
| **Cada `migrate dev` genera un `DROP INDEX` del HNSW** (Prisma no puede ver ese índice) | Se aplicó una migración y el índice desapareció | El índice pasó a asegurarlo el **boot** (`ensure-database`), idempotente; y se limpia el `DROP INDEX` de cada migración |
| Quedaron **dos migraciones duplicadas** y una vacía (por correr `migrate dev` dos veces) | Revisión de la carpeta de migraciones | Se borró la vacía, se corrigió la otra y se re-aplicó todo con `migrate reset` (que además valida la instalación limpia) |
| Corrí `migrate reset` **en paralelo** con la edición del archivo de migración (aplicó la versión vieja) | El índice aparecía y desaparecía según la corrida | Lección: no paralelizar un reset con la edición de la migración |
| **Carrera en el dedup**: dos fuentes en paralelo con la misma URL canónica pasaban las dos el `findUnique` y una reventaba con `Unique constraint failed on fingerprint` | El E2E: una corrida quedó FAILED con ese error y avisó `COLLECTION_FAILED` | El `create` de la señal maneja `P2002` y lo cuenta como "ya conocida" (la garantía la da el índice, no el chequeo previo) |
| **El análisis se hacía dos veces por ciclo** (una por fuente) en vez de una por perfil | Los logs del E2E: 2 llamadas de IA para el mismo perfil | `jobId` **por minuto** + pequeño retraso: las fuentes de un ciclo se agrupan en una llamada y un ciclo posterior sí encola (sin caer en la trampa del `jobId` fijo) |
| **Pegar una inspiración no la analizaba** hasta la próxima recolección (que podía no traer nada nuevo) | Prueba manual del flujo | El pegado manual encola el análisis del perfil |
| El puerto de IA infería el tipo de **entrada** del schema Zod, así que un campo con `default` llegaba opcional al llamador | El compilador, en 4 lugares | `z.ZodType<T, z.ZodTypeDef, any>`: el genérico se infiere con la **salida** (con los `default` aplicados) |
| **Dos clics en el mismo milisegundo** generaban el mismo `jobId` y BullMQ se comía el segundo pedido, en silencio | Un test que pedía dos borradores seguidos: solo encolaba uno | Los pedidos manuales (borrador, ideas, reporte) van **sin `jobId`**: cada clic es un trabajo. El único que deduplica es el análisis, y ahí es a propósito |
| El prompt del reporte no decía **qué significa** `engagementRate`, así que el modelo lo comparó con los conteos crudos y lo declaró inconsistente | Lo detectó el propio modelo en el reporte | El prompt aclara que la tasa la reporta la plataforma y viene promediada, y le prohíbe recalcularla |
| El contenedor no recompilaba al editar (watcher muerto por el bind mount de OneDrive) | Al probar un cambio de mensaje: el archivo llegaba pero el watch no reaccionaba | Documentado con workaround (`docker compose restart api`); se probó `TSC_WATCHFILE` y **no** lo arregla |
| El `docker:infra:up` no funcionaba solo | Falló al levantar la infra | Los scripts pasan los dos compose y arrancan/paran `postgres` |
| **El índice HNSW se creaba ANTES de migrar**: en una base vacía la tabla `Signal` no existe todavía → `relation "Signal" does not exist` (42P01) → el script salía con 1 y el contenedor **reiniciaba en bucle** | Al desplegar en el server (base nueva). Localmente no se veía porque la base ya tenía las tablas de fases anteriores | `ensure-database` quedó con lo que va antes de migrar (base + extensión); el índice pasó a `ensure-index.ts`, que corre **después** de `migrate deploy` y es tolerante (avisa y sigue: el índice es performance, no correctitud). Verificado con base vacía |
| **La migración `init` creaba el índice HNSW**: si ese `CREATE INDEX` falla en el server (pgvector viejo o sin soporte), falla **toda** la migración y Prisma bloquea el arranque con `P3009` ("migrate found failed migrations") | Al desplegar: `The 20260920000000_init migration ... failed` | El índice salió de la migración (lo asegura el boot, tolerante) y `ensure-index` ahora **imprime la versión de pgvector** y explica el requisito (HNSW ≥ 0.5.0) con el `ALTER EXTENSION vector UPDATE` en el mensaje |

---

## Límites conocidos (a propósito)

- **LinkedIn no se scrapea** (ToS): sus señales entran por inspiración manual, RSS y Google Trends. Está
  escrito en la ficha de la red, no es un olvido.
- **Embeddings en `mock`**: la cuenta de OpenAI responde *no credits*, así que la similitud funciona
  pero **no es semántica** (`GET /config` lo reporta como `semantic: false`). Al cargar créditos se
  cambia `EMBEDDING_PROVIDER` **y hay que re-embebir** lo guardado.
- **El gasto de IA se registra en 0** hasta poner el precio del modelo en `LLM_PRICE_*_PER_1M`.
- **Sin aislamiento estricto para el perfil del seed** (`ownerId = null` = compartido). Al crear
  perfiles desde la API ya nacen con dueño.
- **El catálogo de fuentes es compartido**: cualquiera que entre ve las URLs guardadas (decisión
  tomada, ver el ADR de arquitectura).
