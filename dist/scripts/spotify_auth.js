// Minimal local auth helper to obtain a Spotify refresh token with required scopes
// Usage:
// 1) npm run build
// 2) node dist/scripts/spotify_auth.js --client-id <id> --client-secret <secret> [--port 8888]
//    It will print an auth URL; open it, approve scopes, and the script will print your refresh token.
import http from 'http';
import { URL } from 'url';
import { Logger } from '../utils/logger.js';
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
    const port = Number(args.port || process.env.SPOTIFY_AUTH_PORT || 8888);
    if (!clientId || !clientSecret) {
        console.error('Provide --client-id and --client-secret (or env vars SPOTIFY_CLIENT_ID/SECRET).');
        process.exit(1);
    }
    const redirectUri = `http://localhost:${port}/callback`;
    const scopes = [
        'ugc-image-upload',
        'playlist-modify-public',
        'playlist-modify-private',
        'playlist-read-private',
    ];
    const spotify = new SpotifyWebApi({ clientId, clientSecret, redirectUri });
    const authUrl = spotify.createAuthorizeURL(scopes, 'state123');
    Logger.info('Open this URL in your browser and approve access:');
    console.log(authUrl);
    const server = http.createServer(async (req, res) => {
        try {
            const u = new URL(req.url || '/', `http://localhost:${port}`);
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
            Logger.info('Paste this refresh token into config/config.yaml under spotify.refreshToken:');
            console.log(refresh);
            Logger.info('Access token (temporary; not needed to save):');
            console.log(access);
        }
        catch (e) {
            Logger.error('Authorization exchange failed', e);
            try {
                res.statusCode = 500;
                res.end('Exchange failed');
            }
            catch { }
            server.close();
        }
    });
    server.listen(port, () => {
        Logger.info(`Waiting on http://localhost:${port}/callback ...`);
    });
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
