// Runs before the test framework and before any src/ module is imported, which
// matters because constants.ts reads POSTS_DIR/BACKUPS_DIR at import time.
// A plain .js file (not .ts) so nothing here ends up in dist.
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-backend-test-'));

fs.mkdirSync(path.join(root, 'posts'), { recursive: true });
fs.mkdirSync(path.join(root, 'backups'), { recursive: true });

process.env.NODE_ENV = 'test';
process.env.POSTS_DIR = path.join(root, 'posts');
process.env.BACKUPS_DIR = path.join(root, 'backups');
// Empty token means the auth middleware is a no-op, so specs can call services
// and controllers without threading a bearer token through every call.
process.env.API_TOKEN = '';
process.env.BACKUP_PRUNE_ENABLED = 'false';

// Jest workers exit without running afterEach once the last suite finishes.
process.on('exit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort: the OS reclaims the temp directory anyway.
  }
});
