import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';
import { backupToGoogleDrive, backupToR2, createBackupFile } from '../utils/backup.js';

const router = new Hono();

router.use('*', authenticateToken);

// POST /api/backup/google-drive - Trigger backup to Google Drive
router.post('/google-drive', async (c) => {
  const db = c.get('db');
  try {
    const result = await backupToGoogleDrive(c.env, db);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      message: 'Backup completed successfully',
      fileName: result.fileName,
      googleDriveId: result.googleDriveId,
      createdTime: result.createdTime
    });
  } catch (error) {
    console.error('Error creating backup:', error);

    await db.prepare(`
      INSERT INTO backup_log (status, file_name)
      VALUES ('failed', ?)
    `).run(`Error: ${error.message}`);

    return c.json({ error: 'Failed to create backup', details: error.message }, 500);
  }
});

// POST /api/backup/local - "Local Backup" button: saves a backup in Cloudflare R2
router.post('/local', async (c) => {
  const db = c.get('db');
  try {
    const result = await backupToR2(c.env, db);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      message: 'Backup saved to Cloudflare storage',
      fileName: result.fileName
    });
  } catch (error) {
    console.error('Error creating R2 backup:', error);
    return c.json({ error: 'Failed to create backup' }, 500);
  }
});

// GET /api/backup/history - Get backup history
router.get('/history', async (c) => {
  const db = c.get('db');
  try {
    const backups = await db.prepare(`
      SELECT * FROM backup_log
      ORDER BY backup_date DESC
      LIMIT 50
    `).all();

    return c.json(backups);
  } catch (error) {
    console.error('Error fetching backup history:', error);
    return c.json({ error: 'Failed to fetch backup history' }, 500);
  }
});

// GET /api/backup/download - Download a fresh backup of all data
router.get('/download', async (c) => {
  try {
    const { fileName, body } = await createBackupFile(c.get('db'));

    return new Response(body, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Error downloading backup:', error);
    return c.json({ error: 'Failed to download backup' }, 500);
  }
});

export default router;
