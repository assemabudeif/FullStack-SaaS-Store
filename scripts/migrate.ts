import { loadConfig } from '../src/config.js';
import { connectDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
const db = await connectDatabase(loadConfig());
try { await migrate(db); console.log('Database migrations applied.'); }
finally { await db.close(); }
