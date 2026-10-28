import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';
import { getOverdueRentNotifications, getUpcomingExpenseNotifications } from '../utils/notifications.js';

const router = new Hono();

// Apply authentication to all routes
router.use('*', authenticateToken);

// GET /api/notifications - Get all active notifications
router.get('/', async (c) => {
  const db = c.get('db');
  try {
    const overdueRent = await getOverdueRentNotifications(db);
    const upcomingExpenses = await getUpcomingExpenseNotifications(db);

    return c.json({
      overdueRent,
      upcomingExpenses,
      totalCount: overdueRent.length + upcomingExpenses.length
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return c.json({ error: 'Failed to fetch notifications' }, 500);
  }
});

// GET /api/notifications/summary - Get notification counts only
router.get('/summary', async (c) => {
  const db = c.get('db');
  try {
    // Count overdue rent payments (7+ days after due date)
    const overdueCount = (await db.prepare(`
      SELECT COUNT(*) as count
      FROM rent_payments
      WHERE is_fully_paid = 0
        AND julianday('now') - julianday(due_date) >= 7
    `).get()).count;

    // Count upcoming expenses (within 7 days)
    const upcomingExpensesCount = (await db.prepare(`
      SELECT COUNT(*) as count
      FROM expenses
      WHERE is_paid = 0
        AND due_date IS NOT NULL
        AND julianday(due_date) - julianday('now') BETWEEN 0 AND 7
    `).get()).count;

    return c.json({
      overdueRentCount: overdueCount,
      upcomingExpensesCount: upcomingExpensesCount,
      totalCount: overdueCount + upcomingExpensesCount
    });
  } catch (error) {
    console.error('Error fetching notification summary:', error);
    return c.json({ error: 'Failed to fetch notification summary' }, 500);
  }
});

export default router;
