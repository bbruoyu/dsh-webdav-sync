/**
 * Tests for backup format compatibility (dshmarket-compatible).
 * Tests the backup utility functions directly.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Import the backup functions from the compiled JS (bypasses TS type issues). */
async function getBackupUtils() {
	const mod = await import('../host/sync-service.js');
	return {
		createProfileBackup: mod.createProfileBackup,
		validatedBackup: mod.validatedBackup,
		restoreProfileBackup: mod.restoreProfileBackup,
		BACKUP_FORMAT: mod.BACKUP_FORMAT,
	};
}

function mktmp(): string {
	const dir = join(tmpdir(), `backup-unit-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function rmtmp(dir: string): void {
	try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

describe('backup format constants', () => {
	it('should export BACKUP_FORMAT', async () => {
		const { BACKUP_FORMAT } = await getBackupUtils();
		expect(BACKUP_FORMAT).toBe('dsh-profile-backup');
	});
});

describe('createProfileBackup', () => {
	it('should create a valid backup from a minimal profile', async () => {
		const { createProfileBackup } = await getBackupUtils();
		const tmp = mktmp();
		try {
			writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: {} }));
			writeFileSync(join(tmp, 'settings.yaml'), 'deepseek:\n  model: deepseek-chat\n');
			const backup = createProfileBackup('web', tmp);
			expect(backup.format).toBe('dsh-profile-backup');
			expect(backup.version).toBe(0.2);
			expect(backup.profile).toBe('web');
			expect(backup.files).toHaveLength(2);
			expect(backup.files.some(f => f.path === 'package.json')).toBe(true);
			expect(backup.files.some(f => f.path === 'settings.yaml')).toBe(true);
		} finally { rmtmp(tmp); }
	});

	it('should skip node_modules and .git', async () => {
		const { createProfileBackup } = await getBackupUtils();
		const tmp = mktmp();
		try {
			writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', dependencies: { 'dshmarket': '^1.0.0' } }));
			mkdirSync(join(tmp, 'node_modules'), { recursive: true });
			writeFileSync(join(tmp, 'node_modules', 'x.js'), 'module.exports={};');
			mkdirSync(join(tmp, '.git'), { recursive: true });
			writeFileSync(join(tmp, '.git', 'config'), '[core]');
			const backup = createProfileBackup('web', tmp);
			const paths = backup.files.map(f => f.path);
			expect(paths).not.toContain('node_modules/x.js');
			expect(paths).not.toContain('.git/config');
		} finally { rmtmp(tmp); }
	});

	it('should include nested subdirectories', async () => {
		const { createProfileBackup } = await getBackupUtils();
		const tmp = mktmp();
		try {
			writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test' }));
			mkdirSync(join(tmp, 'sub', 'nested'), { recursive: true });
			writeFileSync(join(tmp, 'sub', 'nested', 'a.txt'), 'hello');
			const backup = createProfileBackup('web', tmp);
			const paths = backup.files.map(f => f.path);
			expect(paths).toContain('sub/nested/a.txt');
		} finally { rmtmp(tmp); }
	});

	it('should fail without package.json', async () => {
		const { createProfileBackup } = await getBackupUtils();
		const tmp = mktmp();
		try {
			writeFileSync(join(tmp, 'settings.yaml'), 'key: val');
			expect(() => createProfileBackup('web', tmp)).toThrow('package.json is missing');
		} finally { rmtmp(tmp); }
	});
});

describe('validatedBackup', () => {
	it('should accept a valid backup', async () => {
		const { validatedBackup } = await getBackupUtils();
		const valid = {
			format: 'dsh-profile-backup',
			version: 0.2,
			createdAt: '2026-01-01T00:00:00.000Z',
			profile: 'web',
			files: [
				{ path: 'package.json', json: { name: 'test' } },
				{ path: 'settings.yaml', lines: ['key:', '  val'] },
			],
		};
		expect(() => validatedBackup(valid)).not.toThrow();
	});

	it('should reject invalid format', async () => {
		const { validatedBackup } = await getBackupUtils();
		expect(() => validatedBackup({ format: 'wrong', version: 0.2, files: [] })).toThrow('unsupported backup format');
	});

	it('should reject missing package.json', async () => {
		const { validatedBackup } = await getBackupUtils();
		expect(() => validatedBackup({ format: 'dsh-profile-backup', version: 0.2, files: [{ path: 'settings.yaml', lines: ['a'] }] })).toThrow('invalid backup contents');
	});

	it('should reject duplicate paths', async () => {
		const { validatedBackup } = await getBackupUtils();
		expect(() => validatedBackup({
			format: 'dsh-profile-backup', version: 0.2, files: [
				{ path: 'package.json', json: {} },
				{ path: 'package.json', json: {} },
			],
		})).toThrow('duplicate');
	});
});

describe('restoreProfileBackup', () => {
	it('should restore files to disk', async () => {
		const { validatedBackup, restoreProfileBackup } = await getBackupUtils();
		const tmp = mktmp();
		try {
			const backup = validatedBackup({
				format: 'dsh-profile-backup',
				version: 0.2,
				createdAt: '2026-01-01T00:00:00.000Z',
				profile: 'web',
				files: [
					{ path: 'package.json', json: { name: 'restored', dependencies: { 'dshmarket': '^1.0.0' } } },
					{ path: 'settings.yaml', lines: ['deepseek:', '  model: deepseek-chat'] },
				],
			});
			const result = restoreProfileBackup(backup, tmp);
			expect(result.files).toBe(2);
			expect(require('node:fs').existsSync(join(tmp, 'package.json'))).toBe(true);
			expect(require('node:fs').existsSync(join(tmp, 'settings.yaml'))).toBe(true);
			const pkg = JSON.parse(require('node:fs').readFileSync(join(tmp, 'package.json'), 'utf8'));
			expect(pkg.name).toBe('restored');
		} finally { rmtmp(tmp); }
	});
});
