import { getConfig } from './config/env.mjs';
import { openDatabase } from './db/database.mjs';
import { seedDatabase } from './db/seed.mjs';
import { createApp } from './app.mjs';
import { logger } from './utils/logger.mjs';

const config = getConfig();
const db = openDatabase(config.sqliteDbPath);
seedDatabase(db);

const server = createApp({ db, config });

if (process.argv[1]?.endsWith('index.mjs')) {
  server.listen(config.port, '127.0.0.1', () => {
    logger.info('ACTIONLOCK backend started', {
      url: `http://127.0.0.1:${config.port}`,
      database: config.sqliteDbPath,
      detectifAiConfigured: Boolean(config.detectifAi.apiKey),
    });
  });
}

export default server;
