// Backups: D1 has no database file to copy, so every table is exported as SQL.
//
// The export is a restorable SQL script, gzip-compressed:
//   gunzip rhm_backup_YYYY_MM_DD.sql.gz
//   npx wrangler d1 execute rhm --remote --file rhm_backup_YYYY_MM_DD.sql
// It replaces the data in every table (the tables must already exist:
// run the migrations first on a new database).

const KEEP_BACKUPS = 12;
const R2_PREFIX = 'backups/';

// Tables that belong to D1/Wrangler, not to RHM
const isAppTable = (name) => !/^(sqlite_|_cf_|d1_migrations)/.test(name);

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = new Uint8Array(v instanceof ArrayBuffer ? v : v.buffer);
    return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Parents before children, from the REFERENCES clauses in each table's SQL.
// D1's remote import checks foreign keys per statement (it ignores
// PRAGMA defer_foreign_keys), so rows must be inserted in this order.
export function dependencyOrder(tables) {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(tables.map((t) => [
    t.name,
    [...(t.sql || '').matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map((m) => m[1]).filter((d) => d !== t.name && names.has(d)),
  ]));
  const ordered = [];
  const visit = (name, seen = new Set()) => {
    if (ordered.includes(name) || seen.has(name)) return;
    seen.add(name);
    for (const dep of deps.get(name)) visit(dep, seen);
    ordered.push(name);
  };
  [...names].sort().forEach((n) => visit(n));
  return ordered;
}

// All tables as one SQL script (string)
export async function exportDatabaseSql(db) {
  const tables = dependencyOrder((await db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all()).filter((t) => isAppTable(t.name)));

  const lines = [
    `-- RHM backup, ${new Date().toISOString()}`,
    '-- Restore: npx wrangler d1 execute rhm --remote --file <this file>',
    'PRAGMA defer_foreign_keys = true;',
    '',
    '-- Empty every table, children first',
    ...[...tables].reverse().map((table) => `DELETE FROM "${table}";`),
  ];

  // Refill, parents first
  for (const table of tables) {
    const rows = await db.prepare(`SELECT * FROM "${table}"`).all();
    lines.push('', `-- ${table}: ${rows.length} rows`);
    for (const row of rows) {
      const cols = Object.keys(row);
      lines.push(
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => sqlValue(row[c])).join(', ')});`
      );
    }
  }

  return lines.join('\n') + '\n';
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Same date format as the old Drive backups: rhm_backup_2026_10_24
export function backupFileName(date = new Date()) {
  return `rhm_backup_${date.toISOString().split('T')[0].replace(/-/g, '_')}.sql.gz`;
}

export async function createBackupFile(db) {
  return { fileName: backupFileName(), body: await gzip(await exportDatabaseSql(db)) };
}

async function logBackup(db, status, fileName, googleDriveId = null) {
  await db.prepare(`
    INSERT INTO backup_log (status, file_name, google_drive_id)
    VALUES (?, ?, ?)
  `).run(status, fileName, googleDriveId);
}

// ---------- Cloudflare R2 ----------

export async function backupToR2(env, db) {
  if (!env.BACKUPS) {
    return { success: false, error: 'R2 backup not configured (no BACKUPS bucket binding)' };
  }

  const { fileName, body } = await createBackupFile(db);
  await env.BACKUPS.put(R2_PREFIX + fileName, body, {
    httpMetadata: { contentType: 'application/gzip' },
  });

  await logBackup(db, 'success', `r2:${fileName}`);

  // Keep the last 12 (names sort by date)
  const listed = await env.BACKUPS.list({ prefix: R2_PREFIX });
  const keys = listed.objects.map((o) => o.key).sort().reverse();
  if (keys.length > KEEP_BACKUPS) {
    await env.BACKUPS.delete(keys.slice(KEEP_BACKUPS));
  }

  return { success: true, fileName };
}

// ---------- Google Drive ----------
// Uses the owner's Google account (OAuth refresh token, scope drive.file).
// Service accounts can no longer store files in a personal Drive, which is
// why the old service-account setup is not used.

const DRIVE_FOLDER_NAME = 'RHM Backups';

async function getGoogleAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

async function driveFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!res.ok) {
    throw new Error(`Google Drive error ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// drive.file only sees files this app created, so the app makes its own folder
// (unless GOOGLE_DRIVE_FOLDER_ID names one it created earlier)
async function getDriveFolderId(env, token) {
  if (env.GOOGLE_DRIVE_FOLDER_ID) return env.GOOGLE_DRIVE_FOLDER_ID;

  const q = `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (found.files.length) return found.files[0].id;

  const created = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return created.id;
}

export function isGoogleDriveConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

export async function backupToGoogleDrive(env, db) {
  if (!isGoogleDriveConfigured(env)) {
    return {
      success: false,
      error: 'Google Drive backup not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN as Worker secrets.'
    };
  }

  const token = await getGoogleAccessToken(env);
  const folderId = await getDriveFolderId(env, token);
  const { fileName, body } = await createBackupFile(db);

  // Multipart upload: metadata + file in one request
  const boundary = `rhm-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
    body,
    `\r\n--${boundary}--\r\n`,
  ]);

  const uploaded = await driveFetch(
    token,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }
  );

  await logBackup(db, 'success', fileName, uploaded.id);

  // Clean up old backups (keep last 12)
  const q = `'${folderId}' in parents and name contains 'rhm_backup_' and trashed = false`;
  const backups = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id)`
  );
  for (const file of backups.files.slice(KEEP_BACKUPS)) {
    await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE' });
  }

  return {
    success: true,
    fileName,
    googleDriveId: uploaded.id,
    createdTime: uploaded.createdTime
  };
}

// ---------- Monthly job ----------

// Runs both backups; a failure in one does not stop the other
export async function runMonthlyBackups(env, db) {
  for (const [label, run] of [['R2', backupToR2], ['Google Drive', backupToGoogleDrive]]) {
    try {
      const result = await run(env, db);
      if (result.success) {
        console.log(`[Scheduler] ${label} backup complete: ${result.fileName}`);
      } else {
        console.log(`[Scheduler] ${label} backup skipped: ${result.error}`);
      }
    } catch (error) {
      console.error(`[Scheduler] ${label} backup failed:`, error);
      try {
        await logBackup(db, 'failed', `Scheduled ${label} backup error: ${error.message}`);
      } catch (dbError) {
        console.error('[Scheduler] Failed to log backup error to database:', dbError);
      }
    }
  }
}
