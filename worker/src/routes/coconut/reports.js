import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/coconut/reports/summary/:grove_id/:year
router.get('/summary/:grove_id/:year', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id, year } = c.req.param();

    // Get grove info
    const grove = await db.prepare('SELECT * FROM coconut_groves WHERE id = ?').get(grove_id);

    if (!grove) {
      return c.json({ error: 'Grove not found' }, 404);
    }

    // Get total expenses
    const expenseTotal = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM coconut_expenses
      WHERE grove_id = ? AND year = ?
    `).get(grove_id, year);

    // Get expenses by category
    const expensesByCategory = await db.prepare(`
      SELECT category, SUM(amount) as total
      FROM coconut_expenses
      WHERE grove_id = ? AND year = ?
      GROUP BY category
      ORDER BY total DESC
    `).all(grove_id, year);

    // Get total income
    const incomeTotal = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM coconut_income
      WHERE grove_id = ? AND year = ?
    `).get(grove_id, year);

    // Get income by category
    const incomeByCategory = await db.prepare(`
      SELECT category, SUM(amount) as total, SUM(quantity_kg) as total_kg
      FROM coconut_income
      WHERE grove_id = ? AND year = ?
      GROUP BY category
    `).all(grove_id, year);

    // Get yield summary
    const yieldSummary = await db.prepare(`
      SELECT
        category,
        COALESCE(SUM(quantity_kg), 0) as totalKg,
        COALESCE(AVG(rate_per_kg), 0) as avgRate
      FROM coconut_income
      WHERE grove_id = ? AND year = ?
      GROUP BY category
    `).all(grove_id, year);

    const totalExpenses = expenseTotal.total;
    const totalIncome = incomeTotal.total;
    const profit = totalIncome - totalExpenses;

    return c.json({
      grove,
      year: parseInt(year),
      expenses: {
        total: totalExpenses,
        byCategory: expensesByCategory
      },
      income: {
        total: totalIncome,
        byCategory: incomeByCategory
      },
      profit,
      yieldSummary
    });
  } catch (error) {
    console.error('Error generating report:', error);
    return c.json({ error: 'Failed to generate report' }, 500);
  }
});

// GET /api/coconut/reports/comparative
router.get('/comparative', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id } = c.req.query();

    let query = `
      SELECT
        grove_id,
        year,
        (SELECT name FROM coconut_groves WHERE id = grove_id) as grove_name,
        (SELECT COALESCE(SUM(amount), 0) FROM coconut_expenses e WHERE e.grove_id = ce.grove_id AND e.year = ce.year) as total_expenses,
        (SELECT COALESCE(SUM(amount), 0) FROM coconut_income i WHERE i.grove_id = ce.grove_id AND i.year = ce.year) as total_income,
        (SELECT COALESCE(SUM(quantity_kg), 0) FROM coconut_income i WHERE i.grove_id = ce.grove_id AND i.year = ce.year AND i.category = 'thengai') as thengai_kg,
        (SELECT COALESCE(SUM(quantity_kg), 0) FROM coconut_income i WHERE i.grove_id = ce.grove_id AND i.year = ce.year AND i.category = 'mangai') as mangai_kg
      FROM (
        SELECT DISTINCT grove_id, year FROM coconut_expenses
        UNION
        SELECT DISTINCT grove_id, year FROM coconut_income
      ) ce
    `;

    const params = [];

    if (grove_id) {
      query += ' WHERE grove_id = ?';
      params.push(grove_id);
    }

    query += ' ORDER BY grove_id, year DESC';

    const data = await db.prepare(query).all(...params);

    const result = data.map(row => ({
      ...row,
      profit: row.total_income - row.total_expenses
    }));

    return c.json(result);
  } catch (error) {
    console.error('Error generating comparative report:', error);
    return c.json({ error: 'Failed to generate comparative report' }, 500);
  }
});

export default router;
