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
| 2 | Conectores que recolectan + ingestión con dedup + scheduler por perfil | pendiente |
| 3 | Análisis de relevancia + ideas y calendario + avisos | pendiente |
| 4 | Borradores a demanda + "ya publiqué" + métricas y reporte de rendimiento | pendiente |
| 5 | Pestaña "Social Coach" en el dashboard | pendiente |
| 6 | Verificación E2E en el server + publicación de canal de avisos | pendiente |

**Lo que NO existe todavía** (para no buscarlo en vano): recolección automática de señales, ideas,
calendario, borradores, métricas, notificaciones y la pestaña en el dashboard. Hay endpoints de
configuración y catálogo, y la IA ya resuelta, esperando a la fase 2.

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

- `npm run check` → **212 tests en 22 archivos** + `tsc --noEmit` sin errores · `npm run build` OK.
- **Guard**: `/api/health` responde sin token; `/api/profiles` sin token → **401**.
- **Perfiles**: crear → quedó con `ownerId` del token y `nextRunAt` armado; con cadencia `null` quedó
  sin corrida automática. Detalle con cuentas/objetivos/fuentes. Borrar → **204** y los hijos se van en
  cascada (la BD volvió a 1 perfil / 4 cuentas / 3 objetivos / 3 selecciones).
- **Redes**: agregar LinkedIn y TikTok → OK; una red fuera del catálogo (`MYSPACE`) → **400**;
  quitar TikTok → el perfil quedó con LinkedIn.
- **Probe real contra el fixture**: RSS → `verified=true`, 4 items con título y URL. Página pública →
  `verified=true`, 5 items, **métricas bien convertidas** (1.2M → 1200000) y **fecha del atributo
  `datetime`**. Receta con selector equivocado → `verified=false` con aviso explicando y diagnóstico
  `item=0`. Params con forma equivocada → **400** con `{"field":"feedUrl","message":"Falta esta URL…"}`.
- **Fuentes**: catálogo con las 3 del fixture y en qué perfiles se usan; seleccionar 2 para un perfil →
  quedaron con `enabled=true` y la corrida se rearmó.
- **Config**: `llm=deepseek/deepseek-v4-flash`, embeddings `mock` (`semantic=false`), cadencia
  `[null, 1, 3, 6, 12, 24, 72, 168]` horas.

---

## Bugs reales encontrados y arreglados en esta ronda

| Bug | Cómo se detectó | Arreglo |
| --- | --- | --- |
| `parseMetricNumber('1.2M')` daba **12 millones** | Test: el separador decimal se trataba como de miles | Se distingue decimal (1.2) de miles (1.200) antes de multiplicar |
| La fecha de una tarjeta salía **2001** | Test: se leía el texto "18 sep" en vez del atributo `datetime` | Se prefiere el atributo máquina (`datetime`/`content`) |
| El aviso de "items sin fecha" contaba items ya descartados | Test: `itemsWithoutDate=2` esperando 1 | Se cuenta sobre los items que se van a usar |
| El mensaje de "selector obligatorio" no aparecía si faltaba la clave | Test: Zod devolvía "Required" | `required_error` explícito (y también en las URLs) |
| `setSources` dejaba `nextRunAt` en `null` (mataba la cadencia) | Revisión del propio servicio | Se rearma la corrida al cambiar fuentes/cadencia |
| El contenedor no recompilaba al editar (watcher muerto por el bind mount de OneDrive) | Al probar un cambio de mensaje: el archivo llegaba pero el watch no reaccionaba | Documentado con workaround (`docker compose restart api`); se probó `TSC_WATCHFILE` y **no** lo arregla |
| El `docker:infra:up` no funcionaba solo | Falló al levantar la infra | Los scripts pasan los dos compose y arrancan/paran `postgres` |

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
