# ADR-003 — Notificaciones (puerto) y publicación (SIEMPRE humana)

Estado: **notificaciones = fase 1 (solo adaptador `dashboard`). Adaptadores WhatsApp/Discord y el
`PublishPort` = propuestos / diferidos — NO implementados.**

## Contexto

Dos capacidades distintas que conviene no mezclar:

1. **Avisar**: "hay ideas nuevas", "toca postear hoy", "una fuente falló", "tu engagement bajó".
   Hoy alcanza con verlo en el dashboard, pero es seguro que mañana se querrá WhatsApp (el propio)
   y después Discord. La forma del mensaje es la misma; **cambia el transporte**.
2. **Publicar**: subir la pieza a Instagram/TikTok/YouTube. Acá hay una **regla de producto dura**
   del usuario: *la IA no publica sola*, porque una cuenta que postea automáticamente deja de
   parecer humana y eso atenta contra el objetivo (crecer como persona/marca).

## Decisión 1 — Notificaciones detrás de un puerto

`NotificationPort` con un adaptador por canal, resuelto por `NOTIFY_CHANNELS` (CSV, `auto` con
fallbacks). Fase 1 activa **solo** `dashboard`:

| Adaptador | Estado | Transporte |
| --- | --- | --- |
| `dashboard` | **implementado** | fila en `Notification` (bandeja), la pestaña la lee por polling |
| `whatsapp` | base futura | WhatsApp Cloud API (mismo proveedor que ya usa `atiende`) |
| `discord` | base futura | webhook de canal |

Reglas:
- El productor de la notificación **no elige el transporte**: llama `notify(event)` y el puerto
  reparte. Sumar Discord = registrar un adaptador + agregarlo a `NOTIFY_CHANNELS`.
- El evento tiene un `payload` JSON versionado (`type`, `profileId`, `title`, `body`, `payload`), así
  que un adaptador nuevo puede formatear distinto sin tocar a quien lo emitió.
- **Fail-soft**: si un canal externo falla, la fila en BD ya quedó (el dashboard siempre recibe
  el aviso) y el fallo se registra; nunca se pierde la notificación por un webhook caído.
- Los canales que salen del proceso se agregan **sin** romper la promesa de "una sola sesión": no
  autentican al usuario, solo empujan texto.

### Migración prevista (aditiva)

```sql
-- Ninguna: Notification ya nace con profileId y payload.
-- Cuando exista un canal externo se agrega, por canal, el estado de entrega:
CREATE TABLE "NotificationDelivery" (
  "id"             TEXT PRIMARY KEY,
  "notificationId" TEXT NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE,
  "channel"        TEXT NOT NULL,          -- whatsapp | discord | ...
  "status"         TEXT NOT NULL,          -- SENT | FAILED
  "error"          TEXT,
  "attemptedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "NotificationDelivery_unique_idx"
  ON "NotificationDelivery"("notificationId", "channel");
```

## Decisión 2 — Publicación: `PublishPort` diseñado, apagado por diseño

No se implementa nada de publicación en v1. Cuando se implemente (si el usuario lo pide), el diseño
**obligatorio** es:

1. **Solo por acción humana explícita.** El endpoint de publicación exige que la idea esté en
   estado `APPROVED` y que un humano la haya confirmado; **no existe** camino desde el pipeline ni
   desde el scheduler. Igual que los borradores y las acciones caras: botón, no automatismo.
2. **Por plataforma y con revisión previa.** Un adaptador por red; sin adaptador aprobado, la idea se
   puede exportar/copiar pero no publicar. La pieza se muestra tal cual va a salir antes de enviarla.
3. **Trazabilidad total.** `PostLog` (o `ContentIdea.publishedAt` + `publishedUrl`) registra qué se
   publicó, cuándo, en qué cuenta y con qué id externo, para poder atribuir el rendimiento después.
4. **Idempotencia.** Un `externalId` por plataforma más índice único: un doble click no publica dos
   veces.
5. **Degradación honesta.** Si la plataforma no tiene API de publicación viable (TikTok/Instagram sin
   app aprobada), el harness **no finge**: deja la pieza lista para copiar/exportar y lo dice.

### Migración prevista (aditiva)

```sql
ALTER TABLE "ContentIdea"  ADD COLUMN "publishedUrl" TEXT;
ALTER TABLE "ContentIdea"  ADD COLUMN "publishedExternalId" TEXT;
ALTER TABLE "ContentIdea"  ADD COLUMN "publishedAccountId" TEXT;
CREATE UNIQUE INDEX "ContentIdea_publishedExternalId_idx"
  ON "ContentIdea"("publishedAccountId", "publishedExternalId");
```

## Consecuencias

- Hoy: el usuario ve todo en la pestaña Social del dashboard y **él** publica a mano; el harness deja
  la pieza lista (borrador + copy/export) y registra "ya publiqué" para medir después.
- Mañana: sumar un canal de aviso o una red de publicación es registrar un adaptador y tocar
  `.env`; ni el pipeline ni el modelo de datos cambian.
- La invariante que **nunca** se rompe: nada sale del harness hacia una red social sin que una
  persona lo haya aprobado y disparado.
