import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/coconut/income
router.get('/', async (c) => {
  const db = c.get('db');
  try {

    const { grove_id, year, category } = c.req.query();

    let query = 'SELECT * FROM coconut_income WHERE 1=1';
    const params = [];

    if (grove_id) {
      query += ' AND grove_id = ?';
      params.push(grove_id);
    }

    if (year) {
      query += ' AND year = ?';
      params.push(year);
    }

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY income_date DESC';

    const incomes = await db.prepare(query).all(...params);
    // Handle old data - convert to new format
    const formattedIncomes = incomes.map(inc => ({
      ...inc,
      unit_type: inc.unit_type || 'kg',
      rate_per_unit: inc.rate_per_unit || inc.rate_per_kg || 0,
      quantity_count: inc.quantity_count || null
    }));
    return c.json(formattedIncomes);
  } catch (error) {
    console.error('Error fetching income:', error);
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

// GET /api/coconut/income/:id
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const income = await db.prepare('SELECT * FROM coconut_income WHERE id = ?').get(c.req.param('id'));

    if (!income) {
      return c.json({ error: 'Income record not found' }, 404);
    }

    return c.json({
      ...income,
      unit_type: income.unit_type || 'kg',
      rate_per_unit: income.rate_per_unit || income.rate_per_kg || 0
    });
  } catch (error) {
    console.error('Error fetching income:', error);
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

// POST /api/coconut/income
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id, year, category, unit_type, quantity_kg, quantity_count, rate_per_unit, amount, income_date, sale_time, notes } = await c.req.json().catch(() => ({}));
    

    // Insert with all fields including rate_per_kg for old table
    const finalQtyKg = unit_type === 'count' ? 0 : (quantity_kg || 0);
    const result = await db.prepare(`
      INSERT INTO coconut_income (grove_id, year, category, unit_type, quantity_kg, quantity_count, rate_per_unit, rate_per_kg, amount, income_date, sale_time, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(grove_id, year, category, unit_type || 'kg', finalQtyKg, quantity_count || null, rate_per_unit, rate_per_unit, amount, income_date, sale_time || null, notes || null);

    const newIncome = await db.prepare('SELECT * FROM coconut_income WHERE id = ?').get(result.lastInsertRowid);
    console.log('Income saved:', newIncome);
    return c.json(newIncome, 201);
  } catch (error) {
    console.error('Error creating income:', error);
    console.error('Error stack:', error.stack);
    return c.json({ error: 'Failed to create income', details: error.message }, 500);
  }
});

// PUT /api/coconut/income/:id
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id, year, category, unit_type, quantity_kg, quantity_count, rate_per_unit, amount, income_date, sale_time, notes } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM coconut_income WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Income record not found' }, 404);
    }

    // Handle old column names
    const finalRatePerUnit = rate_per_unit || existing.rate_per_unit || existing.rate_per_kg;

    await db.prepare(`
      UPDATE coconut_income
      SET grove_id = ?, year = ?, category = ?, unit_type = ?, quantity_kg = ?, quantity_count = ?, rate_per_unit = ?, amount = ?, income_date = ?, sale_time = ?, notes = ?
      WHERE id = ?
    `).run(
      grove_id || existing.grove_id,
      year || existing.year,
      category || existing.category,
      unit_type || existing.unit_type || 'kg',
      quantity_kg ?? existing.quantity_kg,
      quantity_count ?? existing.quantity_count,
      finalRatePerUnit,
      amount || existing.amount,
      income_date || existing.income_date,
      sale_time ?? existing.sale_time,
      notes ?? existing.notes,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM coconut_income WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating income:', error);
    return c.json({ error: 'Failed to update income' }, 500);
  }
});

// DELETE /api/coconut/income/:id
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_income WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Income record not found' }, 404);
    }

    await db.prepare('DELETE FROM coconut_income WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Income record deleted successfully' });
  } catch (error) {
    console.error('Error deleting income:', error);
    return c.json({ error: 'Failed to delete income' }, 500);
  }
});

export default router;
