/**
 * Error message helper.
 * @module dsh-webdav-sync/errors
 */
export function messageOf(err) {
    if (err && typeof err.message === 'string')
        return err.message;
    return String(err);
}
/** WebDAV connection error. */
export class WebDavSyncError extends Error {
    code;
    constructor(message, options) {
        super(message);
        this.code = options?.code ?? 'WEBDAV_SYNC_ERROR';
    }
}
//# sourceMappingURL=errors.js.map