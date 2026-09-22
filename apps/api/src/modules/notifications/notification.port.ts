/**
 * Puerto de notificaciones (patrón adaptador, ver `docs/adr-003`).
 *
 * El que avisa (el pipeline) no elige el transporte: llama `notify(event)` y el
 * puerto reparte. Hoy hay un solo adaptador (`dashboard`, que escribe la fila de la
 * bandeja); mañana se suman WhatsApp y Discord registrando un adaptador y
 * agregándolos a `NOTIFY_CHANNELS`, sin tocar a quien emite.
 *
 * Los canales externos son **fail-soft**: si un canal falla, el aviso ya quedó en
 * la bandeja y el error se registra — nunca se pierde una notificación por un
 * webhook caído.
 */

export type NotificationType =
  | 'IDEAS_READY'
  | 'SIGNALS_READY'
  | 'COLLECTION_FAILED'
  | 'INFO';

export interface NotificationEvent {
  type: NotificationType;
  title: string;
  body: string;
  /** A qué perfil pertenece (null = aviso del sistema). */
  profileId?: string | null;
  /** Datos para que el canal los formatee como quiera. */
  payload?: Record<string, unknown>;
}

export interface NotificationPort {
  /** Nombre del canal (`dashboard`, `whatsapp`, `discord`…). */
  readonly channel: string;
  send(event: NotificationEvent): Promise<void>;
}

/** Token con los adaptadores de aviso resueltos por `NOTIFY_CHANNELS`. */
export const NOTIFICATION_CHANNELS_TOKEN = 'NOTIFICATION_CHANNELS_TOKEN';
