import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/coconut/expenses
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id, year, category } = c.req.query();

    let query = 'SELECT * FROM coconut_expenses WHERE 1=1';
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

    query += ' ORDER BY expense_date DESC';

    const expenses = await db.prepare(query).all(...params);
    return c.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return c.json({ error: 'Failed to fetch expenses' }, 500);
  }
});

// GET /api/coconut/expenses/categories - List all custom expense categories
router.get('/categories', async (c) => {
  const db = c.get('db');
  try {
    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coconut_expense_categories'").get();
    console.log('GET Table exists:', tableExists);
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS coconut_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
      console.log('Table created');
      return c.json([]);
    }
    const categories = await db.prepare('SELECT * FROM coconut_expense_categories WHERE is_active = 1 ORDER BY label').all();
    console.log('GET Categories found:', categories.length, categories);
    return c.json(categories);
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    return c.json({ error: 'Failed to fetch expense categories' }, 500);
  }
});

// GET /api/coconut/expenses/categories/all - List ALL categories including inactive (for debugging)
router.get('/categories/all', async (c) => {
  const db = c.get('db');
  try {
    const categories = await db.prepare('SELECT * FROM coconut_expense_categories ORDER BY id DESC').all();
    return c.json(categories);
  } catch (error) {
    return c.json([]);
  }
});

// POST /api/coconut/expenses/categories - Add new expense category
router.post('/categories', async (c) => {
  const db = c.get('db');
  try {
    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));
    console.log('Adding category:', value, label, label_tamil);

    if (!value || !label) {
      return c.json({ error: 'Value and label are required' }, 400);
    }

    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coconut_expense_categories'").get();
    console.log('POST Table exists:', tableExists);
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS coconut_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
      console.log('Table created');
    }

    const existing = await db.prepare('SELECT * FROM coconut_expense_categories WHERE LOWER(value) = LOWER(?)').get(value);
    console.log('Existing:', existing);
    if (existing) {
      await db.prepare('UPDATE coconut_expense_categories SET is_active = 1, label = ?, label_tamil = ? WHERE id = ?').run(label, label_tamil || null, existing.id);
      const updated = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(existing.id);
      console.log('Updated existing:', updated);
      return c.json(updated, 201);
    }

    const result = await db.prepare('INSERT INTO coconut_expense_categories (value, label, label_tamil) VALUES (?, ?, ?)').run(value, label, label_tamil || null);
    const newCategory = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(result.lastInsertRowid);
    console.log('New category created:', newCategory);
    return c.json(newCategory, 201);
  } catch (error) {
    console.error('Error creating expense category:', error);
    return c.json({ error: 'Failed to create expense category' }, 500);
  }
});

// PUT /api/coconut/expenses/categories/:id - Update expense category
router.put('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    await db.prepare('UPDATE coconut_expense_categories SET value = ?, label = ?, label_tamil = ? WHERE id = ?').run(
      value || existing.value,
      label || existing.label,
      label_tamil ?? existing.label_tamil,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating expense category:', error);
    return c.json({ error: 'Failed to update expense category' }, 500);
  }
});

// DELETE /api/coconut/expenses/categories/:id - Soft delete expense category
router.delete('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await db.prepare('UPDATE coconut_expense_categories SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    return c.json({ error: 'Failed to delete expense category' }, 500);
  }
});

// DELETE /api/coconut/expenses/categories - Hard delete ALL categories (cleanup)
router.delete('/categories', async (c) => {
  const db = c.get('db');
  try {
    await db.prepare('DELETE FROM coconut_expense_categories').run();
    return c.json({ message: 'All categories deleted' });
  } catch (error) {
    return c.json({ error: 'Failed to delete categories' }, 500);
  }
});

// GET /api/coconut/expenses/:id
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const expense = await db.prepare('SELECT * FROM coconut_expenses WHERE id = ?').get(c.req.param('id'));

    if (!expense) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    return c.json(expense);
  } catch (error) {
    console.error('Error fetching expense:', error);
    return c.json({ error: 'Failed to fetch expense' }, 500);
  }
});

// POST /api/coconut/expenses - Add expense for single grove or split across all
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id, year, category, total_amount, amount, expense_date, worker_id, notes } = await c.req.json().catch(() => ({}));

    // If specific grove_id is provided, add expense for that grove only (no split)
    if (grove_id && amount && !total_amount) {
      if (!year || !category || !amount || !expense_date) {
        return c.json({ error: 'Year, category, amount, and date are required' }, 400);
      }
      
      const result = await db.prepare(`
        INSERT INTO coconut_expenses (grove_id, year, category, amount, expense_date, worker_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(grove_id, year, category, amount, expense_date, worker_id || null, notes || null);

      const newExpense = await db.prepare('SELECT * FROM coconut_expenses WHERE id = ?').get(result.lastInsertRowid);
      const grove = await db.prepare('SELECT name FROM coconut_groves WHERE id = ?').get(grove_id);
      
      return c.json({
        message: `Expense added for ${grove?.name || 'grove'}`,
        amount: amount,
        expenses: [{ ...newExpense, grove_name: grove?.name }]
      }, 201);
      return;
    }

    // Default: Split across all groves
    if (!year || !category || !total_amount || !expense_date) {
      return c.json({ error: 'Year, category, total amount, and date are required' }, 400);
    }

    // Get all active groves with their areas
    const groves = await db.prepare('SELECT id, name, area_cents FROM coconut_groves WHERE is_active = 1').all();

    if (groves.length === 0) {
      return c.json({ error: 'No active groves found' }, 400);
    }

    // Calculate total area
    const totalAreaCents = groves.reduce((sum, grove) => sum + grove.area_cents, 0);

    // Insert expense for each grove with proportional amount
    // One batch = one transaction: all groves are saved, or none
    const insertStmt = db.prepare(`
      INSERT INTO coconut_expenses (grove_id, year, category, amount, expense_date, worker_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const results = await db.batch(groves.map((grove) => {
      // Calculate proportional amount: total_amount / total_area * grove_area
      const groveAmount = Math.round((total_amount / totalAreaCents * grove.area_cents) * 100) / 100;

      return insertStmt.statement(
        grove.id,
        year,
        category,
        groveAmount,
        expense_date,
        worker_id || null,
        notes || null
      );
    }));

    const createdExpenses = results.map((r, i) => ({ ...r.results[0], grove_name: groves[i].name }));

    return c.json({
      message: `Expense split across ${groves.length} groves`,
      total_amount: total_amount,
      expenses: createdExpenses
    }, 201);
  } catch (error) {
    console.error('Error creating expense:', error);
    return c.json({ error: 'Failed to create expense' }, 500);
  }
});

// PUT /api/coconut/expenses/grouped - Update all expenses in a group (re-split total)
router.put('/grouped', async (c) => {
  const db = c.get('db');
  try {
    const {
      category,
      expense_date,
      year,
      new_total_amount,
      worker_id,
      notes
    } = await c.req.json().catch(() => ({}));

    if (!category || !expense_date || !year || !new_total_amount) {
      return c.json({ error: 'Category, date, year, and new total amount are required' }, 400);
    }

    // Find all related expenses
    const relatedExpenses = await db.prepare(`
      SELECT ce.*, cg.area_cents
      FROM coconut_expenses ce
      JOIN coconut_groves cg ON ce.grove_id = cg.id
      WHERE ce.category = ?
        AND ce.expense_date = ?
        AND ce.year = ?
    `).all(category, expense_date, year);

    if (relatedExpenses.length === 0) {
      return c.json({ error: 'No related expenses found' }, 404);
    }

    // Calculate total area from related expenses
    const totalAreaCents = relatedExpenses.reduce((sum, e) => sum + e.area_cents, 0);

    // Update all related expenses with new proportional amounts
    const updateStmt = db.prepare(`
      UPDATE coconut_expenses
      SET amount = ?, worker_id = ?, notes = ?
      WHERE id = ?
    `);

    // One batch = one transaction
    await db.batch(relatedExpenses.map((expense) => {
      const newAmount = Math.round((new_total_amount / totalAreaCents * expense.area_cents) * 100) / 100;
      return updateStmt.statement(
        newAmount,
        worker_id ?? expense.worker_id,
        notes ?? expense.notes,
        expense.id
      );
    }));

    return c.json({
      message: `Updated ${relatedExpenses.length} expense records`,
      new_total_amount
    });
  } catch (error) {
    console.error('Error updating grouped expenses:', error);
    return c.json({ error: 'Failed to update grouped expenses' }, 500);
  }
});

// PUT /api/coconut/expenses/:id
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const { grove_id, year, category, amount, expense_date, worker_id, notes } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM coconut_expenses WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    await db.prepare(`
      UPDATE coconut_expenses
      SET grove_id = ?, year = ?, category = ?, amount = ?, expense_date = ?, worker_id = ?, notes = ?
      WHERE id = ?
    `).run(
      grove_id || existing.grove_id,
      year || existing.year,
      category || existing.category,
      amount || existing.amount,
      expense_date || existing.expense_date,
      worker_id ?? existing.worker_id,
      notes ?? existing.notes,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM coconut_expenses WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating expense:', error);
    return c.json({ error: 'Failed to update expense' }, 500);
  }
});

// DELETE /api/coconut/expenses/:id
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_expenses WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    await db.prepare('DELETE FROM coconut_expenses WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return c.json({ error: 'Failed to delete expense' }, 500);
  }
});

// POST /api/coconut/expenses/categories - Add new expense category
router.post('/categories', async (c) => {
  const db = c.get('db');
  try {
    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));
    console.log('Adding category:', value, label, label_tamil);

    if (!value || !label) {
      return c.json({ error: 'Value and label are required' }, 400);
    }

    // Check if table exists, create if not
    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coconut_expense_categories'").get();
    console.log('Table exists:', tableExists);
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS coconut_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
      console.log('Table created');
    }

    // Check case-insensitively for existing - update if found
    const existing = await db.prepare('SELECT * FROM coconut_expense_categories WHERE LOWER(value) = LOWER(?)').get(value);
    console.log('Existing:', existing);
    if (existing) {
      // Update existing record
      await db.prepare('UPDATE coconut_expense_categories SET is_active = 1, label = ?, label_tamil = ? WHERE id = ?').run(label, label_tamil || null, existing.id);
      const updated = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(existing.id);
      console.log('Updated existing:', updated);
      return c.json(updated, 201);
    }

    const result = await db.prepare('INSERT INTO coconut_expense_categories (value, label, label_tamil) VALUES (?, ?, ?)').run(value, label, label_tamil || null);
    const newCategory = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(result.lastInsertRowid);
    console.log('New category created:', newCategory);
    return c.json(newCategory, 201);
  } catch (error) {
    console.error('Error creating expense category:', error);
    return c.json({ error: 'Failed to create expense category' }, 500);
  }
});

// PUT /api/coconut/expenses/categories/:id - Update expense category
router.put('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    await db.prepare('UPDATE coconut_expense_categories SET value = ?, label = ?, label_tamil = ? WHERE id = ?').run(
      value || existing.value,
      label || existing.label,
      label_tamil ?? existing.label_tamil,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating expense category:', error);
    return c.json({ error: 'Failed to update expense category' }, 500);
  }
});

// DELETE /api/coconut/expenses/categories/:id - Soft delete expense category
router.delete('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM coconut_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await db.prepare('UPDATE coconut_expense_categories SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    return c.json({ error: 'Failed to delete expense category' }, 500);
  }
});

// DELETE /api/coconut/expenses/categories - Hard delete ALL categories (cleanup)
router.delete('/categories', async (c) => {
  const db = c.get('db');
  try {
    await db.prepare('DELETE FROM coconut_expense_categories').run();
    return c.json({ message: 'All categories deleted' });
  } catch (error) {
    return c.json({ error: 'Failed to delete categories' }, 500);
  }
});

export default router;
