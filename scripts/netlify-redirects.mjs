// Writes apps/web/dist/_redirects for Netlify from the API_URL environment
// variable, so the API address is configuration, not code.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.cwd(), 'apps/web/dist');
const rawApiUrl = (process.env.API_URL ?? '').trim();
// Be forgiving: accept a bare host, and a pasted trailing slash or "/api".
const apiUrl = (rawApiUrl && !/^[a-z]+:\/\//i.test(rawApiUrl) ? `https://${rawApiUrl}` : rawApiUrl)
  .replace(/\/+$/, '')
  .replace(/\/api$/i, '');

if (!process.env.NETLIFY && !apiUrl) {
  console.log('netlify-redirects: skipped (not a Netlify build and API_URL is not set).');
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(apiUrl)) {
  console.error(
    `netlify-redirects: API_URL is ${rawApiUrl ? `"${rawApiUrl}", which is not a valid address` : 'empty'}. ` +
      'Set it to the public HTTPS address of the API, e.g. https://your-api.up.railway.app',
  );
  process.exit(1);
}
if (!existsSync(dist)) {
  console.error(`netlify-redirects: ${dist} not found - build the web app first.`);
  process.exit(1);
}

const rules = [
  `/api/*      ${apiUrl}/api/:splat      200!`,
  `/uploads/*  ${apiUrl}/uploads/:splat  200!`,
  // Single-page app fallback (must be last).
  '/*          /index.html               200',
];
writeFileSync(resolve(dist, '_redirects'), `${rules.join('\n')}\n`, 'utf8');
console.log(`netlify-redirects: proxying /api and /uploads to ${apiUrl}`);
