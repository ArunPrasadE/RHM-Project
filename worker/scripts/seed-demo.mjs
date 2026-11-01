// Fills an empty RHM database with made-up demo data through the API, so every
// page has something to show. All names and numbers are invented.
// Used to build the read-only demo database: see README, "Demo data".
//
// Usage, against a local writable app (`npm run dev` with READ_ONLY= in .dev.vars):
//   RHM_USER=demo RHM_PASSWORD=demo1234 node scripts/seed-demo.mjs

const BASE = (process.env.RHM_URL || 'http://127.0.0.1:8787').replace(/\/$/, '') + '/api';

let token;
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

token = (await call('POST', '/auth/login', { username: process.env.RHM_USER || 'admin', password: process.env.RHM_PASSWORD })).token;

const existing = await call('GET', '/houses');
if (existing.length) {
  console.error('The database already has houses. Demo data goes into an empty database only.');
  process.exit(1);
}

const today = new Date();
const y = today.getUTCFullYear();
const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 5) => iso(new Date(Date.UTC(y, today.getUTCMonth() - n, day)));

// ---- Rental: 6 houses, 5 tenants (one house empty), a year of rent ----
const houses = [
  { house_number: 'A1', address: '12 Gandhi Street', type: '2BHK', size_sqft: 850, eb_service_number: 'EB-1101', motor_service_number: 'M-01', rent_amount: 6500 },
  { house_number: 'A2', address: '12 Gandhi Street', type: '1BHK', size_sqft: 550, eb_service_number: 'EB-1102', motor_service_number: 'M-01', rent_amount: 4500 },
  { house_number: 'A3', address: '12 Gandhi Street', type: '1BHK', size_sqft: 520, eb_service_number: 'EB-1103', motor_service_number: 'M-01', rent_amount: 4200 },
  { house_number: 'B1', address: '4 Temple Road', type: '3BHK', size_sqft: 1200, eb_service_number: 'EB-2201', motor_service_number: 'M-02', rent_amount: 9000 },
  { house_number: 'B2', address: '4 Temple Road', type: '2BHK', size_sqft: 800, eb_service_number: 'EB-2202', motor_service_number: 'M-02', rent_amount: 6000 },
  { house_number: 'C1', address: '9 Market Lane', type: 'Shop', size_sqft: 300, eb_service_number: 'EB-3301', rent_amount: 3500 },
];
const houseIds = [];
for (const h of houses) houseIds.push((await call('POST', '/houses', h)).id);

// [house index, name, months ago moved in, day of month, months left unpaid]
const tenants = [
  [0, 'Kumar Ravi', 14, 3, 0],
  [1, 'Lakshmi Sundar', 11, 20, 1],
  [2, 'Prakash Mani', 8, 10, 0],
  [3, 'Devi Raman', 13, 1, 2],
  [5, 'Senthil Stores', 6, 18, 0],
];
const tenantIds = [];
for (const [hi, name, ago, day] of tenants) {
  const t = await call('POST', '/tenants', {
    house_id: houseIds[hi], name, phone: `98${String(40000000 + hi * 1111111).slice(0, 8)}`,
    occupation: hi === 5 ? 'Grocery shop' : 'Salaried', household_members: hi === 5 ? 1 : 3,
    move_in_date: monthsAgo(ago, day), advance_amount: houses[hi].rent_amount * 3, advance_date: monthsAgo(ago, day),
  });
  tenantIds.push(t.id);
}
await call('POST', '/payments/backfill-missing');

// Pay every month except the last few for some tenants (the oldest unpaid month is paid first)
for (let i = 0; i < tenants.length; i++) {
  const list = (await call('GET', `/payments/tenant/${tenantIds[i]}/pending`)).payments;
  const toPay = list.length - tenants[i][4];
  for (let k = 0; k < toPay; k++) {
    const p = list[k];
    await call('POST', '/payments', {
      tenant_id: tenantIds[i], amount: p.pending_amount,
      payment_method: k % 3 === 0 ? 'cash' : 'upi', payment_date: p.due_date,
    });
  }
}

// Expenses: EB bills, house tax, a shared motor bill and a maintenance job
for (let i = 0; i < 4; i++) {
  await call('POST', '/expenses/eb-bill', { house_id: houseIds[i], amount: 600 + i * 150, due_date: monthsAgo(-1, 15), notes: 'Bi-monthly' });
}
await call('POST', '/expenses/house-tax', { house_id: houseIds[3], amount: 2400, due_date: monthsAgo(-2, 30) });
await call('POST', '/expenses/motor-bill', { motor_service_number: 'M-01', amount: 900, due_date: monthsAgo(-1, 5) });
await call('POST', '/maintenance', { description: 'Water tank cleaning', amount: 1800, expense_date: monthsAgo(1, 12), house_ids: [houseIds[0], houseIds[1], houseIds[2]] });

// ---- Coconut: 2 groves, workers, a year of expenses and sales ----
const groves = [];
groves.push((await call('POST', '/coconut/groves', { name: 'North Thoppu', area_cents: 150 })).id);
groves.push((await call('POST', '/coconut/groves', { name: 'River Thoppu', area_cents: 90 })).id);
const cw1 = (await call('POST', '/coconut/workers', { name: 'Murugan', category: 'thoppu_velai', place: 'Keezhur', mobile: '9000000011' })).id;
const cw2 = (await call('POST', '/coconut/workers', { name: 'Selvam', category: 'thengai_vettu_virpanai', place: 'Melur' })).id;
await call('POST', '/coconut/expenses/categories', { value: 'labour', label: 'Labour', label_tamil: 'கூலி' });
await call('POST', '/coconut/expenses/categories', { value: 'fertilizer', label: 'Fertilizer', label_tamil: 'உரம்' });
for (let m = 10; m >= 0; m -= 2) {
  const d = new Date(Date.UTC(y, today.getUTCMonth() - m, 8));
  await call('POST', '/coconut/expenses', { year: d.getUTCFullYear(), category: 'labour', total_amount: 2400, expense_date: iso(d), worker_id: cw1 });
  await call('POST', '/coconut/income', { grove_id: groves[0], year: d.getUTCFullYear(), category: 'coconut_sale', unit_type: 'count', quantity_count: 1800, rate_per_unit: 14, amount: 25200, income_date: iso(d), sale_time: 'morning' });
  await call('POST', '/coconut/income', { grove_id: groves[1], year: d.getUTCFullYear(), category: 'coconut_sale', unit_type: 'kg', quantity_kg: 420, rate_per_unit: 32, amount: 13440, income_date: iso(d) });
}
await call('POST', '/coconut/expenses', { grove_id: groves[0], year: y, category: 'fertilizer', amount: 5200, expense_date: monthsAgo(3, 2), worker_id: cw2, notes: 'Urea and potash' });

// ---- Paddy: 3 fields, two crops this year ----
const fields = [];
fields.push((await call('POST', '/paddy/fields', { name: 'Big Vayal', area_cents: 200 })).id);
fields.push((await call('POST', '/paddy/fields', { name: 'Pond Side', area_cents: 120 })).id);
fields.push((await call('POST', '/paddy/fields', { name: 'Corner Plot', area_cents: 45 })).id);
const pw = (await call('POST', '/paddy/workers', { name: 'Arumugam', category: 'harvester', place: 'Town' })).id;
await call('POST', '/paddy/workers', { name: 'Ganesan', category: 'tractor_manager', place: 'Keezhur' });
for (const [value, label, label_tamil] of [['ploughing', 'Ploughing', 'உழவு'], ['seeds', 'Seeds', 'விதை'], ['weeding', 'Weeding', 'களை எடுத்தல்'], ['harvest', 'Harvest', 'அறுவடை']]) {
  await call('POST', '/paddy/expenses/categories', { value, label, label_tamil });
}
for (const crop of [1, 2]) {
  const start = crop === 1 ? 1 : 6; // crop 1 from February, crop 2 from July
  const d = (mOff, day) => iso(new Date(Date.UTC(y, start + mOff, day)));
  await call('POST', '/paddy/expenses', { year: y, crop_number: crop, category: 'ploughing', sequence_number: 1, total_amount: 7300, expense_date: d(0, 5), worker_id: pw });
  await call('POST', '/paddy/expenses', { field_id: fields[0], year: y, crop_number: crop, category: 'seeds', amount: 3200, expense_date: d(0, 9) });
  await call('POST', '/paddy/expenses', { year: y, crop_number: crop, category: 'weeding', total_amount: 2600, expense_date: d(1, 2), field_ids: [fields[0], fields[1]] });
  await call('POST', '/paddy/expenses', { year: y, crop_number: crop, category: 'harvest', total_amount: 9500, expense_date: d(3, 20), worker_id: pw });
  await call('POST', '/paddy/income', { field_id: fields[0], year: y, crop_number: crop, category: 'paddy_sale', yield_kg: 2600, kottai_count: 32, rate_per_kottai: 1550, amount: 49600, income_date: d(3, 25) });
  await call('POST', '/paddy/income', { field_id: fields[1], year: y, crop_number: crop, category: 'paddy_sale', yield_kg: 1500, kottai_count: 19, rate_per_kottai: 1550, amount: 29450, income_date: d(3, 26) });
  await call('POST', '/paddy/income', { field_id: fields[0], year: y, crop_number: crop, category: 'straw', amount: 4000, income_date: d(3, 28) });
}

console.log('Demo data added.');
