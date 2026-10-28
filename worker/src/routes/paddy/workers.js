import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/paddy/workers - List all workers
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const { category } = c.req.query();

    let query = 'SELECT * FROM paddy_workers WHERE is_active = 1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY category, name';

    const workers = await db.prepare(query).all(...params);
    return c.json(workers);
  } catch (error) {
    console.error('Error fetching workers:', error);
    return c.json({ error: 'Failed to fetch workers' }, 500);
  }
});

// GET /api/paddy/workers/:id
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const worker = await db.prepare('SELECT * FROM paddy_workers WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!worker) {
      return c.json({ error: 'Worker not found' }, 404);
    }

    return c.json(worker);
  } catch (error) {
    console.error('Error fetching worker:', error);
    return c.json({ error: 'Failed to fetch worker' }, 500);
  }
});

// POST /api/paddy/workers
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const { name, category, place, mobile } = await c.req.json().catch(() => ({}));

    if (!name || !category) {
      return c.json({ error: 'Name and category are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO paddy_workers (name, category, place, mobile)
      VALUES (?, ?, ?, ?)
    `).run(name, category, place, mobile);

    const newWorker = await db.prepare('SELECT * FROM paddy_workers WHERE id = ?').get(result.lastInsertRowid);
    return c.json(newWorker, 201);
  } catch (error) {
    console.error('Error creating worker:', error);
    return c.json({ error: 'Failed to create worker' }, 500);
  }
});

// PUT /api/paddy/workers/:id
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const { name, category, place, mobile } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM paddy_workers WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Worker not found' }, 404);
    }

    await db.prepare(`
      UPDATE paddy_workers
      SET name = ?, category = ?, place = ?, mobile = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      category || existing.category,
      place ?? existing.place,
      mobile ?? existing.mobile,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM paddy_workers WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating worker:', error);
    return c.json({ error: 'Failed to update worker' }, 500);
  }
});

// DELETE /api/paddy/workers/:id
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_workers WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Worker not found' }, 404);
    }

    await db.prepare('UPDATE paddy_workers SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Worker deleted successfully' });
  } catch (error) {
    console.error('Error deleting worker:', error);
    return c.json({ error: 'Failed to delete worker' }, 500);
  }
});

// ========================
// WORKER CATEGORIES
// ========================

// GET /api/paddy/workers/categories - List all categories
router.get('/categories/list', async (c) => {
  const db = c.get('db');
  try {
    const categories = await db.prepare('SELECT * FROM paddy_worker_categories WHERE is_active = 1 ORDER BY label').all();
    return c.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

// POST /api/paddy/workers/categories - Add new category
router.post('/categories', async (c) => {
  const db = c.get('db');
  try {
    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    if (!value || !label) {
      return c.json({ error: 'Value and label are required' }, 400);
    }

    // Check if value already exists
    const existing = await db.prepare('SELECT * FROM paddy_worker_categories WHERE value = ?').get(value);
    if (existing) {
      if (existing.is_active === 0) {
        // Reactivate existing category
        db.prepare('UPDATE paddy_worker_categories SET is_active = 1, label = ?, label_tamil = ? WHERE id = ?')
          .run(label, label_tamil || null, existing.id);
        const updated = await db.prepare('SELECT * FROM paddy_worker_categories WHERE id = ?').get(existing.id);
        return c.json(updated, 201);
      }
      return c.json({ error: 'Category with this value already exists' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO paddy_worker_categories (value, label, label_tamil)
      VALUES (?, ?, ?)
    `).run(value, label, label_tamil || null);

    const newCategory = await db.prepare('SELECT * FROM paddy_worker_categories WHERE id = ?').get(result.lastInsertRowid);
    return c.json(newCategory, 201);
  } catch (error) {
    console.error('Error creating category:', error);
    return c.json({ error: 'Failed to create category' }, 500);
  }
});

// PUT /api/paddy/workers/categories/:id - Update category
router.put('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const { label, label_tamil } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM paddy_worker_categories WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await db.prepare(`
      UPDATE paddy_worker_categories
      SET label = ?, label_tamil = ?
      WHERE id = ?
    `).run(
      label || existing.label,
      label_tamil ?? existing.label_tamil,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM paddy_worker_categories WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating category:', error);
    return c.json({ error: 'Failed to update category' }, 500);
  }
});

// DELETE /api/paddy/workers/categories/:id - Soft delete category
router.delete('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_worker_categories WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await db.prepare('UPDATE paddy_worker_categories SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    return c.json({ error: 'Failed to delete category' }, 500);
  }
});

export default router;
