// Creates (or resets) the admin user in D1.
// Usage: npm run create-admin -- --local   (or --remote)
// The password is typed in, never stored in code or config.
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';

const target = process.argv.includes('--remote') ? '--remote' : '--local';

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const username = (await ask('Username [admin]: ')) || 'admin';
const password = await ask('Password (min 12 characters): ', true);
if (password.length < 12) {
  console.error('Password too short. Nothing changed.');
  process.exit(1);
}
const confirm = await ask('Repeat password: ', true);
if (password !== confirm) {
  console.error('Passwords do not match. Nothing changed.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const sql = `INSERT INTO users (username, password_hash) VALUES ('${username.replace(/'/g, "''")}', '${hash}')
ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;`;

// Pass the SQL through a temp file so the hash never appears on a command line
const dir = mkdtempSync(join(tmpdir(), 'rhm-admin-'));
const file = join(dir, 'admin.sql');
writeFileSync(file, sql);
try {
  execSync(`npx wrangler d1 execute rhm ${target} --file "${file}"`, { stdio: 'inherit' });
  console.log(`Admin user "${username}" saved (${target.slice(2)}).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
