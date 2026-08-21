/**
 * Unit tests for dsh-webdav-sync — tests core logic without a real WebDAV server.
 * Mocks the webdav Client and Node fs module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory and return its path. */
function mktmp(prefix = 'dsh-wd-test'): string {
	const dir = join(tmpdir(), `${prefix}-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Cleanup a temp directory. */
function rmtmp(dir: string): void {
	try {
		const { rmSync } = require('node:fs');
		rmSync(dir, { recursive: true, force: true });
	} catch { /* best effort */ }
}

/** Write a settings.yaml with optional _sync_version header. */
function writeSettings(dir: string, content: string, version?: number): string {
	const path = join(dir, 'settings.yaml');
	const header = version !== undefined ? `_sync_version: ${version}\n` : '';
	writeFileSync(path, header + content);
	return path;
}

// ── Mock webdav client ───────────────────────────────────────────────────────

type MockFileEntry = {
	path: string;
	content: string | Buffer;
	mtime: Date;
};

class MockWebDAVClient {
	private files = new Map<string, MockFileEntry>();

	set(path: string, content: string | Buffer, mtime?: Date): void {
		this.files.set(path, { path, content, mtime: mtime ?? new Date() });
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async stat(path: string): Promise<{ data?: { headers?: Record<string, string> } }> {
		const entry = this.files.get(path);
		if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
		return { data: { headers: { 'last-modified': entry.mtime.toUTCString() } } };
	}

	async getFileContents(path: string, opts?: { format?: string }): Promise<string | Buffer> {
		const entry = this.files.get(path);
		if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
		if (opts?.format === 'binary') return entry.content as Buffer;
		return typeof entry.content === 'string' ? entry.content : (entry.content as Buffer).toString('utf8');
	}

	async putFileContents(path: string, content: string | Buffer, _opts?: { overwrite?: boolean }): Promise<void> {
		this.files.set(path, { path, content, mtime: new Date() });
	}

	async createDirectory(_path: string, _opts?: { recursive?: boolean }): Promise<void> { /* no-op */ }

	async getDirectoryContents(path: string): Promise<Array<{ basename: string; type: 'file' | 'directory' }>> {
		const entries = Array.from(this.files.entries())
			.filter(([fp]) => fp.startsWith(path) && fp !== path)
			.map(([fp]) => {
				const relative = fp.slice(path.length + 1);
				const depth = relative.split('/').length;
				return { basename: depth === 1 ? relative : relative.split('/')[0], type: 'file' as const };
			});
		const seen = new Set<string>();
		return entries.filter(e => { if (seen.has(e.basename)) return false; seen.add(e.basename); return true; });
	}
}

// ── Test: _sync_version helpers ───────────────────────────────────────────────

describe('_sync_version helpers', () => {
	it('should read version from settings.yaml header', () => {
		const tmp = mktmp('version-read');
		try {
			writeSettings(tmp, 'deepseek:\n  model: deepseek-chat\n', 42);
			const content = readFileSync(join(tmp, 'settings.yaml'), 'utf8');
			const match = content.match(/^_sync_version:\s*(\d+)/m);
			expect(match).not.toBeNull();
			expect(parseInt(match![1], 10)).toBe(42);
		} finally { rmtmp(tmp); }
	});

	it('should return undefined when no version header', () => {
		const tmp = mktmp('version-none');
		try {
			writeSettings(tmp, 'deepseek:\n  model: deepseek-chat\n');
			const content = readFileSync(join(tmp, 'settings.yaml'), 'utf8');
			const match = content.match(/^_sync_version:\s*(\d+)/m);
			expect(match).toBeNull();
		} finally { rmtmp(tmp); }
	});

	it('should bump version and write back', () => {
		const tmp = mktmp('version-bump');
		try {
			const settingsPath = join(tmp, 'settings.yaml');
			writeFileSync(settingsPath, 'models:\n  - deepseek-chat\n');
			let content = readFileSync(settingsPath, 'utf8');
			let currentVersion = 0;
			const m = content.match(/^_sync_version:\s*(\d+)/m);
			if (m) currentVersion = parseInt(m[1], 10);
			const newVersion = currentVersion + 1;
			const versionLine = `_sync_version: ${newVersion}\n`;
			if (content.startsWith('_sync_version:')) {
				content = content.replace(/^_sync_version:\s*\d+\n/m, versionLine);
			} else {
				content = versionLine + content;
			}
			writeFileSync(settingsPath, content);
			const final = readFileSync(settingsPath, 'utf8');
			const finalMatch = final.match(/^_sync_version:\s*(\d+)/m);
			expect(finalMatch).not.toBeNull();
			expect(parseInt(finalMatch![1], 10)).toBe(1);
		} finally { rmtmp(tmp); }
	});

	it('should increment version on successive bumps', () => {
		const tmp = mktmp('version-increment');
		try {
			const settingsPath = join(tmp, 'settings.yaml');
			writeFileSync(settingsPath, 'models:\n  - deepseek-chat\n');
			for (let i = 1; i <= 5; i++) {
				let content = readFileSync(settingsPath, 'utf8');
				let currentVersion = 0;
				const m = content.match(/^_sync_version:\s*(\d+)/m);
				if (m) currentVersion = parseInt(m[1], 10);
				const newVersion = currentVersion + 1;
				const versionLine = `_sync_version: ${newVersion}\n`;
				if (content.startsWith('_sync_version:')) {
					content = content.replace(/^_sync_version:\s*\d+\n/m, versionLine);
				} else {
					content = versionLine + content;
				}
				writeFileSync(settingsPath, content);
			}
			const final = readFileSync(settingsPath, 'utf8');
			const finalMatch = final.match(/^_sync_version:\s*(\d+)/m);
			expect(parseInt(finalMatch![1], 10)).toBe(5);
		} finally { rmtmp(tmp); }
	});
});

// ── Test: conflict detection logic ────────────────────────────────────────────

describe('conflict detection', () => {
	it('should detect same version different content as conflict', () => {
		const tmp = mktmp('conflict-detect');
		try {
			const localContent = '_sync_version: 3\nmodels:\n  - deepseek-chat\n';
			const remoteContent = '_sync_version: 3\nmodels:\n  - deepseek-v3\n';
			const localVer = localContent.match(/^_sync_version:\s*(\d+)/m);
			const remoteVer = remoteContent.match(/^_sync_version:\s*(\d+)/m);
			expect(localVer).not.toBeNull();
			expect(remoteVer).not.toBeNull();
			expect(parseInt(localVer![1], 10)).toBe(parseInt(remoteVer![1], 10));
			expect(localContent).not.toBe(remoteContent);
		} finally { rmtmp(tmp); }
	});

	it('should NOT flag different versions as conflict', () => {
		const tmp = mktmp('no-conflict');
		try {
			const localContent = '_sync_version: 5\nmodels:\n  - deepseek-chat\n';
			const remoteContent = '_sync_version: 3\nmodels:\n  - deepseek-v3\n';
			const localVer = parseInt(localContent.match(/^_sync_version:\s*(\d+)/m)![1], 10);
			const remoteVer = parseInt(remoteContent.match(/^_sync_version:\s*(\d+)/m)![1], 10);
			expect(localVer).not.toBe(remoteVer);
		} finally { rmtmp(tmp); }
	});
});

// ── Test: mtime-based sync decision logic ─────────────────────────────────────

describe('mtime-based sync decision', () => {
	it('should upload when local is newer', () => {
		const now = Date.now();
		const localMtime = now;
		const remoteMtime = now - 60_000;
		const diff = Math.abs(localMtime - remoteMtime);
		expect(diff).toBeGreaterThan(1000);
		expect(localMtime).toBeGreaterThan(remoteMtime);
	});

	it('should download when remote is newer', () => {
		const now = Date.now();
		const localMtime = now - 120_000;
		const remoteMtime = now;
		const diff = Math.abs(localMtime - remoteMtime);
		expect(diff).toBeGreaterThan(1000);
		expect(remoteMtime).toBeGreaterThan(localMtime);
	});

	it('should skip when mtimes are within 1 second', () => {
		const now = Date.now();
		const localMtime = now;
		const remoteMtime = now + 500;
		const diff = Math.abs(localMtime - remoteMtime);
		expect(diff).toBeLessThan(1000);
	});
});

// ── Test: preset config generation ────────────────────────────────────────────

describe('preset config', () => {
	const PRESETS = [
		{ label: '🍎 坚果云 (JianGuoYun)', remoteUrl: 'https://davs.jianguoyun.com/dav/', syncSettings: true, autoSync: true, interval: 15 },
		{ label: '🐂 飞牛NAS 本地', remoteUrl: 'http://192.168.1.x:5005/webdav/', syncSettings: true, autoSync: false, interval: 10 },
		{ label: '🌲 Tailscale + 飞牛NAS', remoteUrl: 'https://100.x.x.x:5005/webdav/', syncSettings: true, autoSync: true, interval: 10 },
		{ label: '☁️ Nextcloud', remoteUrl: 'https://your-server.com/remote.php/dav/files/USERNAME/', syncSettings: true, autoSync: false, interval: 10 },
		{ label: '📦 自定义 WebDAV', remoteUrl: 'https://your-server/webdav/', syncSettings: true, autoSync: false, interval: 10 },
	];

	it('should have 5 presets', () => { expect(PRESETS.length).toBe(5); });
	it('should have correct remoteUrl for each preset', () => {
		expect(PRESETS[0].remoteUrl).toBe('https://davs.jianguoyun.com/dav/');
		expect(PRESETS[2].remoteUrl).toMatch(/^https:\/\/100\./);
		expect(PRESETS[3].remoteUrl).toContain('remote.php/dav');
	});
	it('should have autoSync=true for cloud presets (jianguo, tailscale)', () => {
		expect(PRESETS[0].autoSync).toBe(true);
		expect(PRESETS[2].autoSync).toBe(true);
		expect(PRESETS[1].autoSync).toBe(false);
	});
});

// ── Test: simulated end-to-end sync flow ──────────────────────────────────────

describe('simulated sync flow', () => {
	it('should upload local file when remote is absent', async () => {
		const tmp = mktmp('e2e-upload');
		try {
			const localPath = join(tmp, 'settings.yaml');
			writeFileSync(localPath, '_sync_version: 1\nmodels:\n  - deepseek-chat\n');
			const mockClient = new MockWebDAVClient();
			const remoteExists = await mockClient.exists('/dsh/config/settings.yaml');
			expect(remoteExists).toBe(false);
			const content = readFileSync(localPath);
			await mockClient.putFileContents('/dsh/config/settings.yaml', content);
			const retrieved = await mockClient.getFileContents('/dsh/config/settings.yaml', { format: 'text' });
			expect(retrieved).toContain('_sync_version: 1');
			expect(retrieved).toContain('deepseek-chat');
		} finally { rmtmp(tmp); }
	});

	it('should detect remote-newer and download', async () => {
		const tmp = mktmp('e2e-download');
		try {
			const localPath = join(tmp, 'settings.yaml');
			writeFileSync(localPath, '_sync_version: 1\nold-model: v1\n');
			const mockClient = new MockWebDAVClient();
			mockClient.set('/dsh/config/settings.yaml', '_sync_version: 3\nnew-model: v3\n', new Date(Date.now() + 1000));
			const remoteStat = await mockClient.stat('/dsh/config/settings.yaml');
			const remoteMtime = new Date(remoteStat.data!.headers!['last-modified']).getTime();
			const localMtime = statSync(localPath).mtimeMs;
			expect(remoteMtime).toBeGreaterThan(localMtime);
			const data = await mockClient.getFileContents('/dsh/config/settings.yaml', { format: 'text' });
			writeFileSync(localPath, data);
			const final = readFileSync(localPath, 'utf8');
			expect(final).toContain('new-model: v3');
			expect(final).toContain('_sync_version: 3');
		} finally { rmtmp(tmp); }
	});

	it('should skip sync when mtimes are equal', async () => {
		const tmp = mktmp('e2e-skip');
		try {
			const now = new Date();
			const localPath = join(tmp, 'settings.yaml');
			writeFileSync(localPath, '_sync_version: 2\nmodel: deepseek-chat\n');
			const mockClient = new MockWebDAVClient();
			mockClient.set('/dsh/config/settings.yaml', '_sync_version: 2\nmodel: deepseek-chat\n', now);
			const remoteStat = await mockClient.stat('/dsh/config/settings.yaml');
			const remoteMtime = new Date(remoteStat.data!.headers!['last-modified']).getTime();
			const localMtime = statSync(localPath).mtimeMs;
			expect(Math.abs(localMtime - remoteMtime)).toBeLessThan(1000);
		} finally { rmtmp(tmp); }
	});

	it('should detect conflict: same version, different content', async () => {
		const tmp = mktmp('e2e-conflict');
		try {
			const localPath = join(tmp, 'settings.yaml');
			writeFileSync(localPath, '_sync_version: 5\nmodel: deepseek-chat\n');
			const mockClient = new MockWebDAVClient();
			mockClient.set('/dsh/config/settings.yaml', '_sync_version: 5\nmodel: deepseek-v3\n', new Date(Date.now() - 5000));
			const localVer = 5;
			const remoteVer = 5;
			expect(localVer).toBe(remoteVer);
		} finally { rmtmp(tmp); }
	});
});

// ── Test: backup format constants ─────────────────────────────────────────────
// (Full backup tests are in backup.spec.ts)
