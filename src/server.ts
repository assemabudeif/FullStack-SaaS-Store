import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    try { await app.close(); clearTimeout(timeout); }
    catch (error) { app.log.error(error); process.exitCode = 1; }
  });
}
try { await app.listen({ port: config.port, host: config.host }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
