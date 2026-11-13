import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// Loads the monorepo-root `.env` (or a local one) before anything reads
// process.env. Real environment variables always win over the file.
const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../../.env')];
for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
