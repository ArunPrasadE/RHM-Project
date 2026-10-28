import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';

const router = new Hono();

// Apply authentication to all routes
router.use('*', authenticateToken);

// GET /api/maintenance - List maintenance expenses
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const { year, house_id } = c.req.query();

    let query = `
      SELECT me.*,
        (SELECT json_group_array(json_object('house_id', meh.house_id, 'house_number', h.house_number, 'split_amount', meh.split_amount))
         FROM maintenance_expense_houses meh
         JOIN houses h ON meh.house_id = h.id
         WHERE meh.maintenance_expense_id = me.id) as houses
      FROM maintenance_expenses me
      WHERE 1=1
    `;

    const params = [];

    if (year) {
      query += ` AND strftime('%Y', me.expense_date) = ?`;
      params.push(year);
    }

    if (house_id) {
      query += ' AND me.id IN (SELECT maintenance_expense_id FROM maintenance_expense_houses WHERE house_id = ?)';
      params.push(house_id);
    }

    query += ' ORDER BY me.expense_date DESC';

    const expenses = await db.prepare(query).all(...params);

    // Parse houses JSON
    expenses.forEach(e => {
      e.houses = JSON.parse(e.houses || '[]');
    });

    return c.json(expenses);
  } catch (error) {
    console.error('Error fetching maintenance expenses:', error);
    return c.json({ error: 'Failed to fetch maintenance expenses' }, 500);
  }
});

// GET /api/maintenance/:id - Get single maintenance expense
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const expense = await db.prepare('SELECT * FROM maintenance_expenses WHERE id = ?').get(c.req.param('id'));

    if (!expense) {
      return c.json({ error: 'Maintenance expense not found' }, 404);
    }

    const houses = await db.prepare(`
      SELECT meh.*, h.house_number
      FROM maintenance_expense_houses meh
      JOIN houses h ON meh.house_id = h.id
      WHERE meh.maintenance_expense_id = ?
    `).all(c.req.param('id'));

    return c.json({ ...expense, houses });
  } catch (error) {
    console.error('Error fetching maintenance expense:', error);
    return c.json({ error: 'Failed to fetch maintenance expense' }, 500);
  }
});

// POST /api/maintenance - Add maintenance expense
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const { description, amount, expense_date, house_ids, add_to_rent } = await c.req.json().catch(() => ({}));

    if (!description || !amount || !expense_date || !house_ids || !Array.isArray(house_ids) || house_ids.length === 0) {
      return c.json({ error: 'Description, amount, expense date, and house IDs are required' }, 400);
    }

    const isShared = house_ids.length > 1 ? 1 : 0;
    const splitAmount = amount / house_ids.length;

    // Create maintenance expense
    const result = await db.prepare(`
      INSERT INTO maintenance_expenses (description, amount, expense_date, is_shared, add_to_rent)
      VALUES (?, ?, ?, ?, ?)
    `).run(description, amount, expense_date, isShared, add_to_rent ? 1 : 0);

    const maintenanceExpenseId = result.lastInsertRowid;

    // Create house associations
    const createdAssociations = [];

    for (const house_id of house_ids) {
      const house = await db.prepare('SELECT house_number FROM houses WHERE id = ?').get(house_id);

      if (!house) continue;

      await db.prepare(`
        INSERT INTO maintenance_expense_houses (maintenance_expense_id, house_id, split_amount)
        VALUES (?, ?, ?)
      `).run(maintenanceExpenseId, house_id, splitAmount);

      createdAssociations.push({
        house_id,
        house_number: house.house_number,
        split_amount: splitAmount
      });

      // Add to rent if requested
      if (add_to_rent) {
        const currentTenant = await db.prepare(`
          SELECT id FROM tenants WHERE house_id = ? AND is_current = 1
        `).get(house_id);

        if (currentTenant) {
          // Calculate which rent month this expense should go to
          // If expense date is after 9th, add to next month's rent
          const expDate = new Date(expense_date);
          const expDay = expDate.getUTCDate();

          let rentYear = expDate.getUTCFullYear();
          let rentMonth = expDate.getUTCMonth() + 1; // 0-indexed to 1-indexed

          if (expDay > 9) {
            // Add to next month's rent
            rentMonth += 1;
            if (rentMonth > 12) {
              rentMonth = 1;
              rentYear += 1;
            }
          }

          // Find rent payment for the calculated month
          let rentPayment = await db.prepare(`
            SELECT * FROM rent_payments
            WHERE tenant_id = ?
              AND strftime('%Y', due_date) = ?
              AND strftime('%m', due_date) = ?
            LIMIT 1
          `).get(currentTenant.id, String(rentYear), String(rentMonth).padStart(2, '0'));

          if (rentPayment) {
            await db.prepare(`
              UPDATE rent_payments SET due_amount = due_amount + ? WHERE id = ?
            `).run(splitAmount, rentPayment.id);

            await db.prepare(`
              INSERT INTO rent_additions (rent_payment_id, source_type, source_id, amount, description)
              VALUES (?, 'maintenance', ?, ?, ?)
            `).run(rentPayment.id, maintenanceExpenseId, splitAmount, description);
          }
        }
      }
    }

    const newExpense = await db.prepare('SELECT * FROM maintenance_expenses WHERE id = ?').get(maintenanceExpenseId);

    return c.json({
      ...newExpense,
      houses: createdAssociations
    }, 201);
  } catch (error) {
    console.error('Error creating maintenance expense:', error);
    return c.json({ error: 'Failed to create maintenance expense' }, 500);
  }
});

// PUT /api/maintenance/:id - Update maintenance expense
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const { description, amount, expense_date } = await c.req.json().catch(() => ({}));

    const existingExpense = await db.prepare('SELECT * FROM maintenance_expenses WHERE id = ?').get(c.req.param('id'));

    if (!existingExpense) {
      return c.json({ error: 'Maintenance expense not found' }, 404);
    }

    await db.prepare(`
      UPDATE maintenance_expenses
      SET description = ?, amount = ?, expense_date = ?
      WHERE id = ?
    `).run(
      description || existingExpense.description,
      amount || existingExpense.amount,
      expense_date || existingExpense.expense_date,
      c.req.param('id')
    );

    // Update split amounts if amount changed
    if (amount && amount !== existingExpense.amount) {
      const houseCount = (await db.prepare(`
        SELECT COUNT(*) as count FROM maintenance_expense_houses WHERE maintenance_expense_id = ?
      `).get(c.req.param('id'))).count;

      const newSplitAmount = amount / houseCount;

      await db.prepare(`
        UPDATE maintenance_expense_houses SET split_amount = ? WHERE maintenance_expense_id = ?
      `).run(newSplitAmount, c.req.param('id'));
    }

    const updatedExpense = await db.prepare('SELECT * FROM maintenance_expenses WHERE id = ?').get(c.req.param('id'));
    const houses = await db.prepare(`
      SELECT meh.*, h.house_number
      FROM maintenance_expense_houses meh
      JOIN houses h ON meh.house_id = h.id
      WHERE meh.maintenance_expense_id = ?
    `).all(c.req.param('id'));

    return c.json({ ...updatedExpense, houses });
  } catch (error) {
    console.error('Error updating maintenance expense:', error);
    return c.json({ error: 'Failed to update maintenance expense' }, 500);
  }
});

// DELETE /api/maintenance/:id - Delete maintenance expense
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existingExpense = await db.prepare('SELECT * FROM maintenance_expenses WHERE id = ?').get(c.req.param('id'));

    if (!existingExpense) {
      return c.json({ error: 'Maintenance expense not found' }, 404);
    }

    // Remove rent additions linked to this maintenance expense
    await db.prepare(`DELETE FROM rent_additions WHERE source_type = 'maintenance' AND source_id = ?`).run(c.req.param('id'));

    // Remove house associations
    await db.prepare('DELETE FROM maintenance_expense_houses WHERE maintenance_expense_id = ?').run(c.req.param('id'));

    // Remove the expense
    await db.prepare('DELETE FROM maintenance_expenses WHERE id = ?').run(c.req.param('id'));

    return c.json({ message: 'Maintenance expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting maintenance expense:', error);
    return c.json({ error: 'Failed to delete maintenance expense' }, 500);
  }
});

export default router;
