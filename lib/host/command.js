/**
 * Command registration for slash commands.
 * @module dsh-webdav-sync/command
 */
import { messageOf } from './errors.js';
export function registerCommand(ctx, service) {
    const commands = ctx.get('commands');
    if (!commands) {
        console.warn('[dsh-webdav-sync] commands service not available');
        return;
    }
    // ── Config sync commands ────────────────────────────────────────────────────
    commands.register({
        name: 'webdav-sync',
        description: 'WebDAV sync for DSH (飞牛NAS / Nextcloud / 坚果云 / any WebDAV)',
        input: { hint: 'push-config|pull-config|backup|restore <path>|upload-sess <cwd> <id>|download-sess <cwd> <id>|sessions|status|test' },
        handler: async ({ rawInput }) => {
            const parts = (rawInput || '').trim().split(/\s+/);
            const verb = parts[0] || 'status';
            const arg1 = parts[1] || '';
            const arg2 = parts[2] || '';
            try {
                switch (verb) {
                    case 'push-config': {
                        const r = await service.pushConfig();
                        return {
                            kind: r.errors.length === 0 ? 'success' : 'error',
                            text: `Push-config ${r.errors.length === 0 ? 'ok' : 'partial'}: +${r.uploaded} /-${r.downloaded} =${r.unchanged} ⚔️${r.conflicts}`,
                        };
                    }
                    case 'pull-config': {
                        const r = await service.pullConfig();
                        return {
                            kind: r.errors.length === 0 ? 'success' : 'error',
                            text: `Pull-config ${r.errors.length === 0 ? 'ok' : 'partial'}: -${r.downloaded} files`,
                        };
                    }
                    case 'upload-sess': {
                        if (!arg1 || !arg2) {
                            return { kind: 'error', text: 'Usage: /webdav-sync upload-sess <cwd> <sessionId>\nExample: /webdav-sync upload-sess my-project abc123' };
                        }
                        const r = await service.uploadSession(arg1, arg2);
                        return {
                            kind: r.errors.length === 0 ? 'success' : 'error',
                            text: r.errors.length === 0
                                ? `Uploaded session ${arg1}/${arg2} → remote, local file deleted`
                                : `Upload failed: ${r.errors.join(', ')}`,
                        };
                    }
                    case 'download-sess': {
                        if (!arg1 || !arg2) {
                            return { kind: 'error', text: 'Usage: /webdav-sync download-sess <cwd> <sessionId>\nExample: /webdav-sync download-sess my-project abc123' };
                        }
                        const r = await service.downloadSession(arg1, arg2);
                        return {
                            kind: r.errors.length === 0 ? 'success' : 'error',
                            text: r.errors.length === 0
                                ? `Downloaded session ${arg1}/${arg2}: -${r.downloaded} files`
                                : `Download failed: ${r.errors.join(', ')}`,
                        };
                    }
                    case 'backup': {
                        const r = await service.uploadBackup('/dsh/backup.json');
                        return {
                            kind: r.errors.length === 0 ? 'success' : 'error',
                            text: r.errors.length === 0
                                ? 'Full profile backup uploaded to /dsh/backup.json (dshmarket-compatible format)'
                                : `Backup failed: ${r.errors.join(', ')}`,
                        };
                    }
                    case 'restore': {
                        const path = arg1 || '/dsh/backup.json';
                        const r = await service.downloadAndRestore(path);
                        return {
                            kind: r.errors.length === 0 ? 'success' : 'error',
                            text: r.errors.length === 0
                                ? `已还原 ${r.downloaded} 个文件（来自 ${path}）。请重启 DSH 使更改生效。`
                                : `还原失败：${r.errors.join('、')}`,
                        };
                    }
                    case 'sessions': {
                        const list = await service.listRemoteSessions();
                        if (list.length === 0) {
                            return { kind: 'success', text: 'No sessions found on remote WebDAV.' };
                        }
                        const lines = list.map(s => {
                            const sizeKB = (s.sizeBytes / 1024).toFixed(1);
                            const date = s.mtimeMs ? new Date(s.mtimeMs).toLocaleString('zh-CN') : 'unknown';
                            return `  ${s.project}/${s.sessionId}/${s.filename}  (${sizeKB}KB, ${date})`;
                        });
                        return {
                            kind: 'success',
                            text: `Remote sessions (${list.length}):\n${lines.join('\n')}\n\nUse: /webdav-sync upload-sess <cwd> <id>  or  /webdav-sync download-sess <cwd> <id>`,
                        };
                    }
                    case 'status': {
                        const s = await service.status();
                        return {
                            kind: 'success',
                            text: [
                                `Connected: ${s.connected}`,
                                `Remote: ${s.configSummary.remoteUrl}`,
                                `User: ${s.configSummary.username}`,
                                `Last sync: ${s.lastSync || 'never'}`,
                                `Syncing: ${s.syncing}`,
                                s.lastError ? `Error: ${s.lastError}` : '',
                            ].filter(Boolean).join('\n'),
                        };
                    }
                    case 'test': {
                        const r = await service.testConnection();
                        return {
                            kind: r.ok ? 'success' : 'error',
                            text: r.ok
                                ? `Connected to ${r.remoteUrl}`
                                : `Connection failed: ${r.error ?? 'unknown error'}`,
                        };
                    }
                    default:
                        return {
                            kind: 'error',
                            text: `Unknown action: ${verb}.\nAvailable: push-config | pull-config | backup | restore <path> | upload-sess <cwd> <id> | download-sess <cwd> <id> | sessions | status | test`,
                        };
                }
            }
            catch (err) {
                return { kind: 'error', text: messageOf(err) };
            }
        },
    });
}
//# sourceMappingURL=command.js.map