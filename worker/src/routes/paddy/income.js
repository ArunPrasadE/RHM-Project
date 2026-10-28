import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/paddy/income - List income with filters
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const { field_id, year, crop_number, category } = c.req.query();

    let query = 'SELECT * FROM paddy_income WHERE 1=1';
    const params = [];

    if (field_id) {
      query += ' AND field_id = ?';
      params.push(field_id);
    }

    if (year) {
      query += ' AND year = ?';
      params.push(year);
    }

    if (crop_number) {
      query += ' AND crop_number = ?';
      params.push(crop_number);
    }

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY income_date DESC';

    const incomes = await db.prepare(query).all(...params);
    return c.json(incomes);
  } catch (error) {
    console.error('Error fetching income:', error);
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

// GET /api/paddy/income/:id
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const income = await db.prepare('SELECT * FROM paddy_income WHERE id = ?').get(c.req.param('id'));

    if (!income) {
      return c.json({ error: 'Income record not found' }, 404);
    }

    return c.json(income);
  } catch (error) {
    console.error('Error fetching income:', error);
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

// POST /api/paddy/income
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const {
      field_id,
      year,
      crop_number,
      category,
      yield_kg,
      kottai_count,
      rate_per_kottai,
      amount,
      income_date,
      notes
    } = await c.req.json().catch(() => ({}));

    if (!field_id || !year || !crop_number || !category || !amount || !income_date) {
      return c.json({ error: 'Field, year, crop number, category, amount, and date are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO paddy_income (field_id, year, crop_number, category, yield_kg, kottai_count, rate_per_kottai, amount, income_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(field_id, year, crop_number, category, yield_kg, kottai_count, rate_per_kottai, amount, income_date, notes);

    const newIncome = await db.prepare('SELECT * FROM paddy_income WHERE id = ?').get(result.lastInsertRowid);
    return c.json(newIncome, 201);
  } catch (error) {
    console.error('Error creating income:', error);
    return c.json({ error: 'Failed to create income' }, 500);
  }
});

// PUT /api/paddy/income/:id
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const {
      field_id,
      year,
      crop_number,
      category,
      yield_kg,
      kottai_count,
      rate_per_kottai,
      amount,
      income_date,
      notes
    } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM paddy_income WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Income record not found' }, 404);
    }

    await db.prepare(`
      UPDATE paddy_income
      SET field_id = ?, year = ?, crop_number = ?, category = ?, yield_kg = ?, kottai_count = ?, rate_per_kottai = ?, amount = ?, income_date = ?, notes = ?
      WHERE id = ?
    `).run(
      field_id || existing.field_id,
      year || existing.year,
      crop_number || existing.crop_number,
      category || existing.category,
      yield_kg ?? existing.yield_kg,
      kottai_count ?? existing.kottai_count,
      rate_per_kottai ?? existing.rate_per_kottai,
      amount || existing.amount,
      income_date || existing.income_date,
      notes ?? existing.notes,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM paddy_income WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating income:', error);
    return c.json({ error: 'Failed to update income' }, 500);
  }
});

// DELETE /api/paddy/income/:id
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_income WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Income record not found' }, 404);
    }

    await db.prepare('DELETE FROM paddy_income WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Income record deleted successfully' });
  } catch (error) {
    console.error('Error deleting income:', error);
    return c.json({ error: 'Failed to delete income' }, 500);
  }
});

export default router;
