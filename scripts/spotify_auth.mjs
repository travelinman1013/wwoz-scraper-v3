// Standalone helper to obtain a Spotify refresh token with required scopes
// Usage:
//   node scripts/spotify_auth.mjs --client-id <id> --client-secret <secret> [--host 127.0.0.1] [--port 8888]
// Then open the printed URL, approve, and copy the refresh token from the terminal output.

import http from 'http';
import { URL } from 'url';
import SpotifyWebApi from 'spotify-web-api-node';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const clientId = args['client-id'] || process.env.SPOTIFY_CLIENT_ID || '';
  const clientSecret = args['client-secret'] || process.env.SPOTIFY_CLIENT_SECRET || '';
  const host = args.host || process.env.SPOTIFY_AUTH_HOST || '127.0.0.1';
  const port = Number(args.port || process.env.SPOTIFY_AUTH_PORT || 8888);
  if (!clientId || !clientSecret) {
    console.error('Provide --client-id and --client-secret (or env vars SPOTIFY_CLIENT_ID/SECRET).');
    process.exit(1);
  }
  const redirectUri = `http://${host}:${port}/callback`;
  const scopes = [
    'ugc-image-upload',
    'playlist-modify-public',
    'playlist-modify-private',
    'playlist-read-private',
  ];

  const spotify = new SpotifyWebApi({ clientId, clientSecret, redirectUri });
  const authUrl = spotify.createAuthorizeURL(scopes, 'state123');
  console.log('\nOpen this URL in your browser and approve access:\n');
  console.log(authUrl);

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', `http://${host}:${port}`);
      if (u.pathname !== '/callback') {
        res.statusCode = 404;
        return res.end('Not Found');
      }
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      if (err) {
        res.statusCode = 400;
        res.end(`Error from Spotify: ${err}`);
        server.close();
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end('Missing code');
        return;
      }
      const tokenRes = await spotify.authorizationCodeGrant(code);
      const access = tokenRes.body.access_token;
      const refresh = tokenRes.body.refresh_token;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Authorization complete. You can close this window.');
      server.close();
      console.log('\nPaste this refresh token into config/config.yaml under spotify.refreshToken:\n');
      console.log(refresh);
      console.log('\nAccess token (temporary; not needed to save):\n');
      console.log(access);
    } catch (e) {
      console.error('Authorization exchange failed');
      console.error(e);
      try { res.statusCode = 500; res.end('Exchange failed'); } catch {}
      server.close();
    }
  });

  server.listen(port, host, () => {
    console.log(`\nWaiting on http://${host}:${port}/callback ...`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

