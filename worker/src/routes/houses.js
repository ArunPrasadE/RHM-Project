import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';

const router = new Hono();

// Apply authentication to all routes
router.use('*', authenticateToken);

// GET /api/houses - List all houses
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const houses = await db.prepare(`
      SELECT h.*,
        (SELECT COUNT(*) FROM tenants t WHERE t.house_id = h.id AND t.is_current = 1) as has_tenant,
        (SELECT t.name FROM tenants t WHERE t.house_id = h.id AND t.is_current = 1) as current_tenant_name,
        (SELECT t.id FROM tenants t WHERE t.house_id = h.id AND t.is_current = 1) as current_tenant_id
      FROM houses h
      WHERE h.is_active = 1
      ORDER BY h.house_number
    `).all();

    return c.json(houses);
  } catch (error) {
    console.error('Error fetching houses:', error);
    return c.json({ error: 'Failed to fetch houses' }, 500);
  }
});

// GET /api/houses/:id - Get house details with current tenant
router.get('/:id', async (c) => {
  const db = c.get('db');
  try {
    const house = await db.prepare(`
      SELECT h.*,
        (SELECT COUNT(*) FROM tenants t WHERE t.house_id = h.id AND t.is_current = 1) as has_tenant
      FROM houses h
      WHERE h.id = ? AND h.is_active = 1
    `).get(c.req.param('id'));

    if (!house) {
      return c.json({ error: 'House not found' }, 404);
    }

    // Get current tenant if exists
    const currentTenant = await db.prepare(`
      SELECT * FROM tenants
      WHERE house_id = ? AND is_current = 1
    `).get(c.req.param('id'));

    // Get recent expenses
    const recentExpenses = await db.prepare(`
      SELECT * FROM expenses
      WHERE house_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(c.req.param('id'));

    // Get maintenance expenses for this house
    const maintenanceExpenses = await db.prepare(`
      SELECT me.*, meh.split_amount
      FROM maintenance_expenses me
      JOIN maintenance_expense_houses meh ON me.id = meh.maintenance_expense_id
      WHERE meh.house_id = ?
      ORDER BY me.expense_date DESC
      LIMIT 10
    `).all(c.req.param('id'));

    return c.json({
      ...house,
      currentTenant,
      recentExpenses,
      maintenanceExpenses
    });
  } catch (error) {
    console.error('Error fetching house:', error);
    return c.json({ error: 'Failed to fetch house' }, 500);
  }
});

// POST /api/houses - Add new house
router.post('/', async (c) => {
  const db = c.get('db');
  try {
    const {
      house_number,
      address,
      type,
      size_sqft,
      eb_service_number,
      motor_service_number,
      google_maps_url,
      rent_amount
    } = await c.req.json().catch(() => ({}));

    if (!house_number || !rent_amount) {
      return c.json({ error: 'House number and rent amount are required' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO houses (house_number, address, type, size_sqft, eb_service_number, motor_service_number, google_maps_url, rent_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(house_number, address, type, size_sqft, eb_service_number, motor_service_number, google_maps_url, rent_amount);

    const newHouse = await db.prepare('SELECT * FROM houses WHERE id = ?').get(result.lastInsertRowid);

    return c.json(newHouse, 201);
  } catch (error) {
    console.error('Error creating house:', error);
    return c.json({ error: 'Failed to create house' }, 500);
  }
});

// PUT /api/houses/:id - Update house
router.put('/:id', async (c) => {
  const db = c.get('db');
  try {
    const {
      house_number,
      address,
      type,
      size_sqft,
      eb_service_number,
      motor_service_number,
      google_maps_url,
      rent_amount
    } = await c.req.json().catch(() => ({}));

    const existingHouse = await db.prepare('SELECT * FROM houses WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existingHouse) {
      return c.json({ error: 'House not found' }, 404);
    }

    await db.prepare(`
      UPDATE houses
      SET house_number = ?, address = ?, type = ?, size_sqft = ?, eb_service_number = ?, motor_service_number = ?, google_maps_url = ?, rent_amount = ?
      WHERE id = ?
    `).run(
      house_number || existingHouse.house_number,
      address ?? existingHouse.address,
      type ?? existingHouse.type,
      size_sqft ?? existingHouse.size_sqft,
      eb_service_number ?? existingHouse.eb_service_number,
      motor_service_number ?? existingHouse.motor_service_number,
      google_maps_url ?? existingHouse.google_maps_url,
      rent_amount || existingHouse.rent_amount,
      c.req.param('id')
    );

    const updatedHouse = await db.prepare('SELECT * FROM houses WHERE id = ?').get(c.req.param('id'));

    return c.json(updatedHouse);
  } catch (error) {
    console.error('Error updating house:', error);
    return c.json({ error: 'Failed to update house' }, 500);
  }
});

// DELETE /api/houses/:id - Soft delete house
router.delete('/:id', async (c) => {
  const db = c.get('db');
  try {
    const existingHouse = await db.prepare('SELECT * FROM houses WHERE id = ? AND is_active = 1').get(c.req.param('id'));

    if (!existingHouse) {
      return c.json({ error: 'House not found' }, 404);
    }

    // Check if there's a current tenant
    const currentTenant = await db.prepare('SELECT * FROM tenants WHERE house_id = ? AND is_current = 1').get(c.req.param('id'));

    if (currentTenant) {
      return c.json({ error: 'Cannot delete house with active tenant. Move out the tenant first.' }, 400);
    }

    await db.prepare('UPDATE houses SET is_active = 0 WHERE id = ?').run(c.req.param('id'));

    return c.json({ message: 'House deleted successfully' });
  } catch (error) {
    console.error('Error deleting house:', error);
    return c.json({ error: 'Failed to delete house' }, 500);
  }
});

// GET /api/houses/:id/tenants - Get tenant history for a house
router.get('/:id/tenants', async (c) => {
  const db = c.get('db');
  try {
    const tenants = await db.prepare(`
      SELECT * FROM tenants
      WHERE house_id = ?
      ORDER BY move_in_date DESC
    `).all(c.req.param('id'));

    return c.json(tenants);
  } catch (error) {
    console.error('Error fetching tenant history:', error);
    return c.json({ error: 'Failed to fetch tenant history' }, 500);
  }
});

export default router;
