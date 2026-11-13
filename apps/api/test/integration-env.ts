import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// Integration tests run against TEST_DATABASE_URL only. DATABASE_URL from
// `.env` (which may point at Supabase) is deliberately overwritten so a test
// run can never touch real data.
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) config({ path: envFile });

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/event_platform?schema=test';
if (!/[?&]schema=test\b/.test(testUrl) && !/test/i.test(new URL(testUrl).pathname)) {
  throw new Error('TEST_DATABASE_URL must point at a dedicated test schema/database (e.g. ...?schema=test).');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
process.env.JWT_ACCESS_SECRET = 'integration-test-secret-integration-test-secret-0001';
process.env.TICKET_TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.PUBLIC_APP_URL = 'https://tickets.example.com';
process.env.WEB_ORIGINS = 'http://localhost:5173';
process.env.EMAIL_MODE = 'mock';
process.env.EMAIL_QUEUE_MODE = 'inline';
process.env.EMAIL_EMBED_QR = 'true';
process.env.COOKIE_SECURE = 'false';
process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('integration-webhook-secret').toString('base64')}`;
process.env.UPLOAD_DIR = './uploads-test';
