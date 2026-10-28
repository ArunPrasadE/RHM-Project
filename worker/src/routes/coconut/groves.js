import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/coconut/groves - List all groves
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const groves = await db.prepare(`
      SELECT * FROM coconut_groves
      WHERE is_active = 1
      ORDER BY name
    `).all();

    return c.json(groves);
  } catch (error) {
    console.error('Error fetching coconut groves:', error);
    return c.json({ error: 'Failed to fetch coconut groves' }, 500);
  }
});

// GET /api/coconut/groves/:id
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const grove = await db.prepare(`
      SELECT * FROM coconut_groves
      WHERE id = ? AND is_active = 1
    `).get(c.req.param('id'));

    if (!grove) {
      return c.json({ error: 'Grove not found' }, 404);
    }

    return c.json(grove);
  } catch (error) {
    console.error('Error fetching grove:', error);
    return c.json({ error: 'Failed to fetch grove' }, 500);
  }
});

// POST /api/coconut/groves
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const { name, area_cents, gps_latitude, gps_longitude, google_maps_url } = await c.req.json().catch(() => ({}));

    if (!name || !area_cents) {
      return c.json({ error: 'Name and area are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO coconut_groves (name, area_cents, gps_latitude, gps_longitude, google_maps_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, area_cents, gps_latitude, gps_longitude, google_maps_url);

    const newGrove = await db.prepare('SELECT * FROM coconut_groves WHERE id = ?').get(result.lastInsertRowid);
    return c.json(newGrove, 201);
  } catch (error) {
    console.error('Error creating grove:', error);
    return c.json({ error: 'Failed to create grove' }, 500);
  }
});

// PUT /api/coconut/groves/:id
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const { name, area_cents, gps_latitude, gps_longitude, google_maps_url } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM coconut_groves WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Grove not found' }, 404);
    }

    await db.prepare(`
      UPDATE coconut_groves
      SET name = ?, area_cents = ?, gps_latitude = ?, gps_longitude = ?, google_maps_url = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      area_cents || existing.area_cents,
      gps_latitude ?? existing.gps_latitude,
      gps_longitude ?? existing.gps_longitude,
      google_maps_url ?? existing.google_maps_url,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM coconut_groves WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating grove:', error);
    return c.json({ error: 'Failed to update grove' }, 500);
  }
});

// DELETE /api/coconut/groves/:id
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_groves WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Grove not found' }, 404);
    }

    await db.prepare('UPDATE coconut_groves SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Grove deleted successfully' });
  } catch (error) {
    console.error('Error deleting grove:', error);
    return c.json({ error: 'Failed to delete grove' }, 500);
  }
});

export default router;
