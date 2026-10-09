import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template
  .replace('replace-with-a-random-secret-at-least-32-characters-long', randomBytes(48).toString('hex'))
  .replace('replace-with-another-random-secret', randomBytes(32).toString('hex'));
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with random secrets. Run npm run dev (local) or docker compose up --build.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; left unchanged.');
  else throw error;
}
