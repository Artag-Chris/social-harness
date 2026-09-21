import { describe, expect, it } from 'vitest';
import { SignalKind } from '@prisma/client';
import { fetchOptionsFrom, resolveTitle, toSignalDraft } from './signal-mapping';

describe('toSignalDraft', () => {
  const base = { kind: SignalKind.NEWS, baseUrl: 'https://ejemplo.com/feed.xml' };

  it('convierte un item del motor en un draft del pipeline', () => {
    const draft = toSignalDraft(
      {
        title: 'Un título',
        url: 'https://ejemplo.com/a',
        author: 'Equipo',
        publishedAt: '2026-09-18T14:00:00.000Z',
        summary: 'Resumen',
        metrics: { views: 10 },
      },
      { ...base, keywords: ['ia'] },
    );

    expect(draft).toMatchObject({
      kind: SignalKind.NEWS,
      title: 'Un título',
      url: 'https://ejemplo.com/a',
      author: 'Equipo',
      keywords: ['ia'],
      metrics: { views: 10 },
    });
    expect(draft?.publishedAt).toBeInstanceOf(Date);
  });

  it('descarta el item sin URL: sin URL no hay dedup posible', () => {
    expect(toSignalDraft({ title: 'Solo título', url: '' }, base)).toBeNull();
  });

  it('resuelve URLs relativas contra la base', () => {
    const draft = toSignalDraft({ title: 'T', url: '/relativo' }, base);
    expect(draft?.url).toBe('https://ejemplo.com/relativo');
  });

  it('usa las keywords del item si vienen (y si no, las del contexto)', () => {
    const conItem = toSignalDraft({ title: 'T', url: 'https://e.com/1', keywords: ['propia'] }, {
      ...base,
      keywords: ['contexto'],
    });
    expect(conItem?.keywords).toEqual(['propia']);

    const sinItem = toSignalDraft({ title: 'T', url: 'https://e.com/2' }, { ...base, keywords: ['contexto'] });
    expect(sinItem?.keywords).toEqual(['contexto']);
  });

  it('una fecha inválida no rompe: queda en null', () => {
    expect(toSignalDraft({ title: 'T', url: 'https://e.com/3', publishedAt: 'ayer' }, base)?.publishedAt).toBeNull();
  });
});

describe('resolveTitle', () => {
  it('usa el título cuando existe', () => {
    expect(resolveTitle('Un título', 'https://e.com/x')).toBe('Un título');
  });

  it('cuando el motor no encontró título, usa la parte final de la URL', () => {
    expect(resolveTitle('(sin título)', 'https://e.com/como-hacer-un-reel')).toBe('como hacer un reel');
  });
});

describe('fetchOptionsFrom', () => {
  it('traduce los límites de la fuente a opciones de red (y omite lo no definido)', () => {
    expect(fetchOptionsFrom({ timeoutMs: 5000 })).toEqual({
      timeoutMs: 5000,
      userAgent: undefined,
      headers: undefined,
    });
    expect(fetchOptionsFrom()).toEqual({ timeoutMs: undefined, userAgent: undefined, headers: undefined });
  });
});
