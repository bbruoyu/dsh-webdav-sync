/**
 * Host entry point — Cordis plugin registration.
 * @module dsh-webdav-sync
 */
import { SyncService } from './sync-service.js';
import { registerCommand } from './command.js';
import { registerWebRoutes } from './web-route.js';
import { WebDavSyncSchema, NS, getPresetConfig } from './schema.js';
export const name = 'dsh-webdav-sync';
export const inject = ['settings', 'commands', 'webServer'];
export function apply(ctx) {
    let nsScope = null;
    ctx.inject(['settings'], (sctx) => {
        try {
            // Use preset defaults as the base layer — selected provider fills in url, root, intervals
            nsScope = sctx.settings.register(NS, WebDavSyncSchema, { base: getPresetConfig('🍎 坚果云 (JianGuoYun)') });
            console.log(`[dsh-webdav-sync] Settings namespace registered (${NS})`);
        }
        catch (err) {
            console.error(`[dsh-webdav-sync] Failed to register settings:`, err.message ?? err);
        }
    });
    const service = new SyncService(() => {
        if (nsScope && typeof nsScope.get === 'function') {
            return (nsScope.get()) ?? {};
        }
        return {};
    });
    ctx.effect(() => {
        void service.start();
    }, 'dsh-webdav-sync: start sync engine');
    registerCommand(ctx, service);
    if (ctx.webServer) {
        registerWebRoutes(ctx.webServer, service);
    }
}
//# sourceMappingURL=index.js.map