import { Hono } from 'hono';
import { createDb } from './lib/db.js';
import { requireAccess } from './middleware/access.js';
import authRoutes from './routes/auth.js';
import housesRoutes from './routes/houses.js';
import tenantsRoutes from './routes/tenants.js';
import paymentsRoutes from './routes/payments.js';
import expensesRoutes from './routes/expenses.js';
import maintenanceRoutes from './routes/maintenance.js';
import notificationsRoutes from './routes/notifications.js';
import unifiedRoutes from './routes/unified.js';
import reportsRoutes from './routes/reports.js';
import backupRoutes from './routes/backup.js';

// Paddy module routes
import paddyFieldsRoutes from './routes/paddy/fields.js';
import paddyWorkersRoutes from './routes/paddy/workers.js';
import paddyExpensesRoutes from './routes/paddy/expenses.js';
import paddyIncomeRoutes from './routes/paddy/income.js';
import paddyReportsRoutes from './routes/paddy/reports.js';

// Coconut module routes
import coconutGrovesRoutes from './routes/coconut/groves.js';
import coconutWorkersRoutes from './routes/coconut/workers.js';
import coconutExpensesRoutes from './routes/coconut/expenses.js';
import coconutIncomeRoutes from './routes/coconut/income.js';
import coconutReportsRoutes from './routes/coconut/reports.js';

import { generateMissingRentRecords, nowIST } from './utils/scheduler.js';
import { runMonthlyBackups } from './utils/backup.js';

const app = new Hono({ strict: false }).basePath('/api');

// Cloudflare Access check (off when ACCESS_AUD is empty)
app.use('*', requireAccess);

// Make the database wrapper available to every route as c.get('db')
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DB));
  await next();
});

// API Routes - Rental Module
app.route('/auth', authRoutes);
app.route('/houses', housesRoutes);
app.route('/tenants', tenantsRoutes);
app.route('/payments', paymentsRoutes);
app.route('/expenses', expensesRoutes);
app.route('/maintenance', maintenanceRoutes);
app.route('/notifications', notificationsRoutes);
app.route('/reports', reportsRoutes);
app.route('/backup', backupRoutes);
app.route('/unified', unifiedRoutes);

// API Routes - Paddy Module
app.route('/paddy/fields', paddyFieldsRoutes);
app.route('/paddy/workers', paddyWorkersRoutes);
app.route('/paddy/expenses', paddyExpensesRoutes);
app.route('/paddy/income', paddyIncomeRoutes);
app.route('/paddy/reports', paddyReportsRoutes);

// API Routes - Coconut Module
app.route('/coconut/groves', coconutGrovesRoutes);
app.route('/coconut/workers', coconutWorkersRoutes);
app.route('/coconut/expenses', coconutExpensesRoutes);
app.route('/coconut/income', coconutIncomeRoutes);
app.route('/coconut/reports', coconutReportsRoutes);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handling
app.onError((err, c) => {
  console.error(err.stack);
  return c.json({ error: 'Something went wrong!' }, 500);
});

export default {
  fetch: app.fetch,

  // Daily at 00:05 IST. The backfill is idempotent, so running it every day
  // creates each month's rent records on the 1st and repairs any missed day.
  // On the 1st (IST) it also backs up to R2 and Google Drive.
  async scheduled(controller, env, ctx) {
    const db = createDb(env.DB);
    const result = await generateMissingRentRecords(db);
    console.log(`[Scheduler] Rent backfill: ${result.created} created, ${result.skipped} already existed for ${result.tenants} tenants`);

    if (nowIST().getUTCDate() === 1) {
      await runMonthlyBackups(env, db);
    }
  },
};
