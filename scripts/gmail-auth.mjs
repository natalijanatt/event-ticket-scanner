// One-time helper: obtains a Gmail API refresh token for EMAIL_MODE=gmail.
//
//   node scripts/gmail-auth.mjs <client-id> <client-secret>
//
// Uses an OAuth client of type "Desktop app". Opens a consent page; sign in
// with the Gmail account that should SEND the e-mails. Prints the values to
// put in the environment. Nothing is written to disk.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const [clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/gmail-auth.mjs <client-id> <client-secret>');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;
const state = randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/gmail.send',
  access_type: 'offline',
  prompt: 'consent',
  state,
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  const code = url.searchParams.get('code');
  if (!code && !url.searchParams.get('error')) {
    res.writeHead(404).end();
    return;
  }
  const finish = (text, exitCode) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
    server.close();
    process.exitCode = exitCode;
  };
  if (!code || url.searchParams.get('state') !== state) {
    console.error(`Authorization failed: ${url.searchParams.get('error') ?? 'state mismatch'}`);
    finish('Autorizacija nije uspela. Pogledaj terminal.', 1);
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  const body = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !body.refresh_token) {
    console.error('Token exchange failed:', body.error ?? tokenRes.status, body.error_description ?? '');
    finish('Razmena tokena nije uspela. Pogledaj terminal.', 1);
    return;
  }

  console.log('\nAdd these to the environment (Railway variables / .env):\n');
  console.log(`GMAIL_CLIENT_ID="${clientId}"`);
  console.log(`GMAIL_CLIENT_SECRET="${clientSecret}"`);
  console.log(`GMAIL_REFRESH_TOKEN="${body.refresh_token}"`);
  finish('Gotovo. Vrati se u terminal – token je ispisan tamo.', 0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this address in the browser and sign in with the sending Gmail account:\n');
  console.log(authUrl.toString());
});
