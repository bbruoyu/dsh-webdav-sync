/**
 * Core sync service — WebDAV connection and file synchronization.
 * @module dsh-webdav-sync/sync-service
 */
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
    configSummary: {
        remoteUrl: string;
        username: string;
    };
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
/** dshmarket-compatible backup format identifier. */
export declare const BACKUP_FORMAT = "dsh-profile-backup";
/** Maximum serialized backup size (2 MB). */
export declare const MAX_BACKUP_BYTES: number;
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
/**
 * Serialize the DSH profile directory into a dshmarket-compatible backup JSON.
 * @param profile - profile name (used for metadata only)
 * @param dir - profile directory (defaults to DSH_HOME)
 */
export declare function createProfileBackup(profile: string, dir?: string, opts?: BackupOptions): ProfileBackup;
/** Strictly validate a deserialized backup object. */
export declare function validatedBackup(value: unknown): ProfileBackup;
/**
 * Restore a validated backup to the DSH home directory.
 * Returns the number of files written.
 */
export declare function restoreProfileBackup(value: unknown, dir?: string): {
    files: number;
};
export declare class SyncService {
    private _client;
    private _stopped;
    private _syncing;
    private _lastSync;
    private _lastError;
    private _timer;
    private _getConfig;
    constructor(getConfig: () => Record<string, unknown>);
    private get _cfg();
    start(): Promise<void>;
    stop(): void;
    private _ensureClient;
    private _getClient;
    /** Full bidirectional sync (push + pull). */
    sync(): Promise<SyncResult>;
    /** Pull-only: download remote files to local. */
    pull(): Promise<SyncResult>;
    /** Push only config files (settings.yaml, presets, pet.json) to remote. */
    pushConfig(): Promise<SyncResult>;
    /** Pull only config files from remote to local. */
    pullConfig(): Promise<SyncResult>;
    /**
     * Upload the current session's log to WebDAV, then delete the local file.
     * @param cwd - normalized cwd of the session (project dir name)
     * @param sessionId - session ID
     */
    uploadSession(cwd: string, sessionId: string): Promise<SyncResult>;
    /**
     * Download a specific session from WebDAV to local.
     * If a local session with the same ID already exists, it will be overwritten.
     * @param cwd - normalized cwd (project dir name)
     * @param sessionId - session ID
     */
    downloadSession(cwd: string, sessionId: string): Promise<SyncResult>;
    /**
     * List all session archives available on the remote WebDAV.
     */
    listRemoteSessions(): Promise<RemoteSession[]>;
    /**
     * Upload a full profile backup snapshot to WebDAV.
     * Creates missing parent collections automatically.
     * @param backupPath - remote path for the backup file (e.g. `/dsh/backup.json`)
     */
    uploadBackup(backupPath: string): Promise<SyncResult>;
    /**
     * Download a full profile backup from WebDAV and restore locally.
     * @param backupPath - remote path of the backup file (e.g. `/dsh/backup.json`)
     */
    downloadAndRestore(backupPath: string): Promise<SyncResult>;
    status(): Promise<StatusResult>;
    testConnection(): Promise<{
        ok: boolean;
        remoteUrl: string;
        error?: string;
    }>;
    private _merge;
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
    private _syncLocalFile;
    private _readRemoteSyncVersion;
    /** Bump the _sync_version in settings.yaml before uploading. */
    private _bumpAndUpload;
    private _pullLocalFile;
    private _syncDir;
    private _pullDir;
    private _syncSessions;
    private _pullSessions;
    private _uploadFile;
    private _writeFile;
}
export {};
//# sourceMappingURL=sync-service.d.ts.map