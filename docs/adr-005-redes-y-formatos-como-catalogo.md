# ADR-005 — Redes y formatos como catálogo (agregar o quitar una red no cuesta una migración)

Estado: aceptado (2026-09-21) — **implementado y verificado**

## Contexto

El usuario pidió **sumar LinkedIn** y dejó explícito el criterio: *agregar o quitarle una red social a
un perfil no debería ser duro*.

Hasta acá `Platform` (INSTAGRAM, TIKTOK, YOUTUBE) y `IdeaFormat` (REEL, SHORT, CAROUSEL, POST, STORY)
eran **enums de Postgres** definidos en el schema de Prisma. Con eso:

- **Agregar una red** exigía una migración (`ALTER TYPE ... ADD VALUE`) en cada deploy, más regenerar
  el cliente y volver a desplegar. Además el valor nuevo no se puede usar dentro de la misma
  transacción, así que una migración que agregue la red *y* datos que la usen no es posible.
- **Quitar una red era imposible**: Postgres no permite borrar un valor de un enum sin recrear el tipo
  entero (y con él, todas las columnas que lo usan).

Es decir: el modelo de datos era el que hacía "duro" algo que debería ser trivial, justo en un
dominio donde las redes y los formatos cambian seguido (LinkedIn entró después de la v1; cada red
inventa formatos cada año).

## Decisiones

1. **Redes y formatos viven en un catálogo de código**
   (`modules/platforms/platforms.catalog.ts`), y en la base se guarda **texto** validado en la
   frontera con Zod. Agregar LinkedIn fue: una clave en `PLATFORM_KEYS`, su definición en `PLATFORMS`,
   sus formatos y nada más. **Cero migraciones** para la próxima red.

2. **Se guarda con la MISMA forma que el enum** (MAYÚSCULAS): la migración solo cambia el tipo de la
   columna, sin reescribir una sola fila.

3. **Lo que sigue siendo enum.** No se convirtió todo por moda: `SourceKind` (tipos de fuente),
   `SignalKind`, `SignalStatus`, `ProfileSignalStatus`, `IdeaStatus`, `ObjectiveStatus`,
   `MetricSource`, `CollectionRunStatus` y `ObjectiveMetric` siguen siendo enums de Postgres. El
   criterio es simple: **si cambiar un valor obliga a tocar código de todos modos** (un conector nuevo
   necesita su adaptador, un estado nuevo necesita sus transiciones), el enum aporta integridad
   gratis. Si el valor es *dato* que el usuario elige y que el dominio agrega seguido (redes,
   formatos), va a catálogo.

4. **Validación de la relación red ↔ formato.** El catálogo sabe qué formatos existen en cada red:
   `PlatformFormatSchema` rechaza un `POLL` en Instagram. El enum de la base no podía expresar esto
   (el tipo pasaba sin chistar).

5. **`GET /platforms` para que el front no hardcodee nada.** La pestaña Social arma sus selectores
   desde el catálogo: sumar una red es tocar el backend, y el dashboard la muestra sin cambios. Sin
   esto, cada red nueva obligaría a un PR en dos repos.

6. **La definición de la plataforma incluye lo que el coach necesita para aconsejar bien**: qué
   formatos ofrece y cuáles se sugieren por defecto, si es video-first, la heurística de horarios, la
   política de hashtags, la guía de contenido para los prompts, **de dónde se sacan las tendencias**
   (`api` / `public-web` / `manual`) y **si el scraping está permitido**. LinkedIn, por ejemplo, queda
   con `scrapingAllowed: false` y `trendsStrategy: 'manual'`: la decisión de ToS del ADR-001 queda
   escrita en el código, no en un comentario perdido.

7. **La migración a texto se escribió a mano.** El SQL que genera Prisma para este cambio **dropea y
   recrea las columnas** ("No cast exists... would lead to data loss"), lo que además se llevaba por
   delante el índice HNSW de `Signal.embedding`. Se reemplazó por un `ALTER COLUMN ... SET DATA TYPE
   TEXT USING "col"::text` explícito, que conserva filas, nulabilidad e índices (Postgres los
   reconstruye solo).

### Cómo agregar una red (el procedimiento)

```ts
// 1. platforms.catalog.ts
export const PLATFORM_KEYS = [..., 'NUEVA_RED'] as const;
export const PLATFORMS = { ..., NUEVA_RED: { key: 'NUEVA_RED', label: '...', formats: [...], ... } };
// 2. Si trae formatos nuevos, sumarlos a FORMAT_KEYS + FORMATS.
// 3. Listo: validación, GET /platforms y UI se actualizan solos. No hay migración.
```

Y para un perfil: **agregarle una red es crear una fila en `SocialAccount`; quitársela, borrarla.**
(La UI de eso llega en la fase 1: `POST/PATCH/DELETE /profiles/:id/accounts`.)

## Evidencia medida (2026-09-21)

- **Migración sin pérdida de datos**: antes había 3 cuentas (`INSTAGRAM, TIKTOK, YOUTUBE`); después de
  `migrate deploy` siguen **las 3 con sus mismos valores**, las 4 columnas quedaron en `text` con la
  nulabilidad correcta, los enums `Platform`/`IdeaFormat` desaparecieron y **los 3 índices siguen ahí**
  (`Signal_embedding_hnsw_idx`, `Signal_platform_publishedAt_idx`,
  `SocialAccount_profileId_platform_handle_key`).
- **LinkedIn en el perfil de ejemplo**: el seed quedó con **4 cuentas**
  (`INSTAGRAM, LINKEDIN, TIKTOK, YOUTUBE`).
- **`GET /platforms`** devuelve las 4 redes con sus formatos y su detalle:
  `LinkedIn → POST, CAROUSEL, VIDEO, ARTICLE, POLL` (por defecto POST y CAROUSEL).
- `npm run check` → **144 tests en 13 archivos** + `tsc` limpio.
- **Bug encontrado por el E2E**: la imagen del contenedor tenía el **cliente Prisma viejo** (generado
  al construir, con los enums), así que el seed fallaba al compilar *dentro* de Docker aunque en el
  host pasara. Se arregló de raíz agregando `npx prisma generate` al CMD del boot, así que un cambio
  de schema ya no deja ese pie de banco.

## Consecuencias

- La integridad de `platform`/`format` vive en la aplicación (catálogo + Zod), **no** en la base: un
  `INSERT` a mano por fuera de la app podría guardar cualquier texto. Se acepta a cambio de poder
  agregar y quitar redes sin migraciones; es una decisión explícita, no un descuido.
- Los formatos se validan **contra la red**, así que no se puede crear una idea de "Poll de Instagram".
- Agregar una red que requiera **scraping propio o una API nueva** sí implica trabajo de adaptador
  (los conectores son otro catálogo, con su factory) — lo barato es el modelo de datos y la UI, no
  traer datos de una red que no los expone.
- El catálogo es el lugar donde mirar cuando una red cambie sus formatos: es un archivo, no una
  migración.
