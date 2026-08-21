/**
 * Web route registration for REST API endpoints.
 * @module dsh-webdav-sync/web-route
 */
import type { SyncService } from './sync-service.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
export declare function registerWebRoutes(webServer: {
    register: (route: {
        kind: string;
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }) => () => void;
}, service: SyncService): void;
//# sourceMappingURL=web-route.d.ts.map