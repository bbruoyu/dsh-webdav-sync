/**
 * Core sync service — WebDAV connection and file synchronization.
 * @module dsh-webdav-sync/sync-service
 */

import { createClient } from 'webdav';
import type { WebDAVClient as Client } from 'webdav';
import {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	mkdirSync,
	statSync,
	unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const TAG = 'dsh-webdav-sync';

interface SyncResult {
	uploaded: number;
	downloaded: number;
	unchanged: number;
	conflicts: number;
	errors: string[];
}

interface StatusResult {
	connected: boolean;
	lastSync: string | null;
	lastError: string | null;
	syncing: boolean;
	configSummary: { remoteUrl: string; username: string };
}

interface PluginConfig {
	remoteUrl: string;
	username: string;
	password: string;
	syncSessions: boolean;
	syncSettings: boolean;
	syncAttachments: boolean;
	syncPresets: boolean;
	syncPet: boolean;
	autoSync: boolean;
	syncIntervalMin: number;
	pullOnStartup: boolean;
	remoteRoot: string;
	conflictStrategy: 'newer-wins' | 'remote-wins' | 'local-wins';
	manualOnly: boolean; // if true, auto-sync timer is disabled regardless of autoSync flag
}

/** One available session archive on the remote. */
export interface RemoteSession {
	project: string;
	sessionId: string;
	filename: string;
	remotePath: string;
	mtimeMs: number;
	sizeBytes: number;
}

function resolveDshHome(): string {
	return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

function dshHome(...segments: string[]): string {
	return join(resolveDshHome(), ...segments);
}

/**
 * Encode a cwd string into a safe path segment.
 * Replaces path separators and controls characters, truncates to 100 chars.
 */
function _encodeSegment(cwd: string): string {
	return cwd
		.replace(/[\/\\:*?"<>|]/g, '_')
		.slice(0, 100)
		|| '_no-cwd_';
}

/** Delete an empty directory (best-effort). */
function removeEmptyDir(path: string): void {
	try {
		const entries = readdirSync(path);
		if (entries.length === 0) unlinkSync(path); // will throw if not empty dir; that's fine
	} catch { /* ignore */ }
}

/**
 * Read the _sync_version field from a YAML config file.
 * Returns undefined if the file doesn't exist or has no version field.
 */
function readSyncVersion(localPath: string): number | undefined {
	if (!existsSync(localPath)) return undefined;
	try {
		const content = readFileSync(localPath, 'utf8');
		const match = content.match(/^_sync_version:\s*(\d+)/m);
		return match ? parseInt(match[1], 10) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Ensure the file has a _sync_version header, then increment and write it back.
 * Returns the new version number.
 */
function bumpSyncVersion(localPath: string): number {
	let content = '';
	let currentVersion = 0;

	if (existsSync(localPath)) {
		content = readFileSync(localPath, 'utf8');
		const match = content.match(/^_sync_version:\s*(\d+)/m);
		currentVersion = match ? parseInt(match[1], 10) : 0;
	}

	const newVersion = currentVersion + 1;
	const versionLine = `_sync_version: ${newVersion}\n`;

	if (content.startsWith('_sync_version:')) {
		// Replace existing version line
		content = content.replace(/^_sync_version:\s*\d+\n/m, versionLine);
	} else {
		// Prepend version line
		content = versionLine + content;
	}

	writeFileSync(localPath, content);
	return newVersion;
}

// ── Profile backup (format-compatible with dshmarket) ──────────────────────
// Adapted from dshmarket/src/backup.ts (MIT, Copyright DeepSeek 2026).
// We use the same wire format so a backup from one can be restored by the other.

/** dshmarket-compatible backup format identifier. */
export const BACKUP_FORMAT = 'dsh-profile-backup';
/** Maximum serialized backup size (2 MB). */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_BACKUP_FILES = 256;
const SKIP_NAMES = new Set(['node_modules', '.dsh-market', '.git', 'pnpm-lock.yaml']);

export interface BackupFile {
	path: string;
	json?: Record<string, unknown>;
	lines?: string[];
}

export interface ProfileBackup {
	format: typeof BACKUP_FORMAT;
	version: 0.2;
	createdAt: string;
	profile: string;
	files: BackupFile[];
}

interface BackupOptions {
	includeDeps?: string[];
	includeConfig?: boolean;
}

function backupFiles(root: string, dir = root): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_NAMES.has(entry.name) || /\.bak-\d+$/.test(entry.name)) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) files.push(...backupFiles(root, fullPath));
		else if (entry.isFile()) {
			// Build relative path; normalize Windows backslashes to forward slashes
			const rel = fullPath.slice(root.length + 1).replace(/\\/g, '/');
			files.push(rel);
		}
		if (files.length > MAX_BACKUP_FILES) throw new Error(`profile has more than ${MAX_BACKUP_FILES} configuration files`);
	}
	return files;
}

/**
 * Serialize the DSH profile directory into a dshmarket-compatible backup JSON.
 * @param profile - profile name (used for metadata only)
 * @param dir - profile directory (defaults to DSH_HOME)
 */
export function createProfileBackup(profile: string, dir?: string, opts?: BackupOptions): ProfileBackup {
	const root = dir ?? resolveDshHome();
	const manifestPath = join(root, 'package.json');
	if (!existsSync(manifestPath)) throw new Error('profile package.json is missing');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

	if (opts?.includeDeps !== undefined) {
		const include = new Set(opts.includeDeps);
		if (include.size === 0) throw new Error('no plugins selected');
		const deps = manifest.dependencies === null || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)
			? {}
			: manifest.dependencies as Record<string, unknown>;
		const filteredDeps: Record<string, unknown> = {};
		for (const [name, spec] of Object.entries(deps)) if (include.has(name)) filteredDeps[name] = spec;
		const dsh = manifest.dsh === null || typeof manifest.dsh !== 'object' || Array.isArray(manifest.dsh)
			? undefined
			: manifest.dsh as { profile?: unknown };
		const profileBlock = dsh?.profile === null || typeof dsh?.profile !== 'object' || Array.isArray(dsh?.profile)
			? undefined
			: dsh.profile as { bundles?: unknown };
		const bundles = Array.isArray(profileBlock?.bundles) ? profileBlock.bundles as unknown[] : [];
		const filteredBundles = bundles.filter((name): name is string => typeof name === 'string' && include.has(name));
		if (Object.keys(filteredDeps).length === 0 && filteredBundles.length === 0) {
			throw new Error('none of the selected plugins are in this profile');
		}
		const filteredManifest: Record<string, unknown> = { ...manifest };
		filteredManifest.dependencies = filteredDeps;
		if (dsh !== undefined) {
			filteredManifest.dsh = { ...dsh, profile: { ...(profileBlock ?? {}), bundles: filteredBundles } };
		}
		const files: BackupFile[] = [{ path: 'package.json', json: filteredManifest }];
		if (opts?.includeConfig === true) {
			for (const rel of backupFiles(root).sort()) {
				if (rel === 'package.json') continue;
				files.push({ path: rel, lines: readFileSync(join(root, rel), 'utf8').split(/\r?\n/) });
			}
		}
		const partial: ProfileBackup = { format: BACKUP_FORMAT, version: 0.2, createdAt: new Date().toISOString(), profile, files };
		if (Buffer.byteLength(JSON.stringify(partial)) > MAX_BACKUP_BYTES) throw new Error('profile configuration is too large to back up');
		return partial;
	}

	const files: BackupFile[] = backupFiles(root).sort().map((rel) => {
		const content = readFileSync(join(root, rel), 'utf8');
		return rel === 'package.json'
			? { path: rel, json: JSON.parse(content) as Record<string, unknown> }
			: { path: rel, lines: content.split(/\r?\n/) };
	});
	if (!files.some(f => f.path === 'package.json')) throw new Error('profile package.json is missing');
	const backup: ProfileBackup = { format: BACKUP_FORMAT, version: 0.2, createdAt: new Date().toISOString(), profile, files };
	if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES) throw new Error('profile configuration is too large to back up');
	return backup;
}

/** Strictly validate a deserialized backup object. */
export function validatedBackup(value: unknown): ProfileBackup {
	if (value === null || typeof value !== 'object') throw new Error('invalid backup');
	const backup = value as Partial<ProfileBackup>;
	if (backup.format !== BACKUP_FORMAT || backup.version !== 0.2 || !Array.isArray(backup.files)) {
		throw new Error('unsupported backup format');
	}
	if (backup.files.length > MAX_BACKUP_FILES) throw new Error('invalid backup contents');
	const files: BackupFile[] = [];
	const paths = new Set<string>();
	for (const raw of backup.files as unknown[]) {
		if (raw === null || typeof raw !== 'object') throw new Error('invalid backup contents');
		const file = raw as { path?: unknown; json?: unknown; lines?: unknown };
		const path = file.path;
		if (typeof path !== 'string' || path === '' || path.includes('..') || path.startsWith('/')) {
			throw new Error(`unsafe backup path: ${path}`);
		}
		if (paths.has(path)) throw new Error(`duplicate backup path: ${path}`);
		paths.add(path);
		if (SKIP_NAMES.has(path.split('/')[0])) throw new Error(`excluded backup path: ${path}`);
		if (path === 'package.json') {
			if (file.json === null || typeof file.json !== 'object' || Array.isArray(file.json)) throw new Error('backup package.json is invalid');
			files.push({ path, json: file.json as Record<string, unknown> });
		} else {
			if (!Array.isArray(file.lines) || !file.lines.every(l => typeof l === 'string')) throw new Error(`invalid file content: ${path}`);
			files.push({ path, lines: file.lines as string[] });
		}
	}
	if (!files.some(f => f.path === 'package.json')) throw new Error('invalid backup contents');
	if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES) throw new Error('backup is too large');
	return { ...backup, files } as ProfileBackup;
}

/**
 * Restore a validated backup to the DSH home directory.
 * Returns the number of files written.
 */
export function restoreProfileBackup(value: unknown, dir?: string): { files: number } {
	const backup = validatedBackup(value);
	const root = dir ?? resolveDshHome();
	mkdirSync(root, { recursive: true });
	for (const file of backup.files) {
		const target = join(root, file.path);
		const parent = dirname(target);
		if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
		writeFileSync(target, 'json' in file ? `${JSON.stringify(file.json, null, 2)}\n` : file.lines!.join('\n'), 'utf8');
	}
	console.log(`[${TAG}] Restored ${backup.files.length} files from backup`);
	return { files: backup.files.length };
}

export class SyncService {
	private _client: Client | null = null;
	private _stopped = false;
	private _syncing = false;
	private _lastSync: Date | null = null;
	private _lastError: string | null = null;
	private _timer: ReturnType<typeof setInterval> | null = null;
	private _getConfig: () => Record<string, unknown>;

	constructor(getConfig: () => Record<string, unknown>) {
		this._getConfig = getConfig;
	}

	private get _cfg(): PluginConfig {
		const base = this._getConfig() ?? {};
		return {
			remoteUrl: String(base.remoteUrl ?? 'https://your-nas.local:5005/webdav/'),
			username: String(base.username ?? ''),
			password: String(base.password ?? ''),
			syncSessions: Boolean(base.syncSessions ?? false),
			syncSettings: Boolean(base.syncSettings ?? true),
			syncAttachments: Boolean(base.syncAttachments ?? false),
			syncPresets: Boolean(base.syncPresets ?? true),
			syncPet: Boolean(base.syncPet ?? false),
			autoSync: Boolean(base.autoSync ?? false),
			syncIntervalMin: Number(base.syncIntervalMin ?? 60),
			pullOnStartup: Boolean(base.pullOnStartup ?? false),
			remoteRoot: String(base.remoteRoot ?? '/dsh/'),
			conflictStrategy: String(base.conflictStrategy ?? 'newer-wins') as PluginConfig['conflictStrategy'],
			manualOnly: Boolean(base.manualOnly ?? true),
		};
	}

	async start(): Promise<void> {
		await this._ensureClient();
		// manualOnly mode: only auto-sync if explicitly enabled AND not in manual-only mode
		const shouldAutoSync = this._cfg.autoSync && !this._cfg.manualOnly && this._cfg.syncIntervalMin > 0;
		if (this._client && shouldAutoSync) {
			const intervalMs = this._cfg.syncIntervalMin * 60 * 1000;
			this._timer = setInterval(async () => {
				if (!this._stopped && !this._syncing) {
					await this.sync();
				}
			}, intervalMs);
			console.log(`[${TAG}] Auto-sync: every ${this._cfg.syncIntervalMin} min`);
		} else if (this._cfg.manualOnly) {
			console.log(`[${TAG}] Manual-only mode: use /webdav-sync push-config / pull-config / upload-sess / download-sess`);
		}
	}

	stop(): void {
		this._stopped = true;
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	private async _ensureClient(): Promise<boolean> {
		if (this._client) return true;
		const cfg = this._cfg;
		if (!cfg.username || !cfg.password) {
			console.log(`[${TAG}] Not configured — set remoteUrl/username/password in settings`);
			return false;
		}
		try {
			this._client = createClient(cfg.remoteUrl, {
				username: cfg.username,
				password: cfg.password,
			});
			await this._client.exists(cfg.remoteRoot);
			console.log(`[${TAG}] Connected: ${cfg.remoteUrl}`);
			return true;
		} catch (err) {
			console.error(`[${TAG}] Connect failed:`, (err as Error).message ?? err);
			this._client = null;
			return false;
		}
	}

	private async _getClient(): Promise<Client> {
		if (!this._client) {
			if (!(await this._ensureClient())) {
				throw new Error('WebDAV not configured or connection failed');
			}
		}
		return this._client;
	}

	/** Full bidirectional sync (push + pull). */
	async sync(): Promise<SyncResult> {
		if (this._syncing) {
			console.log(`[${TAG}] Sync in progress, skipping`);
			return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		}
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };

		try {
			const client = await this._getClient();
			const cfg = this._cfg;

			if (cfg.syncSettings) {
				const r = await this._syncLocalFile(client, dshHome('settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`);
				this._merge(result, r);
			}
			if (cfg.syncSessions) {
				const r = await this._syncSessions(client, cfg);
				this._merge(result, r);
			}
			if (cfg.syncAttachments) {
				const r = await this._syncDir(client, dshHome('attachments', 'v1', 'objects'), `${cfg.remoteRoot}attachments/v1/objects`);
				this._merge(result, r);
			}
			if (cfg.syncPresets) {
				const r = await this._syncDir(client, dshHome('.agent-presets'), `${cfg.remoteRoot}presets`);
				this._merge(result, r);
			}
			if (cfg.syncPet) {
				const r = await this._syncLocalFile(client, dshHome('pet.json'), `${cfg.remoteRoot}config/pet.json`);
				this._merge(result, r);
			}
		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}

		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) {
			result.errors.unshift('Sync failed');
			this._lastError = result.errors.join('; ');
		} else {
			this._lastSync = new Date();
			this._lastError = null;
		}

		const elapsed = Date.now() - start;
		console.log(`[${TAG}] Sync done: +${result.uploaded} /-${result.downloaded} =${result.unchanged} ⚔️${result.conflicts} (${elapsed}ms)`);
		this._syncing = false;
		return result;
	}

	/** Pull-only: download remote files to local. */
	async pull(): Promise<SyncResult> {
		if (this._syncing) {
			console.log(`[${TAG}] Pull in progress, skipping`);
			return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		}
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };

		try {
			const client = await this._getClient();
			const cfg = this._cfg;

			if (cfg.syncSettings) {
				const r = await this._pullLocalFile(client, dshHome('settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`);
				this._merge(result, r);
			}
			if (cfg.syncSessions) {
				const r = await this._pullSessions(client, cfg);
				this._merge(result, r);
			}
			if (cfg.syncAttachments) {
				const r = await this._pullDir(client, dshHome('attachments', 'v1', 'objects'), `${cfg.remoteRoot}attachments/v1/objects`);
				this._merge(result, r);
			}
			if (cfg.syncPresets) {
				const r = await this._pullDir(client, dshHome('.agent-presets'), `${cfg.remoteRoot}presets`);
				this._merge(result, r);
			}
			if (cfg.syncPet) {
				const r = await this._pullLocalFile(client, dshHome('pet.json'), `${cfg.remoteRoot}config/pet.json`);
				this._merge(result, r);
			}
		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}

		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) {
			result.errors.unshift('Pull failed');
			this._lastError = result.errors.join('; ');
		} else {
			this._lastSync = new Date();
			this._lastError = null;
		}

		const elapsed = Date.now() - start;
		console.log(`[${TAG}] Pull done: ${result.downloaded} files downloaded (${elapsed}ms)`);
		this._syncing = false;
		return result;
	}

	// ── Manual config-only sync (push or pull settings/presets only) ───────────

	/** Push only config files (settings.yaml, presets, pet.json) to remote. */
	async pushConfig(): Promise<SyncResult> {
		if (this._syncing) return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const client = await this._getClient();
			const cfg = this._cfg;
			if (cfg.syncSettings) {
				const r = await this._syncLocalFile(client, dshHome('settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`);
				this._merge(result, r);
			}
			if (cfg.syncPresets) {
				const r = await this._syncDir(client, dshHome('.agent-presets'), `${cfg.remoteRoot}presets`);
				this._merge(result, r);
			}
			if (cfg.syncPet) {
				const r = await this._syncLocalFile(client, dshHome('pet.json'), `${cfg.remoteRoot}config/pet.json`);
				this._merge(result, r);
			}
		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}
		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) this._lastError = result.errors.join('; ');
		else { this._lastSync = new Date(); this._lastError = null; }
		console.log(`[${TAG}] Push-config done: +${result.uploaded} /-${result.downloaded} =${result.unchanged} (${Date.now() - start}ms)`);
		this._syncing = false;
		return result;
	}

	/** Pull only config files from remote to local. */
	async pullConfig(): Promise<SyncResult> {
		if (this._syncing) return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const client = await this._getClient();
			const cfg = this._cfg;
			if (cfg.syncSettings) {
				const r = await this._pullLocalFile(client, dshHome('settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`);
				this._merge(result, r);
			}
			if (cfg.syncPresets) {
				const r = await this._pullDir(client, dshHome('.agent-presets'), `${cfg.remoteRoot}presets`);
				this._merge(result, r);
			}
			if (cfg.syncPet) {
				const r = await this._pullLocalFile(client, dshHome('pet.json'), `${cfg.remoteRoot}config/pet.json`);
				this._merge(result, r);
			}
		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}
		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) this._lastError = result.errors.join('; ');
		else { this._lastSync = new Date(); this._lastError = null; }
		console.log(`[${TAG}] Pull-config done: ${result.downloaded} files (${Date.now() - start}ms)`);
		this._syncing = false;
		return result;
	}

	// ── Manual session upload (push current session → remote, then clear local) ─

	/**
	 * Upload the current session's log to WebDAV, then delete the local file.
	 * @param cwd - normalized cwd of the session (project dir name)
	 * @param sessionId - session ID
	 */
	async uploadSession(cwd: string, sessionId: string): Promise<SyncResult> {
		if (this._syncing) return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };

		try {
			const client = await this._getClient();
			const cfg = this._cfg;
			const projectDir = _encodeSegment(cwd);
			const sessionDir = join(dshHome('sessions'), projectDir, sessionId);
			if (!existsSync(sessionDir)) {
				result.errors.push(`Session not found: ${cwd}/${sessionId}`);
				this._syncing = false;
				return result;
			}
			const files = readdirSync(sessionDir);
			const logFile = files.find(f => f.endsWith('.jsonl.zstd'));
			if (!logFile) {
				result.errors.push(`No session log found in ${sessionId}`);
				this._syncing = false;
				return result;
			}

			const localPath = join(sessionDir, logFile);
			const remotePath = `${cfg.remoteRoot}sessions/${projectDir}/${sessionId}/${logFile}`;

			// Upload
			await this._uploadFile(client, localPath, remotePath);
			result.uploaded++;
			console.log(`[${TAG}] Uploaded session: ${cwd}/${sessionId}/${logFile}`);

			// Delete local file after successful upload
			unlinkSync(localPath);
			console.log(`[${TAG}] Deleted local session log: ${localPath}`);

			// Clean up empty session directory
			try {
				const remaining = readdirSync(sessionDir);
				if (remaining.length === 0) {
					removeEmptyDir(sessionDir);
					console.log(`[${TAG}] Removed empty session dir: ${sessionDir}`);
				}
			} catch { /* ignore */ }

		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}

		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) this._lastError = result.errors.join('; ');
		else { this._lastSync = new Date(); this._lastError = null; }
		console.log(`[${TAG}] Upload-session done: +${result.uploaded} (${Date.now() - start}ms)`);
		this._syncing = false;
		return result;
	}

	/**
	 * Download a specific session from WebDAV to local.
	 * If a local session with the same ID already exists, it will be overwritten.
	 * @param cwd - normalized cwd (project dir name)
	 * @param sessionId - session ID
	 */
	async downloadSession(cwd: string, sessionId: string): Promise<SyncResult> {
		if (this._syncing) return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };

		try {
			const client = await this._getClient();
			const cfg = this._cfg;
			const projectDir = _encodeSegment(cwd);
			const localSessionDir = join(dshHome('sessions'), projectDir, sessionId);
			const remoteSessionDir = `${cfg.remoteRoot}sessions/${projectDir}/${sessionId}`;

			// List remote files
			const remoteFiles = await client.getDirectoryContents(remoteSessionDir).catch(() => [] as any[]);
			const logFiles = remoteFiles.filter((f: any) => f.type === 'file' && f.basename.endsWith('.jsonl.zstd'));

			if (logFiles.length === 0) {
				result.errors.push(`No session log found on remote: ${cwd}/${sessionId}`);
				this._syncing = false;
				return result;
			}

			// Create local directory
			mkdirSync(localSessionDir, { recursive: true });

			for (const file of logFiles) {
				const remotePath = `${remoteSessionDir}/${file.basename}`;
				const localPath = join(localSessionDir, file.basename);
				const data = await client.getFileContents(remotePath, { format: 'binary' });
				this._writeFile(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
				result.downloaded++;
				console.log(`[${TAG}] Downloaded session: ${cwd}/${sessionId}/${file.basename}`);
			}

		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}

		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) this._lastError = result.errors.join('; ');
		else { this._lastSync = new Date(); this._lastError = null; }
		console.log(`[${TAG}] Download-session done: -${result.downloaded} files (${Date.now() - start}ms)`);
		this._syncing = false;
		return result;
	}

	/**
	 * List all session archives available on the remote WebDAV.
	 */
	async listRemoteSessions(): Promise<RemoteSession[]> {
		try {
			const client = await this._getClient();
			const cfg = this._cfg;
			const sessions: RemoteSession[] = [];

			const projects = await client.getDirectoryContents(`${cfg.remoteRoot}sessions`).catch(() => [] as any[]);
			for (const proj of projects) {
				if (proj.type !== 'directory') continue;
				const sessionsList = await client.getDirectoryContents(`${cfg.remoteRoot}sessions/${proj.basename}`).catch(() => [] as any[]);
				for (const sess of sessionsList) {
					if (sess.type !== 'directory') continue;
					const files = await client.getDirectoryContents(`${cfg.remoteRoot}sessions/${proj.basename}/${sess.basename}`).catch(() => [] as any[]);
					for (const f of files) {
						if (f.type !== 'file' || !f.basename.endsWith('.jsonl.zstd')) continue;
						const mtime = f.lastmod ? new Date(f.lastmod).getTime() : 0;
						sessions.push({
							project: proj.basename,
							sessionId: sess.basename,
							filename: f.basename,
							remotePath: `${cfg.remoteRoot}sessions/${proj.basename}/${sess.basename}/${f.basename}`,
							mtimeMs: mtime,
							sizeBytes: f.size ?? 0,
						});
					}
				}
			}
			return sessions;
		} catch (err) {
			console.error(`[${TAG}] listRemoteSessions failed:`, (err as Error).message);
			return [];
		}
	}

	// ── Full profile backup (dshmarket-compatible format) ──────────────────────

	/**
	 * Upload a full profile backup snapshot to WebDAV.
	 * Creates missing parent collections automatically.
	 * @param backupPath - remote path for the backup file (e.g. `/dsh/backup.json`)
	 */
	async uploadBackup(backupPath: string): Promise<SyncResult> {
		if (this._syncing) return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const client = await this._getClient();
			// Create parent collections so the PUT doesn't fail on nested paths
			const parsedUrl = new URL(this._cfg.remoteUrl);
			const filePath = backupPath.startsWith('/') ? backupPath : `/${backupPath}`;
			const parentDir = dirname(filePath);
			if (parentDir !== '/' && parentDir !== '.') {
				const collectionUrl = `${parsedUrl.origin}${parentDir}/`;
				try { await client.createDirectory(collectionUrl, { recursive: true }); } catch { /* exists */ }
			}
			const backup = createProfileBackup('web');
			const content = JSON.stringify(backup, null, 2);
			await client.putFileContents(filePath, content, { overwrite: true });
			result.uploaded = 1;
			console.log(`[${TAG}] Backup uploaded: ${filePath} (${(content.length / 1024).toFixed(1)}KB)`);
		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}
		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) this._lastError = result.errors.join('; ');
		else { this._lastSync = new Date(); this._lastError = null; }
		console.log(`[${TAG}] Upload-backup done: +${result.uploaded} (${Date.now() - start}ms)`);
		this._syncing = false;
		return result;
	}

	/**
	 * Download a full profile backup from WebDAV and restore locally.
	 * @param backupPath - remote path of the backup file (e.g. `/dsh/backup.json`)
	 */
	async downloadAndRestore(backupPath: string): Promise<SyncResult> {
		if (this._syncing) return { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: ['already-running'] };
		this._syncing = true;
		const start = Date.now();
		const result: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const client = await this._getClient();
			const filePath = backupPath.startsWith('/') ? backupPath : `/${backupPath}`;
			const data = await client.getFileContents(filePath, { format: 'text' });
			const text = typeof data === 'string' ? data : data.toString('utf8');
			const parsed = JSON.parse(text) as unknown;
			const backup = validatedBackup(parsed);
			const restored = restoreProfileBackup(backup);
			result.downloaded = restored.files;
			console.log(`[${TAG}] Backup restored: ${restored.files} files from ${filePath}`);
		} catch (err) {
			result.errors.push((err as Error).message ?? String(err));
		}
		result.errors = result.errors.filter(Boolean);
		if (result.errors.length > 0) this._lastError = result.errors.join('; ');
		else { this._lastSync = new Date(); this._lastError = null; }
		console.log(`[${TAG}] Download-restore done: -${result.downloaded} files (${Date.now() - start}ms)`);
		this._syncing = false;
		return result;
	}

	async status(): Promise<StatusResult> {
		return {
			connected: !!this._client,
			lastSync: this._lastSync?.toISOString() ?? null,
			lastError: this._lastError,
			syncing: this._syncing,
			configSummary: {
				remoteUrl: this._cfg.remoteUrl,
				username: this._cfg.username,
			},
		};
	}

	async testConnection(): Promise<{ ok: boolean; remoteUrl: string; error?: string }> {
		try {
			const client = await this._getClient();
			const root = this._cfg.remoteRoot;
			try {
				await client.createDirectory(root, { recursive: true });
			} catch {
				// Directory may already exist
			}
			await client.exists(root);
			return { ok: true, remoteUrl: this._cfg.remoteUrl };
		} catch (err) {
			return { ok: false, remoteUrl: this._cfg.remoteUrl, error: (err as Error).message ?? String(err) };
		}
	}

	// ── internal helpers ──────────────────────────────────────────────────────

	private _merge(target: SyncResult, src: SyncResult): void {
		target.uploaded += src.uploaded;
		target.downloaded += src.downloaded;
		target.unchanged += src.unchanged;
		target.conflicts += src.conflicts;
		target.errors.push(...(src.errors ?? []));
	}

	/**
	 * Bidirectional sync for a single file with conflict resolution.
	 *
	 * Strategy:
	 * - newer-wins: compare mtime, newer side wins
	 * - remote-wins: always upload local, overwrite remote
	 * - local-wins: always download remote, overwrite local
	 *
	 * For settings.yaml: also tracks _sync_version to detect cross-device writes.
	 */
	private async _syncLocalFile(client: Client, localPath: string, remotePath: string): Promise<SyncResult> {
		const r: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const localExists = existsSync(localPath);
			let remoteExists = false;
			try { remoteExists = await client.exists(remotePath); } catch { /* ignore */ }

			if (!localExists && !remoteExists) return r;

			// Only one side exists — simple transfer
			if (!localExists) {
				try {
					const data = await client.getFileContents(remotePath, { format: 'binary' });
					this._writeFile(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
					r.downloaded++;
					console.log(`[${TAG}] Downloaded: ${remotePath}`);
				} catch (err) {
					r.errors.push(`${remotePath}: ${(err as Error).message}`);
				}
				return r;
			}

			if (!remoteExists) {
				try {
					await this._uploadFile(client, localPath, remotePath);
					r.uploaded++;
				} catch (err) {
					r.errors.push(`${localPath}: ${(err as Error).message}`);
				}
				return r;
			}

			// Both exist — resolve conflict
			try {
				const remoteStat = await client.stat(remotePath, { details: true });
				const remoteMtimeStr = remoteStat?.data?.headers?.['last-modified'];
				const localMtime = statSync(localPath).mtimeMs;
				const remoteMtime = remoteMtimeStr ? new Date(remoteMtimeStr).getTime() : 0;

				// Same mtime (within 1s) — nothing to do
				if (Math.abs(localMtime - remoteMtime) < 1000) {
					r.unchanged++;
					return r;
				}

				// Config file: check _sync_version for cross-device conflict detection
				if (localPath.endsWith('settings.yaml')) {
					const localVer = readSyncVersion(localPath);
					const remoteVer = await this._readRemoteSyncVersion(client, remotePath);
					if (localVer !== undefined && remoteVer !== undefined && localVer === remoteVer) {
						// Same version on both sides but different content — true conflict
						r.conflicts++;
						console.warn(`[${TAG}] CONFLICT detected for ${remotePath} (same _sync_version=${localVer}, different content)`);
					}
				}

				const strategy = this._cfg.conflictStrategy;
				if (strategy === 'remote-wins') {
					// Always upload local → remote
					await this._uploadFile(client, localPath, remotePath);
					r.uploaded++;
				} else if (strategy === 'local-wins') {
					// Always download remote → local
					const data = await client.getFileContents(remotePath, { format: 'binary' });
					this._writeFile(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
					r.downloaded++;
					console.log(`[${TAG}] Downloaded: ${remotePath}`);
				} else {
					// newer-wins (default): compare mtime
					if (localMtime < remoteMtime) {
						const data = await client.getFileContents(remotePath, { format: 'binary' });
						this._writeFile(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
						r.downloaded++;
						console.log(`[${TAG}] Downloaded (remote newer): ${remotePath}`);
					} else {
						await this._uploadFile(client, localPath, remotePath);
						r.uploaded++;
					}
				}
			} catch (err) {
				try {
					await this._uploadFile(client, localPath, remotePath);
					r.uploaded++;
				} catch (uploadErr) {
					r.errors.push(`${localPath}: ${(uploadErr as Error).message}`);
				}
			}
		} catch (err) {
			r.errors.push(`${localPath}: ${(err as Error).message}`);
		}
		return r;
	}

	private async _readRemoteSyncVersion(client: Client, remotePath: string): Promise<number | undefined> {
		try {
			const data = await client.getFileContents(remotePath, { format: 'text' });
			const match = data.match(/^_sync_version:\s*(\d+)/m);
			return match ? parseInt(match[1], 10) : undefined;
		} catch {
			return undefined;
		}
	}

	/** Bump the _sync_version in settings.yaml before uploading. */
	private _bumpAndUpload(client: Client, localPath: string, remotePath: string): Promise<void> {
		bumpSyncVersion(localPath);
		return this._uploadFile(client, localPath, remotePath);
	}

	private async _pullLocalFile(client: Client, localPath: string, remotePath: string): Promise<SyncResult> {
		const r: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const exists = await client.exists(remotePath).catch(() => false);
			if (!exists) return r;
			const data = await client.getFileContents(remotePath, { format: 'binary' });
			this._writeFile(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
			r.downloaded++;
			console.log(`[${TAG}] Downloaded: ${remotePath}`);
		} catch (err) {
			r.errors.push(`${remotePath}: ${(err as Error).message}`);
		}
		return r;
	}

	private async _syncDir(client: Client, localDir: string, remoteDir: string): Promise<SyncResult> {
		const r: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		if (!existsSync(localDir)) return r;

		try {
			const entries = readdirSync(localDir, { withFileTypes: true });
			for (const entry of entries) {
				const localPath = join(localDir, entry.name);
				const remotePath = `${remoteDir}/${entry.name}`;
				if (entry.isDirectory()) {
					const subR = await this._syncDir(client, localPath, remotePath);
					this._merge(r, subR);
				} else {
					const fileR = await this._syncLocalFile(client, localPath, remotePath);
					this._merge(r, fileR);
				}
			}
		} catch (err) {
			r.errors.push(`Dir ${localDir}: ${(err as Error).message}`);
		}
		return r;
	}

	private async _pullDir(client: Client, localDir: string, remoteDir: string): Promise<SyncResult> {
		const r: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const items = await client.getDirectoryContents(remoteDir).catch(() => []);
			for (const item of items) {
				if (item.basename === '.' || item.basename === '..') continue;
				const localPath = join(localDir, item.basename);
				const remotePath = `${remoteDir}/${item.basename}`;
				if (item.type === 'directory') {
					if (!existsSync(localPath)) mkdirSync(localPath, { recursive: true });
					const subR = await this._pullDir(client, localPath, remotePath);
					this._merge(r, subR);
				} else {
					const fileR = await this._pullLocalFile(client, localPath, remotePath);
					this._merge(r, fileR);
				}
			}
		} catch (err) {
			r.errors.push(`Pull dir ${remoteDir}: ${(err as Error).message}`);
		}
		return r;
	}

	private async _syncSessions(client: Client, cfg: PluginConfig): Promise<SyncResult> {
		const r: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		const sessionsDir = dshHome('sessions');
		if (!existsSync(sessionsDir)) return r;

		try {
			const projects = readdirSync(sessionsDir);
			for (const project of projects) {
				const projectPath = join(sessionsDir, project);
				if (!statSync(projectPath).isDirectory()) continue;
				const sessions = readdirSync(projectPath);
				for (const sessionId of sessions) {
					const sessionPath = join(projectPath, sessionId);
					if (!statSync(sessionPath).isDirectory()) continue;
					const files = readdirSync(sessionPath);
					for (const fileName of files) {
						if (!fileName.endsWith('.jsonl.zstd')) continue;
						const localPath = join(sessionPath, fileName);
						const remotePath = `${cfg.remoteRoot}sessions/${project}/${sessionId}/${fileName}`;
						const fileR = await this._syncLocalFile(client, localPath, remotePath);
						this._merge(r, fileR);
					}
				}
			}
		} catch (err) {
			r.errors.push(`Sessions: ${(err as Error).message}`);
		}
		return r;
	}

	private async _pullSessions(client: Client, cfg: PluginConfig): Promise<SyncResult> {
		const r: SyncResult = { uploaded: 0, downloaded: 0, unchanged: 0, conflicts: 0, errors: [] };
		try {
			const projects = await client.getDirectoryContents(`${cfg.remoteRoot}sessions`).catch(() => []);
			for (const proj of projects) {
				if (proj.type !== 'directory') continue;
				const sessions = await client.getDirectoryContents(`${cfg.remoteRoot}sessions/${proj.basename}`).catch(() => []);
				for (const sess of sessions) {
					if (sess.type !== 'directory') continue;
					const files = await client.getDirectoryContents(`${cfg.remoteRoot}sessions/${proj.basename}/${sess.basename}`).catch(() => []);
					for (const f of files) {
						if (f.type !== 'file' || !f.basename.endsWith('.jsonl.zstd')) continue;
						const localPath = dshHome('sessions', proj.basename, sess.basename, f.basename);
						const remotePath = `${cfg.remoteRoot}sessions/${proj.basename}/${sess.basename}/${f.basename}`;
						const fileR = await this._pullLocalFile(client, localPath, remotePath);
						this._merge(r, fileR);
					}
				}
			}
		} catch (err) {
			r.errors.push(`Sessions pull: ${(err as Error).message}`);
		}
		return r;
	}

	private async _uploadFile(client: Client, localPath: string, remotePath: string): Promise<void> {
		const data = readFileSync(localPath);
		const remoteDir = dirname(remotePath);
		if (remoteDir !== '/' && remoteDir !== '.') {
			try { await client.createDirectory(remoteDir, { recursive: true }); } catch { /* exists */ }
		}
		await client.putFileContents(remotePath, data, { overwrite: true });
	}

	private _writeFile(path: string, data: Buffer): void {
		const parent = dirname(path);
		if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
		writeFileSync(path, data);
	}
}
