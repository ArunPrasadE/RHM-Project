import { Hono } from 'hono';
import { authenticateToken } from '../../middleware/auth.js';

const router = new Hono();

router.use('*', authenticateToken);

// GET /api/paddy/expenses - List expenses with filters
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const { field_id, year, crop_number, category } = c.req.query();

    let query = 'SELECT * FROM paddy_expenses WHERE 1=1';
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

    query += ' ORDER BY expense_date DESC';

    const expenses = await db.prepare(query).all(...params);
    
    // Add worker and field names
    const workers = await db.prepare('SELECT id, name FROM paddy_workers WHERE is_active = 1').all();
    const fields = await db.prepare('SELECT id, name FROM paddy_fields WHERE is_active = 1').all();
    const workerMap = {};
    const fieldMap = {};
    workers.forEach(w => workerMap[w.id] = w.name);
    fields.forEach(f => fieldMap[f.id] = f.name);
    
    const result = expenses.map(e => ({
      ...e,
      worker_name: e.worker_id ? workerMap[e.worker_id] : null,
      field_name: fieldMap[e.field_id] || null
    }));
    
    return c.json(result);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return c.json({ error: 'Failed to fetch expenses' }, 500);
  }
});

// GET /api/paddy/expenses/categories - List all custom expense categories
router.get('/categories', async (c) => {
  const db = c.get('db');
  try {
    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paddy_expense_categories'").get();
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS paddy_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
      return c.json([]);
    }
    const categories = await db.prepare('SELECT * FROM paddy_expense_categories WHERE is_active = 1 ORDER BY label').all();
    return c.json(categories);
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    return c.json({ error: 'Failed to fetch expense categories' }, 500);
  }
});

// POST /api/paddy/expenses/categories - Add new expense category
router.post('/categories', async (c) => {
  const db = c.get('db');
  try {
    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    if (!value || !label) {
      return c.json({ error: 'Value and label are required' }, 400);
    }

    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paddy_expense_categories'").get();
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS paddy_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
    }

    const existing = await db.prepare('SELECT * FROM paddy_expense_categories WHERE LOWER(value) = LOWER(?)').get(value);
    if (existing) {
      await db.prepare('UPDATE paddy_expense_categories SET is_active = 1, label = ?, label_tamil = ? WHERE id = ?').run(label, label_tamil || null, existing.id);
      const updated = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(existing.id);
      return c.json(updated, 201);
    }

    const result = await db.prepare('INSERT INTO paddy_expense_categories (value, label, label_tamil) VALUES (?, ?, ?)').run(value, label, label_tamil || null);
    const newCategory = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(result.lastInsertRowid);
    return c.json(newCategory, 201);
  } catch (error) {
    console.error('Error creating expense category:', error);
    return c.json({ error: 'Failed to create expense category' }, 500);
  }
});

// PUT /api/paddy/expenses/categories/:id - Update expense category
router.put('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    await db.prepare('UPDATE paddy_expense_categories SET value = ?, label = ?, label_tamil = ? WHERE id = ?').run(
      value || existing.value,
      label || existing.label,
      label_tamil ?? existing.label_tamil,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating expense category:', error);
    return c.json({ error: 'Failed to update expense category' }, 500);
  }
});

// DELETE /api/paddy/expenses/categories/:id - Soft delete expense category
router.delete('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await db.prepare('UPDATE paddy_expense_categories SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    return c.json({ error: 'Failed to delete expense category' }, 500);
  }
});

// GET /api/paddy/expenses/:id
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const expense = await db.prepare('SELECT * FROM paddy_expenses WHERE id = ?').get(c.req.param('id'));

    if (!expense) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    return c.json(expense);
  } catch (error) {
    console.error('Error fetching expense:', error);
    return c.json({ error: 'Failed to fetch expense' }, 500);
  }
});

// POST /api/paddy/expenses - Split total amount across all fields OR direct to single field
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const {
      field_id,
      year,
      crop_number,
      category,
      sequence_number,
      total_amount,
      amount,
      expense_date,
      worker_id,
      notes
    } = await c.req.json().catch(() => ({}));

    if (!year || !crop_number || !category || !expense_date) {
      return c.json({ error: 'Year, crop number, category, and date are required' }, 400);
    }

    // Check if this is a direct expense to a single field (e.g., patta_nel)
    if (field_id && amount && !total_amount) {
      // Direct expense - no split
      if (!amount || amount <= 0) {
        return c.json({ error: 'Amount is required for direct expenses' }, 400);
      }

      const insertStmt = db.prepare(`
        INSERT INTO paddy_expenses (field_id, year, crop_number, category, sequence_number, amount, expense_date, worker_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = await insertStmt.run(
        field_id,
        year,
        crop_number,
        category,
        sequence_number || null,
        amount,
        expense_date,
        null, // No worker for direct expenses like patta_nel
        notes || null
      );

      const newExpense = await db.prepare('SELECT * FROM paddy_expenses WHERE id = ?').get(result.lastInsertRowid);
      const field = await db.prepare('SELECT name FROM paddy_fields WHERE id = ?').get(field_id);

      return c.json({
        message: `Direct expense added to ${field?.name || 'field'}`,
        amount: amount,
        expenses: [{ ...newExpense, field_name: field?.name }]
      }, 201);
      return;
    }

    // Default behavior: split across fields (all or selected)
    if (!total_amount) {
      return c.json({ error: 'Total amount is required for split expenses' }, 400);
    }

    // Get fields - either selected ones or all active fields
    let fields;
    const { field_ids } = await c.req.json().catch(() => ({}));
    if (field_ids && field_ids.length > 0) {
      const placeholders = field_ids.map(() => '?').join(',');
      fields = await db.prepare(`SELECT id, name, area_cents FROM paddy_fields WHERE is_active = 1 AND id IN (${placeholders})`).all(...field_ids);
    } else {
      fields = await db.prepare('SELECT id, name, area_cents FROM paddy_fields WHERE is_active = 1').all();
    }

    if (fields.length === 0) {
      return c.json({ error: 'No active fields found' }, 400);
    }

    // Calculate total area
    const totalAreaCents = fields.reduce((sum, field) => sum + field.area_cents, 0);

    // Insert expense for each field with proportional amount
    // One batch = one transaction: all fields are saved, or none
    const insertStmt = db.prepare(`
      INSERT INTO paddy_expenses (field_id, year, crop_number, category, sequence_number, amount, expense_date, worker_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const results = await db.batch(fields.map((field) => {
      // Calculate proportional amount: total_amount / total_area * field_area
      const fieldAmount = Math.round((total_amount / totalAreaCents * field.area_cents) * 100) / 100;

      return insertStmt.statement(
        field.id,
        year,
        crop_number,
        category,
        sequence_number || null,
        fieldAmount,
        expense_date,
        worker_id || null,
        notes || null
      );
    }));

    const createdExpenses = results.map((r, i) => ({ ...r.results[0], field_name: fields[i].name }));

    return c.json({
      message: `Expense split across ${fields.length} fields`,
      total_amount: total_amount,
      expenses: createdExpenses
    }, 201);
  } catch (error) {
    console.error('Error creating expense:', error);
    return c.json({ error: 'Failed to create expense' }, 500);
  }
});

// PUT /api/paddy/expenses/grouped - Update all expenses in a group (re-split total)
router.put('/grouped', async (c) => {
  const db = c.get('db');
  try {
    const {
      category,
      sequence_number,
      expense_date,
      year,
      crop_number,
      new_total_amount,
      worker_id,
      notes,
      // Old values to find the group
      old_category,
      old_sequence_number,
      old_expense_date,
      old_year,
      old_crop_number
    } = await c.req.json().catch(() => ({}));

    if (!new_total_amount) {
      return c.json({ error: 'New total amount is required' }, 400);
    }

    // Use old values to find the group, or current values if not provided
    const searchCategory = old_category ?? category;
    const searchSequence = old_sequence_number ?? sequence_number;
    const searchDate = old_expense_date ?? expense_date;
    const searchYear = old_year ?? year;
    const searchCrop = old_crop_number ?? crop_number;

    // Find all related expenses using OLD values
    const relatedExpenses = await db.prepare(`
      SELECT pe.*, pf.area_cents
      FROM paddy_expenses pe
      JOIN paddy_fields pf ON pe.field_id = pf.id
      WHERE pe.category = ?
        AND pe.sequence_number IS ?
        AND pe.expense_date = ?
        AND pe.year = ?
        AND pe.crop_number = ?
    `).all(searchCategory, searchSequence || null, searchDate, searchYear, searchCrop);

    if (relatedExpenses.length === 0) {
      return c.json({ error: 'No related expenses found' }, 404);
    }

    // Calculate total area from related expenses
    const totalAreaCents = relatedExpenses.reduce((sum, e) => sum + e.area_cents, 0);

    // Update all related expenses with new values
    const updateStmt = db.prepare(`
      UPDATE paddy_expenses
      SET year = ?, crop_number = ?, category = ?, sequence_number = ?, amount = ?, expense_date = ?, worker_id = ?, notes = ?
      WHERE id = ?
    `);

    // One batch = one transaction
    await db.batch(relatedExpenses.map((expense) => {
        const newAmount = Math.round((new_total_amount / totalAreaCents * expense.area_cents) * 100) / 100;
        return updateStmt.statement(
          year ?? expense.year,
          crop_number ?? expense.crop_number,
          category ?? expense.category,
          sequence_number ?? expense.sequence_number,
          newAmount,
          expense_date ?? expense.expense_date,
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

// PUT /api/paddy/expenses/:id
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const {
      field_id,
      year,
      crop_number,
      category,
      sequence_number,
      amount,
      expense_date,
      worker_id,
      notes
    } = await c.req.json().catch(() => ({}));

    const existing = await db.prepare('SELECT * FROM paddy_expenses WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    // Validate required fields
    if (!field_id || !year || !crop_number || !category || !amount || !expense_date) {
      return c.json({ 
        error: 'Missing required fields',
        required: ['field_id', 'year', 'crop_number', 'category', 'amount', 'expense_date']
      }, 400);
    }

    // Use nullish coalescing for proper handling of all values including 0
    await db.prepare(`
      UPDATE paddy_expenses
      SET field_id = ?, year = ?, crop_number = ?, category = ?, sequence_number = ?, amount = ?, expense_date = ?, worker_id = ?, notes = ?
      WHERE id = ?
    `).run(
      field_id ?? existing.field_id,
      year ?? existing.year,
      crop_number ?? existing.crop_number,
      category ?? existing.category,
      sequence_number ?? existing.sequence_number,
      amount ?? existing.amount,
      expense_date ?? existing.expense_date,
      worker_id ?? existing.worker_id,
      notes ?? existing.notes,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM paddy_expenses WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating expense:', error);
    return c.json({ error: 'Failed to update expense' }, 500);
  }
});

// DELETE /api/paddy/expenses/:id
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_expenses WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    await db.prepare('DELETE FROM paddy_expenses WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return c.json({ error: 'Failed to delete expense' }, 500);
  }
});

// GET /api/paddy/expenses/categories - List all custom expense categories
router.get('/categories', async (c) => {
  const db = c.get('db');
  try {
    // Check if table exists, create if not
    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paddy_expense_categories'").get();
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS paddy_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
      return c.json([]);
    }
    const categories = await db.prepare('SELECT * FROM paddy_expense_categories WHERE is_active = 1 ORDER BY label').all();
    return c.json(categories);
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    return c.json({ error: 'Failed to fetch expense categories' }, 500);
  }
});

// POST /api/paddy/expenses/categories - Add new expense category
router.post('/categories', async (c) => {
  const db = c.get('db');
  try {
    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    if (!value || !label) {
      return c.json({ error: 'Value and label are required' }, 400);
    }

    // Check if table exists, create if not
    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paddy_expense_categories'").get();
    if (!tableExists) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS paddy_expense_categories (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        label_tamil TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();
    }

    // Check case-insensitively for existing - update if found
    const existing = await db.prepare('SELECT * FROM paddy_expense_categories WHERE LOWER(value) = LOWER(?)').get(value);
    if (existing) {
      await db.prepare('UPDATE paddy_expense_categories SET is_active = 1, label = ?, label_tamil = ? WHERE id = ?').run(label, label_tamil || null, existing.id);
      const updated = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(existing.id);
      return c.json(updated, 201);
    }

    const result = await db.prepare('INSERT INTO paddy_expense_categories (value, label, label_tamil) VALUES (?, ?, ?)').run(value, label, label_tamil || null);
    const newCategory = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(result.lastInsertRowid);
    return c.json(newCategory, 201);
  } catch (error) {
    console.error('Error creating expense category:', error);
    return c.json({ error: 'Failed to create expense category' }, 500);
  }
});

// PUT /api/paddy/expenses/categories/:id - Update expense category
router.put('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const { value, label, label_tamil } = await c.req.json().catch(() => ({}));

    await db.prepare('UPDATE paddy_expense_categories SET value = ?, label = ?, label_tamil = ? WHERE id = ?').run(
      value || existing.value,
      label || existing.label,
      label_tamil ?? existing.label_tamil,
      c.req.param('id')
    );

    const updated = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(c.req.param('id'));
    return c.json(updated);
  } catch (error) {
    console.error('Error updating expense category:', error);
    return c.json({ error: 'Failed to update expense category' }, 500);
  }
});

// DELETE /api/paddy/expenses/categories/:id - Soft delete expense category
router.delete('/categories/:id', async (c) => {
  const db = c.get('db');
  try {
    const existing = await db.prepare('SELECT * FROM paddy_expense_categories WHERE id = ?').get(c.req.param('id'));

    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await db.prepare('UPDATE paddy_expense_categories SET is_active = 0 WHERE id = ?').run(c.req.param('id'));
    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    return c.json({ error: 'Failed to delete expense category' }, 500);
  }
});

export default router;
