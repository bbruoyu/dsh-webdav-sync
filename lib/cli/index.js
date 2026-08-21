/**
 * CLI entry point for standalone sync operations.
 * Usage: node lib/cli/index.js <command> [options]
 * Commands: status, test, push, pull, sync
 */
import { createClient } from 'webdav';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync, dirname } from 'node:fs';
import { join } from 'node:path';
const DSH_HOME = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh');
const CONFIG_FILE = join(DSH_HOME, 'webdav-sync.yaml');
const DEFAULT_CFG = {
    remoteUrl: 'https://your-nas.local:5005/webdav/',
    username: '',
    password: '',
    syncSessions: true,
    syncSettings: true,
    syncAttachments: true,
    syncPresets: true,
    syncPet: false,
    remoteRoot: '/dsh/',
};
function loadConfig() {
    if (!existsSync(CONFIG_FILE))
        return { ...DEFAULT_CFG };
    try {
        // Try YAML parsing first
        const yaml = require('yaml');
        const content = readFileSync(CONFIG_FILE, 'utf8');
        const parsed = yaml.parse(content) ?? {};
        return { ...DEFAULT_CFG, ...parsed };
    }
    catch {
        // Fallback to simple line parsing
        const content = readFileSync(CONFIG_FILE, 'utf8');
        const cfg = { ...DEFAULT_CFG };
        for (const line of content.split('\n')) {
            if (!line.trim() || line.trim().startsWith('#'))
                continue;
            const m = line.match(/^([a-zA-Z0-9_-]+):\s*["']?([^"'\n]+)["']?$/);
            if (m) {
                const val = m[2].trim();
                cfg[m[1]] = val === 'true' ? true : val === 'false' ? false : val;
            }
        }
        return cfg;
    }
}
async function syncLocalFile(client, localPath, remotePath) {
    const r = { uploaded: 0, downloaded: 0, unchanged: 0, errors: [] };
    try {
        const localExists = existsSync(localPath);
        let remoteExists = false;
        try {
            remoteExists = await client.exists(remotePath);
        }
        catch { /* ignore */ }
        if (!localExists && !remoteExists)
            return r;
        if (!localExists) {
            const data = await client.getFileContents(remotePath, { format: 'binary' });
            writeFileSync(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
            r.downloaded++;
            return r;
        }
        if (!remoteExists) {
            const data = readFileSync(localPath);
            const remoteDir = dirname(remotePath);
            if (remoteDir !== '/')
                await client.createDirectory(remoteDir, { recursive: true }).catch(() => { });
            await client.putFileContents(remotePath, data, { overwrite: true });
            r.uploaded++;
            return r;
        }
        // Both exist — compare mtime
        const remoteStat = await client.stat(remotePath, { details: true });
        const remoteMtimeStr = remoteStat?.data?.headers?.['last-modified'];
        const localMtime = statSync(localPath).mtimeMs;
        const remoteTime = remoteMtimeStr ? new Date(remoteMtimeStr).getTime() : 0;
        if (Math.abs(localMtime - remoteTime) < 1000) {
            r.unchanged++;
            return r;
        }
        if (localMtime < remoteTime) {
            const data = await client.getFileContents(remotePath, { format: 'binary' });
            writeFileSync(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
            r.downloaded++;
        }
        else {
            const data = readFileSync(localPath);
            await client.putFileContents(remotePath, data, { overwrite: true });
            r.uploaded++;
        }
    }
    catch (err) {
        r.errors.push(`${localPath}: ${err.message}`);
    }
    return r;
}
async function pushFile(client, localPath, remotePath) {
    const r = { uploaded: 0, downloaded: 0, unchanged: 0, errors: [] };
    if (!existsSync(localPath))
        return r;
    try {
        await client.createDirectory(dirname(remotePath), { recursive: true }).catch(() => { });
        const data = readFileSync(localPath);
        await client.putFileContents(remotePath, data, { overwrite: true });
        r.uploaded++;
    }
    catch (err) {
        r.errors.push(`${localPath}: ${err.message}`);
    }
    return r;
}
async function pushDir(client, localDir, remoteDir) {
    const tasks = [];
    try {
        const entries = readdirSync(localDir, { withFileTypes: true });
        for (const entry of entries) {
            const localPath = join(localDir, entry.name);
            const remotePath = `${remoteDir}/${entry.name}`;
            if (entry.isDirectory()) {
                tasks.push(...pushDir(client, localPath, remotePath));
            }
            else {
                tasks.push(pushFile(client, localPath, remotePath));
            }
        }
    }
    catch (e) { /* ignore */ }
    return tasks;
}
async function pushSessions(client, sessionsDir, cfg) {
    const tasks = [];
    try {
        const projects = readdirSync(sessionsDir);
        for (const project of projects) {
            const projectPath = join(sessionsDir, project);
            try {
                const sessions = readdirSync(projectPath);
                for (const sessionId of sessions) {
                    const sessionPath = join(projectPath, sessionId);
                    const files = readdirSync(sessionPath);
                    for (const fileName of files) {
                        if (!fileName.endsWith('.jsonl.zstd'))
                            continue;
                        tasks.push(pushFile(client, join(sessionPath, fileName), `${cfg.remoteRoot}sessions/${project}/${sessionId}/${fileName}`));
                    }
                }
            }
            catch { }
        }
    }
    catch { }
    return tasks;
}
async function pullFile(client, localPath, remotePath) {
    const r = { uploaded: 0, downloaded: 0, unchanged: 0, errors: [] };
    try {
        const exists = await client.exists(remotePath).catch(() => false);
        if (!exists)
            return r;
        const data = await client.getFileContents(remotePath, { format: 'binary' });
        writeFileSync(localPath, Buffer.isBuffer(data) ? data : Buffer.from(data.toString('utf8')));
        r.downloaded++;
    }
    catch (err) {
        r.errors.push(`${remotePath}: ${err.message}`);
    }
    return r;
}
async function pullDir(client, localDir, remoteDir) {
    const r = { uploaded: 0, downloaded: 0, unchanged: 0, errors: [] };
    try {
        const items = await client.getDirectoryContents(remoteDir).catch(() => []);
        for (const item of items) {
            if (item.basename === '.' || item.basename === '..')
                continue;
            const localPath = join(localDir, item.basename);
            const remotePath = `${remoteDir}/${item.basename}`;
            if (item.type === 'directory') {
                if (!existsSync(localPath))
                    mkdirSync(localPath, { recursive: true });
                const subR = await pullDir(client, localPath, remotePath);
                r.downloaded += subR.downloaded;
                r.errors.push(...subR.errors);
            }
            else {
                const fileR = await pullFile(client, localPath, remotePath);
                r.downloaded += fileR.downloaded;
                r.errors.push(...fileR.errors);
            }
        }
    }
    catch (err) {
        r.errors.push(`Pull dir ${remoteDir}: ${err.message}`);
    }
    return r;
}
async function pullSessions(client, cfg) {
    const tasks = [];
    try {
        const projects = await client.getDirectoryContents(`${cfg.remoteRoot}sessions`).catch(() => []);
        for (const proj of projects) {
            if (proj.type !== 'directory')
                continue;
            const sessions = await client.getDirectoryContents(`${cfg.remoteRoot}sessions/${proj.basename}`).catch(() => []);
            for (const sess of sessions) {
                if (sess.type !== 'directory')
                    continue;
                const files = await client.getDirectoryContents(`${cfg.remoteRoot}sessions/${proj.basename}/${sess.basename}`).catch(() => []);
                for (const f of files) {
                    if (f.type !== 'file' || !f.basename.endsWith('.jsonl.zstd'))
                        continue;
                    tasks.push(pullFile(client, join(DSH_HOME, 'sessions', proj.basename, sess.basename, f.basename), `${cfg.remoteRoot}sessions/${proj.basename}/${sess.basename}/${f.basename}`));
                }
            }
        }
    }
    catch (err) {
        return [{ uploaded: 0, downloaded: 0, unchanged: 0, errors: [`Sessions pull: ${err.message}`] }];
    }
    const results = await Promise.allSettled(tasks);
    let downloaded = 0, errors = [];
    for (const r of results) {
        if (r.status === 'fulfilled') {
            downloaded += r.value.downloaded;
            errors.push(...r.value.errors);
        }
        else {
            errors.push(r.reason?.message ?? String(r.reason));
        }
    }
    return [{ uploaded: 0, downloaded, unchanged: 0, errors }];
}
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const cfg = loadConfig();
    if (command === 'help' || command === '--help' || command === '-h') {
        console.log(`
dsh-webdav-sync — WebDAV sync for DeepSeek Harness

Usage:
  dsh-webdav-sync status    Show sync status
  dsh-webdav-sync test      Test WebDAV connection
  dsh-webdav-sync push      Upload local → remote
  dsh-webdav-sync pull      Download remote → local
  dsh-webdav-sync sync      Bidirectional sync (mtime-based)
  dsh-webdav-sync help      This help

Config file: ${CONFIG_FILE}
DSH_HOME: ${DSH_HOME}
`);
        return;
    }
    if (!cfg.username || !cfg.password) {
        console.error('ERROR: username and password not configured. Edit:', CONFIG_FILE);
        process.exit(1);
    }
    const client = createClient(cfg.remoteUrl, { username: cfg.username, password: cfg.password });
    if (command === 'status') {
        const redacted = { ...cfg, password: '***' };
        console.log('Configuration:', JSON.stringify(redacted, null, 2));
        console.log(`  DSH_HOME: ${DSH_HOME}`);
        console.log(`  Sessions: ${existsSync(join(DSH_HOME, 'sessions')) ? 'yes' : 'no'}`);
        console.log(`  Settings: ${existsSync(join(DSH_HOME, 'settings.yaml')) ? 'yes' : 'no'}`);
        return;
    }
    if (command === 'test') {
        try {
            await client.exists(cfg.remoteRoot);
            console.log('OK: Connected to', cfg.remoteUrl);
        }
        catch (err) {
            console.error('ERROR:', err.message);
            process.exit(1);
        }
        return;
    }
    if (command === 'push') {
        const tasks = [];
        if (cfg.syncSettings && existsSync(join(DSH_HOME, 'settings.yaml'))) {
            tasks.push(syncLocalFile(client, join(DSH_HOME, 'settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`));
        }
        if (cfg.syncPet && existsSync(join(DSH_HOME, 'pet.json'))) {
            tasks.push(syncLocalFile(client, join(DSH_HOME, 'pet.json'), `${cfg.remoteRoot}config/pet.json`));
        }
        if (cfg.syncPresets && existsSync(join(DSH_HOME, '.agent-presets'))) {
            tasks.push(...pushDir(client, join(DSH_HOME, '.agent-presets'), `${cfg.remoteRoot}presets`));
        }
        if (cfg.syncSessions) {
            tasks.push(...pushSessions(client, join(DSH_HOME, 'sessions'), cfg));
        }
        if (cfg.syncAttachments) {
            tasks.push(...pushDir(client, join(DSH_HOME, 'attachments', 'v1', 'objects'), `${cfg.remoteRoot}attachments/v1/objects`));
        }
        const results = await Promise.allSettled(tasks);
        let uploaded = 0, downloaded = 0, unchanged = 0, errors = [];
        for (const r of results) {
            if (r.status === 'fulfilled') {
                uploaded += r.value.uploaded;
                downloaded += r.value.downloaded;
                unchanged += r.value.unchanged;
                errors.push(...r.value.errors);
            }
            else {
                errors.push(r.reason?.message ?? String(r.reason));
            }
        }
        console.log(`Push done: +${uploaded} /-${downloaded} =${unchanged} errors: ${errors.length}`);
        if (errors.length)
            console.error('Errors:', errors.slice(0, 5).join('\n'));
        return;
    }
    if (command === 'pull') {
        const tasks = [];
        if (cfg.syncSettings) {
            tasks.push(pullFile(client, join(DSH_HOME, 'settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`));
        }
        if (cfg.syncPet) {
            tasks.push(pullFile(client, join(DSH_HOME, 'pet.json'), `${cfg.remoteRoot}config/pet.json`));
        }
        if (cfg.syncPresets) {
            tasks.push(...pullDir(client, join(DSH_HOME, '.agent-presets'), `${cfg.remoteRoot}presets`));
        }
        if (cfg.syncSessions) {
            tasks.push(...pullSessions(client, cfg));
        }
        if (cfg.syncAttachments) {
            tasks.push(...pullDir(client, join(DSH_HOME, 'attachments', 'v1', 'objects'), `${cfg.remoteRoot}attachments/v1/objects`));
        }
        const results = await Promise.allSettled(tasks);
        let downloaded = 0, errors = [];
        for (const r of results) {
            if (r.status === 'fulfilled') {
                downloaded += r.value.downloaded;
                errors.push(...r.value.errors);
            }
            else {
                errors.push(r.reason?.message ?? String(r.reason));
            }
        }
        console.log(`Pull done: ${downloaded} files downloaded, errors: ${errors.length}`);
        return;
    }
    if (command === 'sync') {
        // Full bidirectional sync using push logic (pull handled separately)
        const tasks = [];
        if (cfg.syncSettings && existsSync(join(DSH_HOME, 'settings.yaml'))) {
            tasks.push(syncLocalFile(client, join(DSH_HOME, 'settings.yaml'), `${cfg.remoteRoot}config/settings.yaml`));
        }
        if (cfg.syncPresets && existsSync(join(DSH_HOME, '.agent-presets'))) {
            tasks.push(...pushDir(client, join(DSH_HOME, '.agent-presets'), `${cfg.remoteRoot}presets`));
        }
        if (cfg.syncSessions) {
            tasks.push(...pushSessions(client, join(DSH_HOME, 'sessions'), cfg));
        }
        if (cfg.syncAttachments) {
            tasks.push(...pushDir(client, join(DSH_HOME, 'attachments', 'v1', 'objects'), `${cfg.remoteRoot}attachments/v1/objects`));
        }
        const results = await Promise.allSettled(tasks);
        let uploaded = 0, downloaded = 0, unchanged = 0, errors = [];
        for (const r of results) {
            if (r.status === 'fulfilled') {
                uploaded += r.value.uploaded;
                downloaded += r.value.downloaded;
                unchanged += r.value.unchanged;
                errors.push(...r.value.errors);
            }
            else {
                errors.push(r.reason?.message ?? String(r.reason));
            }
        }
        console.log(`Sync done: +${uploaded} /-${downloaded} =${unchanged} errors: ${errors.length}`);
        return;
    }
    console.error(`Unknown command: ${command}. Use: help, status, test, push, pull, sync`);
    process.exit(1);
}
main().catch(err => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map