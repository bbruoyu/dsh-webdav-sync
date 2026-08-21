/**
 * Error message helper.
 * @module dsh-webdav-sync/errors
 */
export declare function messageOf(err: unknown): string;
/** WebDAV connection error. */
export declare class WebDavSyncError extends Error {
    readonly code: string;
    constructor(message: string, options?: {
        code?: string;
    });
}
//# sourceMappingURL=errors.d.ts.map