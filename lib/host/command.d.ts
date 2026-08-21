/**
 * Command registration for slash commands.
 * @module dsh-webdav-sync/command
 */
import type { SyncService } from './sync-service.js';
export declare function registerCommand(ctx: {
    get: (key: string) => {
        register: (def: {
            name: string;
            description: string;
            input?: {
                hint: string;
            };
            handler: (inv: {
                rawInput: string;
            }) => Promise<{
                kind: string;
                text: string;
            }>;
        }) => void;
    };
}, service: SyncService): void;
//# sourceMappingURL=command.d.ts.map