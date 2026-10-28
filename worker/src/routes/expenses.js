import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';

const router = new Hono();

// Apply authentication to all routes
router.use('*', authenticateToken);

// GET /api/expenses - List all expenses
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const { house_id, expense_type, status, year } = c.req.query();

    let query = `
      SELECT e.*, h.house_number
      FROM expenses e
      JOIN houses h ON e.house_id = h.id
      WHERE 1=1
    `;

    const params = [];

    if (house_id) {
      query += ' AND e.house_id = ?';
      params.push(house_id);
    }

    if (expense_type) {
      query += ' AND e.expense_type = ?';
      params.push(expense_type);
    }

    if (status === 'pending') {
      query += ' AND e.is_paid = 0';
    } else if (status === 'paid') {
      query += ' AND e.is_paid = 1';
    }

    if (year) {
      query += ` AND strftime('%Y', e.due_date) = ?`;
      params.push(year);
    }

    query += ' ORDER BY e.due_date DESC';

    const expenses = await db.prepare(query).all(...params);

    return c.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return c.json({ error: 'Failed to fetch expenses' }, 500);
  }
});

// POST /api/expenses/eb-bill - Add EB bill for a house
router.post('/eb-bill', async (c) => {
  const db = c.get('db');
  try {
    const { house_id, amount, due_date, notes } = await c.req.json().catch(() => ({}));

    if (!house_id || !amount) {
      return c.json({ error: 'House ID and amount are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO expenses (house_id, expense_type, amount, due_date, notes)
      VALUES (?, 'eb_bill', ?, ?, ?)
    `).run(house_id, amount, due_date, notes);

    const newExpense = await db.prepare(`
      SELECT e.*, h.house_number
      FROM expenses e
      JOIN houses h ON e.house_id = h.id
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    return c.json(newExpense, 201);
  } catch (error) {
    console.error('Error creating EB bill:', error);
    return c.json({ error: 'Failed to create EB bill' }, 500);
  }
});

// POST /api/expenses/house-tax - Add house tax
router.post('/house-tax', async (c) => {
  const db = c.get('db');
  try {
    const { house_id, amount, due_date, notes } = await c.req.json().catch(() => ({}));

    if (!house_id || !amount) {
      return c.json({ error: 'House ID and amount are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO expenses (house_id, expense_type, amount, due_date, notes)
      VALUES (?, 'house_tax', ?, ?, ?)
    `).run(house_id, amount, due_date, notes);

    const newExpense = await db.prepare(`
      SELECT e.*, h.house_number
      FROM expenses e
      JOIN houses h ON e.house_id = h.id
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    return c.json(newExpense, 201);
  } catch (error) {
    console.error('Error creating house tax:', error);
    return c.json({ error: 'Failed to create house tax' }, 500);
  }
});

// POST /api/expenses/motor-bill - Add motor bill (auto-splits among houses with same motor service number)
router.post('/motor-bill', async (c) => {
  const db = c.get('db');
  try {
    const { motor_service_number, amount, due_date, notes, add_to_rent } = await c.req.json().catch(() => ({}));

    if (!motor_service_number || !amount) {
      return c.json({ error: 'Motor service number and amount are required' }, 400);
    }

    // Find all houses with the same motor service number
    const houses = await db.prepare(`
      SELECT id, house_number FROM houses
      WHERE motor_service_number = ? AND is_active = 1
    `).all(motor_service_number);

    if (houses.length === 0) {
      return c.json({ error: 'No houses found with this motor service number' }, 404);
    }

    const splitAmount = amount / houses.length;
    const createdExpenses = [];

    for (const house of houses) {
      const result = await db.prepare(`
        INSERT INTO expenses (house_id, expense_type, amount, due_date, notes)
        VALUES (?, 'motor_bill', ?, ?, ?)
      `).run(house.id, splitAmount, due_date, notes);

      createdExpenses.push({
        id: result.lastInsertRowid,
        house_id: house.id,
        house_number: house.house_number,
        split_amount: splitAmount
      });

      // Add to rent if requested
      if (add_to_rent && due_date) {
        const currentTenant = await db.prepare(`
          SELECT id FROM tenants WHERE house_id = ? AND is_current = 1
        `).get(house.id);

        if (currentTenant) {
          // Calculate which rent month this expense should go to
          // If due date is after 9th, add to next month's rent
          const expenseDate = new Date(due_date);
          const expenseDay = expenseDate.getUTCDate();

          let rentYear = expenseDate.getUTCFullYear();
          let rentMonth = expenseDate.getUTCMonth() + 1; // 0-indexed to 1-indexed

          if (expenseDay > 9) {
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
            // Add to matching month's payment
            await db.prepare(`
              UPDATE rent_payments SET due_amount = due_amount + ? WHERE id = ?
            `).run(splitAmount, rentPayment.id);

            await db.prepare(`
              INSERT INTO rent_additions (rent_payment_id, source_type, source_id, amount, description)
              VALUES (?, 'motor_bill', ?, ?, ?)
            `).run(rentPayment.id, result.lastInsertRowid, splitAmount, `Motor bill share`);
          }
        }
      }
    }

    return c.json({
      message: 'Motor bill split successfully',
      totalAmount: amount,
      splitAmount,
      houses: createdExpenses
    }, 201);
  } catch (error) {
    console.error('Error creating motor bill:', error);
    return c.json({ error: 'Failed to create motor bill' }, 500);
  }
});

// POST /api/expenses/water-bill - Add water bill (select houses to split)
router.post('/water-bill', async (c) => {
  const db = c.get('db');
  try {
    const { house_ids, amount, due_date, notes, add_to_rent } = await c.req.json().catch(() => ({}));

    if (!house_ids || !Array.isArray(house_ids) || house_ids.length === 0 || !amount) {
      return c.json({ error: 'House IDs array and amount are required' }, 400);
    }

    const splitAmount = amount / house_ids.length;
    const createdExpenses = [];

    for (const house_id of house_ids) {
      const house = await db.prepare('SELECT house_number FROM houses WHERE id = ?').get(house_id);

      if (!house) continue;

      const result = await db.prepare(`
        INSERT INTO expenses (house_id, expense_type, amount, due_date, notes)
        VALUES (?, 'water_bill', ?, ?, ?)
      `).run(house_id, splitAmount, due_date, notes);

      createdExpenses.push({
        id: result.lastInsertRowid,
        house_id,
        house_number: house.house_number,
        split_amount: splitAmount
      });

      // Add to rent if requested
      if (add_to_rent && due_date) {
        const currentTenant = await db.prepare(`
          SELECT id FROM tenants WHERE house_id = ? AND is_current = 1
        `).get(house_id);

        if (currentTenant) {
          // Calculate which rent month this expense should go to
          // If due date is after 9th, add to next month's rent
          const expenseDate = new Date(due_date);
          const expenseDay = expenseDate.getUTCDate();

          let rentYear = expenseDate.getUTCFullYear();
          let rentMonth = expenseDate.getUTCMonth() + 1; // 0-indexed to 1-indexed

          if (expenseDay > 9) {
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
              VALUES (?, 'water_bill', ?, ?, ?)
            `).run(rentPayment.id, result.lastInsertRowid, splitAmount, `Water bill share`);
          }
        }
      }
    }

    return c.json({
      message: 'Water bill split successfully',
      totalAmount: amount,
      splitAmount,
      houses: createdExpenses
    }, 201);
  } catch (error) {
    console.error('Error creating water bill:', error);
    return c.json({ error: 'Failed to create water bill' }, 500);
  }
});

// PUT /api/expenses/:id - Update expense
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const { amount, due_date, notes } = await c.req.json().catch(() => ({}));

    const existingExpense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(c.req.param('id'));

    if (!existingExpense) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    await db.prepare(`
      UPDATE expenses
      SET amount = ?, due_date = ?, notes = ?
      WHERE id = ?
    `).run(
      amount ?? existingExpense.amount,
      due_date ?? existingExpense.due_date,
      notes ?? existingExpense.notes,
      c.req.param('id')
    );

    const updatedExpense = await db.prepare(`
      SELECT e.*, h.house_number
      FROM expenses e
      JOIN houses h ON e.house_id = h.id
      WHERE e.id = ?
    `).get(c.req.param('id'));

    return c.json(updatedExpense);
  } catch (error) {
    console.error('Error updating expense:', error);
    return c.json({ error: 'Failed to update expense' }, 500);
  }
});

// PUT /api/expenses/:id/pay - Mark expense as paid
router.put('/:id/pay', async (c) => {
  const db = c.get('db');
  try {
    const { paid_date } = await c.req.json().catch(() => ({}));

    const existingExpense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(c.req.param('id'));

    if (!existingExpense) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    await db.prepare(`
      UPDATE expenses
      SET is_paid = 1, paid_date = ?
      WHERE id = ?
    `).run(paid_date || new Date().toISOString().split('T')[0], c.req.param('id'));

    const updatedExpense = await db.prepare(`
      SELECT e.*, h.house_number
      FROM expenses e
      JOIN houses h ON e.house_id = h.id
      WHERE e.id = ?
    `).get(c.req.param('id'));

    return c.json(updatedExpense);
  } catch (error) {
    console.error('Error marking expense as paid:', error);
    return c.json({ error: 'Failed to mark expense as paid' }, 500);
  }
});

// DELETE /api/expenses/:id - Delete expense
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existingExpense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(c.req.param('id'));

    if (!existingExpense) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    // Remove any rent additions linked to this expense
    await db.prepare(`DELETE FROM rent_additions WHERE source_id = ? AND source_type = ?`).run(
      c.req.param('id'),
      existingExpense.expense_type
    );

    await db.prepare('DELETE FROM expenses WHERE id = ?').run(c.req.param('id'));

    return c.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return c.json({ error: 'Failed to delete expense' }, 500);
  }
});

export default router;
