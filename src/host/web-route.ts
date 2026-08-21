/**
 * Web route registration for REST API endpoints.
 * @module dsh-webdav-sync/web-route
 */

import type { SyncService } from './sync-service.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const API_PREFIX = '/api/webdav-sync';

export function registerWebRoutes(
	webServer: { register: (route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void },
	service: SyncService,
): void {
	webServer.register({
		kind: 'prefix',
		path: API_PREFIX,
		handler: (req, res) => {
			void handle(req, res, service);
		},
	});
}

async function handle(req: IncomingMessage, res: ServerResponse, service: SyncService): Promise<void> {
	try {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const path = url.pathname.slice(API_PREFIX.length) || '/';
		const method = (req.method ?? 'GET').toUpperCase();

		let value: unknown;
		if (method === 'GET' && path === '/status') {
			value = await service.status();
		} else if (method === 'POST' && path === '/sync') {
			value = await service.sync();
		} else if (method === 'POST' && path === '/pull') {
			value = await service.pull();
		} else if (method === 'POST' && path === '/push-config') {
			value = await service.pushConfig();
		} else if (method === 'POST' && path === '/pull-config') {
			value = await service.pullConfig();
		} else if (method === 'POST' && path === '/backup') {
			value = await service.uploadBackup('/dsh/backup.json');
		} else if (method === 'POST' && path === '/restore') {
			let body: { path?: string } = {};
			if (req.headers['content-type']?.includes('json')) {
				try {
					body = await new Promise<{ path?: string }>((resolve, reject) => {
						const chunks: Buffer[] = [];
						req.on('data', (c: Buffer) => chunks.push(c));
						req.on('end', () => {
							try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { path?: string }); }
							catch { resolve({}); }
						});
						req.on('error', reject);
					});
				} catch { /* ignore parse errors */ }
			}
			value = await service.downloadAndRestore(body.path || '/dsh/backup.json');
		} else if (method === 'POST' && path === '/test') {
			value = await service.testConnection();
		} else {
			writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `Unknown route ${method} ${path}` } });
			return;
		}

		writeJson(res, 200, { ok: true, value });
	} catch (err) {
		const code = (err as Error & { code?: string })?.code || 'internal';
		const message = typeof (err as Error).message === 'string' ? (err as Error).message : String(err);
		writeJson(res, 500, { ok: false, error: { code, message } });
	}
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	});
	res.end(JSON.stringify(body));
}
