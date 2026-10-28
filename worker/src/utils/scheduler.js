// Rent record generation.
// Called by the daily Cron Trigger and by the payments routes.
//
// Workers run in UTC. Rent rules follow the date in India, so "now" is
// shifted to IST and then read with the (UTC) date getters.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

const toYearMonth = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const insertRentSql = `
  INSERT INTO rent_payments (tenant_id, house_id, due_date, due_amount)
  VALUES (?, ?, ?, ?)
`;

async function getCurrentTenants(db) {
  return db.prepare(`
    SELECT t.id as tenant_id, t.house_id, t.move_in_date, h.rent_amount
    FROM tenants t
    JOIN houses h ON t.house_id = h.id
    WHERE t.is_current = 1
  `).all();
}

// Months that already have a rent record, as a Set of "tenantId:YYYY-MM".
// One query instead of one per tenant per month (D1 limits queries per request).
async function getExistingRentMonths(db) {
  const rows = await db.prepare(`
    SELECT rp.tenant_id, strftime('%Y-%m', rp.due_date) as ym
    FROM rent_payments rp
    JOIN tenants t ON rp.tenant_id = t.id
    WHERE t.is_current = 1
  `).all();
  return new Set(rows.map((r) => `${r.tenant_id}:${r.ym}`));
}

/**
 * Generate missing rent records for all current tenants
 * Backfills from move-in date to current month
 * - First rent is always next month after move-in
 * - If move-in after 15th, first rent is half amount
 */
export async function generateMissingRentRecords(db) {
  const currentTenants = await getCurrentTenants(db);
  const existing = await getExistingRentMonths(db);

  let totalSkipped = 0;
  const inserts = [];

  const now = nowIST();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10));

  for (const tenant of currentTenants) {
    const moveInDate = new Date(tenant.move_in_date);
    const moveInDay = moveInDate.getUTCDate();

    // First rent is always next month after move-in (10th of next month)
    let dueDate = new Date(Date.UTC(moveInDate.getUTCFullYear(), moveInDate.getUTCMonth() + 1, 10));
    let isFirstRent = true;

    // Loop from first due date to current month
    while (dueDate <= currentMonth) {
      // Only create records for months where the monthly job would have already run
      // (i.e., the 1st of that month has passed)
      const cronRunDate = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), 1));
      if (now < cronRunDate) {
        break;
      }

      const dueDateStr = dueDate.toISOString().split('T')[0];

      if (!existing.has(`${tenant.tenant_id}:${toYearMonth(dueDate)}`)) {
        // First rent is half if move-in was after 15th
        const rentAmount = (isFirstRent && moveInDay > 15)
          ? Math.round(tenant.rent_amount / 2)
          : tenant.rent_amount;

        inserts.push(db.prepare(insertRentSql).statement(tenant.tenant_id, tenant.house_id, dueDateStr, rentAmount));
      } else {
        totalSkipped++;
      }

      isFirstRent = false;
      // Move to next month
      dueDate.setUTCMonth(dueDate.getUTCMonth() + 1);
    }
  }

  if (inserts.length) {
    await db.batch(inserts);
  }

  return { created: inserts.length, skipped: totalSkipped, tenants: currentTenants.length };
}

/**
 * Generate rent records for current month only
 *
 * Rules:
 * - First rent is always for the NEXT month after move-in (not move-in month)
 * - If tenant moved in previous month after 15th: half rent for current month
 * - If tenant moved in previous month on/before 15th: full rent for current month
 * - For all other tenants: full rent
 */
export async function generateCurrentMonthRent(db) {
  const now = nowIST();
  const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10)); // 10th of current month
  const dueDateStr = dueDate.toISOString().split('T')[0];
  const yearMonth = toYearMonth(now);

  // Previous month for checking new tenants
  const prevYearMonth = toYearMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  const currentTenants = await getCurrentTenants(db);
  const existing = await getExistingRentMonths(db);

  let skipped = 0;
  const inserts = [];

  for (const tenant of currentTenants) {
    const moveInDate = new Date(tenant.move_in_date);
    const moveInYearMonth = toYearMonth(moveInDate);

    // Skip if tenant moved in current month (first rent is next month)
    if (moveInYearMonth === yearMonth) {
      skipped++;
      continue;
    }

    if (!existing.has(`${tenant.tenant_id}:${yearMonth}`)) {
      // Check if this is tenant's first rent (moved in last month)
      const isFirstRent = (moveInYearMonth === prevYearMonth);
      const moveInDay = moveInDate.getUTCDate();

      // First rent is half if move-in was after 15th
      const rentAmount = (isFirstRent && moveInDay > 15)
        ? Math.round(tenant.rent_amount / 2)
        : tenant.rent_amount;

      inserts.push(db.prepare(insertRentSql).statement(tenant.tenant_id, tenant.house_id, dueDateStr, rentAmount));
    } else {
      skipped++;
    }
  }

  if (inserts.length) {
    await db.batch(inserts);
  }

  return { created: inserts.length, skipped };
}
