import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';

// Build an isolated in-memory app, never access the configured application DB.
const app = await buildApp({
  nodeEnv: 'development', host: '127.0.0.1', port: 3000,
  jwtSecret: randomBytes(48).toString('hex'), dataDir: 'memory://',
  corsOrigins: [], sandboxBilling: false, logger: false,
});
try {
  await mkdir('docs', { recursive: true });
  await writeFile('docs/openapi.json', `${JSON.stringify(app.swagger(), null, 2)}\n`);
  console.log('Exported docs/openapi.json');
} finally { await app.close(); }
