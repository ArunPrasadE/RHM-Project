import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

// Apply authentication to all routes
router.use('*', authenticateToken);

// GET /api/paddy/fields - List all fields
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const fields = await db.prepare(`
      SELECT * FROM paddy_fields
      WHERE is_active = 1
      ORDER BY name
    `).all();

    return c.json(fields);
  } catch (error) {
    console.error('Error fetching paddy fields:', error);
    return c.json({ error: 'Failed to fetch paddy fields' }, 500);
  }
});

// GET /api/paddy/fields/:id - Get field details
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const field = await db.prepare(`
      SELECT * FROM paddy_fields
      WHERE id = ? AND is_active = 1
    `).get(c.req.param('id'));

    if (!field) {
      return c.json({ error: 'Field not found' }, 404);
    }

    return c.json(field);
  } catch (error) {
    console.error('Error fetching field:', error);
    return c.json({ error: 'Failed to fetch field' }, 500);
  }
});

// POST /api/paddy/fields - Add new field
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const {
      name,
      area_cents,
      gps_latitude,
      gps_longitude,
      google_maps_url
    } = await c.req.json().catch(() => ({}));

    if (!name || !area_cents) {
      return c.json({ error: 'Name and area are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO paddy_fields (name, area_cents, gps_latitude, gps_longitude, google_maps_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, area_cents, gps_latitude, gps_longitude, google_maps_url);

    const newField = await db.prepare('SELECT * FROM paddy_fields WHERE id = ?').get(result.lastInsertRowid);

    return c.json(newField, 201);
  } catch (error) {
    console.error('Error creating field:', error);
    return c.json({ error: 'Failed to create field' }, 500);
  }
});

// PUT /api/paddy/fields/:id - Update field
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const {
      name,
      area_cents,
      gps_latitude,
      gps_longitude,
      google_maps_url
    } = await c.req.json().catch(() => ({}));

    const existingField = await db.prepare('SELECT * FROM paddy_fields WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existingField) {
      return c.json({ error: 'Field not found' }, 404);
    }

    await db.prepare(`
      UPDATE paddy_fields
      SET name = ?, area_cents = ?, gps_latitude = ?, gps_longitude = ?, google_maps_url = ?
      WHERE id = ?
    `).run(
      name || existingField.name,
      area_cents || existingField.area_cents,
      gps_latitude ?? existingField.gps_latitude,
      gps_longitude ?? existingField.gps_longitude,
      google_maps_url ?? existingField.google_maps_url,
      c.req.param('id')
    );

    const updatedField = await db.prepare('SELECT * FROM paddy_fields WHERE id = ?').get(c.req.param('id'));

    return c.json(updatedField);
  } catch (error) {
    console.error('Error updating field:', error);
    return c.json({ error: 'Failed to update field' }, 500);
  }
});

// DELETE /api/paddy/fields/:id - Soft delete field
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existingField = await db.prepare('SELECT * FROM paddy_fields WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existingField) {
      return c.json({ error: 'Field not found' }, 404);
    }

    await db.prepare('UPDATE paddy_fields SET is_active = 0 WHERE id = ?').run(c.req.param('id'));

    return c.json({ message: 'Field deleted successfully' });
  } catch (error) {
    console.error('Error deleting field:', error);
    return c.json({ error: 'Failed to delete field' }, 500);
  }
});

export default router;
