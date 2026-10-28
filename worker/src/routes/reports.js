import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';

// The Worker only returns report data; the browser builds the PDF
// (frontend/src/utils/pdfGenerator.js), which keeps Worker CPU time low.
const router = new Hono();

router.use('*', authenticateToken);

// GET /api/reports/tenant/:id/data - Data for the tenant details PDF
router.get('/tenant/:id/data', async (c) => {
  const db = c.get('db');
  try {
    const tenant = await db.prepare(`
      SELECT t.*, h.house_number, h.address, h.rent_amount
      FROM tenants t
      JOIN houses h ON t.house_id = h.id
      WHERE t.id = ?
    `).get(c.req.param('id'));

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    const payments = await db.prepare(`
      SELECT * FROM rent_payments
      WHERE tenant_id = ?
      ORDER BY due_date DESC
    `).all(c.req.param('id'));

    return c.json({ tenant, payments });
  } catch (error) {
    console.error('Error fetching tenant report data:', error);
    return c.json({ error: 'Failed to generate tenant PDF' }, 500);
  }
});

// GET /api/reports/house/:id/data - Data for the house details PDF
router.get('/house/:id/data', async (c) => {
  const db = c.get('db');
  try {
    const house = await db.prepare('SELECT * FROM houses WHERE id = ?').get(c.req.param('id'));

    if (!house) {
      return c.json({ error: 'House not found' }, 404);
    }

    const tenants = await db.prepare(`
      SELECT * FROM tenants WHERE house_id = ? ORDER BY move_in_date DESC
    `).all(c.req.param('id'));

    const expenses = await db.prepare(`
      SELECT * FROM expenses WHERE house_id = ? ORDER BY due_date DESC
    `).all(c.req.param('id'));

    const maintenanceExpenses = await db.prepare(`
      SELECT me.*, meh.split_amount
      FROM maintenance_expenses me
      JOIN maintenance_expense_houses meh ON me.id = meh.maintenance_expense_id
      WHERE meh.house_id = ?
      ORDER BY me.expense_date DESC
    `).all(c.req.param('id'));

    return c.json({ house, tenants, expenses, maintenanceExpenses });
  } catch (error) {
    console.error('Error fetching house report data:', error);
    return c.json({ error: 'Failed to generate house PDF' }, 500);
  }
});

// GET /api/reports/yearly/:year/data - Data for the yearly financial report PDF
router.get('/yearly/:year/data', async (c) => {
  const db = c.get('db');
  try {
    const year = c.req.param('year');

    // Get all houses
    const houses = await db.prepare('SELECT * FROM houses WHERE is_active = 1 ORDER BY house_number').all();

    // Get monthly income data
    const monthlyIncome = await db.prepare(`
      SELECT
        strftime('%m', due_date) as month,
        house_id,
        SUM(paid_amount) as collected,
        SUM(due_amount) as total_due
      FROM rent_payments
      WHERE strftime('%Y', due_date) = ?
      GROUP BY strftime('%m', due_date), house_id
    `).all(year);

    // Get expenses by house
    const expenses = await db.prepare(`
      SELECT
        house_id,
        expense_type,
        SUM(amount) as total
      FROM expenses
      WHERE strftime('%Y', due_date) = ? OR strftime('%Y', paid_date) = ?
      GROUP BY house_id, expense_type
    `).all(year, year);

    // Get maintenance expenses
    const maintenance = await db.prepare(`
      SELECT
        meh.house_id,
        SUM(meh.split_amount) as total
      FROM maintenance_expense_houses meh
      JOIN maintenance_expenses me ON meh.maintenance_expense_id = me.id
      WHERE strftime('%Y', me.expense_date) = ?
      GROUP BY meh.house_id
    `).all(year);

    return c.json({ year, houses, monthlyIncome, expenses, maintenance });
  } catch (error) {
    console.error('Error fetching yearly report data:', error);
    return c.json({ error: 'Failed to generate yearly report PDF' }, 500);
  }
});

// GET /api/reports/summary/:year - Get yearly summary data (for dashboard)
router.get('/summary/:year', async (c) => {
  const db = c.get('db');
  try {
    const year = c.req.param('year');

    const totalIncome = (await db.prepare(`
      SELECT SUM(paid_amount) as total
      FROM rent_payments
      WHERE strftime('%Y', due_date) = ?
    `).get(year)).total || 0;

    const totalExpenses = (await db.prepare(`
      SELECT SUM(amount) as total
      FROM expenses
      WHERE strftime('%Y', due_date) = ? OR strftime('%Y', paid_date) = ?
    `).get(year, year)).total || 0;

    const totalMaintenance = (await db.prepare(`
      SELECT SUM(amount) as total
      FROM maintenance_expenses
      WHERE strftime('%Y', expense_date) = ?
    `).get(year)).total || 0;

    const pendingRent = (await db.prepare(`
      SELECT SUM(due_amount - paid_amount) as total
      FROM rent_payments
      WHERE strftime('%Y', due_date) = ? AND is_fully_paid = 0
    `).get(year)).total || 0;

    return c.json({
      year,
      totalIncome,
      totalExpenses: totalExpenses + totalMaintenance,
      netProfit: totalIncome - totalExpenses - totalMaintenance,
      pendingRent
    });
  } catch (error) {
    console.error('Error fetching yearly summary:', error);
    return c.json({ error: 'Failed to fetch yearly summary' }, 500);
  }
});

export default router;
