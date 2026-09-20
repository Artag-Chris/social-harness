import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_URL,
  databaseNameFromUrl,
  resolveDatabaseUrl,
  withDatabase,
} from './database-url';

describe('resolveDatabaseUrl', () => {
  it('usa DATABASE_URL cuando viene explícita', () => {
    const url = resolveDatabaseUrl({
      DATABASE_URL: 'postgresql://u:p@db:5432/mia?schema=public',
      DATABASE_HOST: 'ignorado',
    });
    expect(url).toBe('postgresql://u:p@db:5432/mia?schema=public');
  });

  it('deriva la URL de DATABASE_HOST + POSTGRES_* (patrón del server)', () => {
    const url = resolveDatabaseUrl({
      DATABASE_HOST: 'atiende-postgres',
      DATABASE_PORT: '5432',
      POSTGRES_USER: 'atiende',
      POSTGRES_PASSWORD: 'atiende_dev',
      POSTGRES_DB: 'socialharness',
    });
    expect(url).toBe('postgresql://atiende:atiende_dev@atiende-postgres:5432/socialharness?schema=public');
  });

  it('escapa caracteres especiales del password', () => {
    const url = resolveDatabaseUrl({
      DATABASE_HOST: 'host',
      POSTGRES_PASSWORD: 'p@ss/word',
    });
    expect(url).toContain('p%40ss%2Fword@');
  });

  it('cae al default de dev local cuando no hay ninguna variable', () => {
    expect(resolveDatabaseUrl({})).toBe(DEFAULT_DATABASE_URL);
  });

  it('ignora DATABASE_URL vacía o con solo espacios', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '   ' })).toBe(DEFAULT_DATABASE_URL);
  });
});

describe('databaseNameFromUrl', () => {
  it('extrae el nombre de la base', () => {
    expect(databaseNameFromUrl('postgresql://u:p@host:5432/socialharness?schema=public')).toBe(
      'socialharness',
    );
  });

  it('falla si no hay nombre de base', () => {
    expect(() => databaseNameFromUrl('postgresql://u:p@host:5432/')).toThrow();
  });
});

describe('withDatabase', () => {
  it('cambia la base conservando host, puerto y credenciales', () => {
    const admin = withDatabase('postgresql://u:p@host:5432/socialharness?schema=public', 'postgres');
    expect(admin).toContain('/postgres?');
    expect(admin).toContain('u:p@host:5432');
  });
});
