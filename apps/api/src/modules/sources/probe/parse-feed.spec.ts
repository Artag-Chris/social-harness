import { describe, expect, it } from 'vitest';
import { parseFeed } from './parse-feed';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Nicho (prueba)</title>
    <item>
      <title>El formato de 3 actos</title>
      <link>https://ejemplo.com/formato-3-actos</link>
      <author>equipo@ejemplo.com (Equipo)</author>
      <pubDate>Fri, 18 Sep 2026 14:00:00 GMT</pubDate>
      <description>Analizamos 120 videos cortos.</description>
    </item>
    <item>
      <title>Sin fecha</title>
      <link>https://ejemplo.com/sin-fecha</link>
      <description>Item sin pubDate.</description>
    </item>
    <item>
      <title>Sin enlace</title>
      <description>Este no tiene link.</description>
    </item>
  </channel>
</rss>`;

describe('parseFeed', () => {
  it('lee los items con título, enlace, autor, fecha y resumen', async () => {
    const feed = await parseFeed(FEED);

    expect(feed.title).toBe('Nicho (prueba)');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      title: 'El formato de 3 actos',
      url: 'https://ejemplo.com/formato-3-actos',
      publishedAt: new Date('2026-09-18T14:00:00.000Z').toISOString(),
    });
    expect(feed.items[0]?.summary).toContain('120 videos');
  });

  it('descarta los items sin enlace (no se pueden deduplicar) y lo avisa', async () => {
    const feed = await parseFeed(FEED);

    expect(feed.items.map((item) => item.title)).not.toContain('Sin enlace');
    expect(feed.warnings.join(' ')).toContain('no traían enlace');
  });

  it('avisa de los items sin fecha (entran, pero no se pueden ordenar)', async () => {
    const feed = await parseFeed(FEED);

    expect(feed.itemsWithoutDate).toBe(1);
    expect(feed.warnings.join(' ')).toContain('sin fecha');
  });

  it('falla con un mensaje claro si el contenido no es un feed', async () => {
    await expect(parseFeed('<html><body>No soy un feed</body></html>')).rejects.toThrow();
  });

  it('un feed válido sin items no es un error, pero no verifica nada', async () => {
    const feed = await parseFeed('<?xml version="1.0"?><rss version="2.0"><channel><title>Vacío</title></channel></rss>');

    expect(feed.items).toEqual([]);
  });
});
