/**
 * Web route registration for REST API endpoints.
 * @module dsh-webdav-sync/web-route
 */
const API_PREFIX = '/api/webdav-sync';
export function registerWebRoutes(webServer, service) {
    webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => {
            void handle(req, res, service);
        },
    });
}
async function handle(req, res, service) {
    try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname.slice(API_PREFIX.length) || '/';
        const method = (req.method ?? 'GET').toUpperCase();
        let value;
        if (method === 'GET' && path === '/status') {
            value = await service.status();
        }
        else if (method === 'POST' && path === '/sync') {
            value = await service.sync();
        }
        else if (method === 'POST' && path === '/pull') {
            value = await service.pull();
        }
        else if (method === 'POST' && path === '/push-config') {
            value = await service.pushConfig();
        }
        else if (method === 'POST' && path === '/pull-config') {
            value = await service.pullConfig();
        }
        else if (method === 'POST' && path === '/backup') {
            value = await service.uploadBackup('/dsh/backup.json');
        }
        else if (method === 'POST' && path === '/restore') {
            let body = {};
            if (req.headers['content-type']?.includes('json')) {
                try {
                    body = await new Promise((resolve, reject) => {
                        const chunks = [];
                        req.on('data', (c) => chunks.push(c));
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                            }
                            catch {
                                resolve({});
                            }
                        });
                        req.on('error', reject);
                    });
                }
                catch { /* ignore parse errors */ }
            }
            value = await service.downloadAndRestore(body.path || '/dsh/backup.json');
        }
        else if (method === 'POST' && path === '/test') {
            value = await service.testConnection();
        }
        else {
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `Unknown route ${method} ${path}` } });
            return;
        }
        writeJson(res, 200, { ok: true, value });
    }
    catch (err) {
        const code = err?.code || 'internal';
        const message = typeof err.message === 'string' ? err.message : String(err);
        writeJson(res, 500, { ok: false, error: { code, message } });
    }
}
function writeJson(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(body));
}
//# sourceMappingURL=web-route.js.map