/**
 * Error message helper.
 * @module dsh-webdav-sync/errors
 */

export function messageOf(err: unknown): string {
	if (err && typeof (err as Error).message === 'string') return (err as Error).message;
	return String(err);
}

/** WebDAV connection error. */
export class WebDavSyncError extends Error {
	readonly code: string;

	constructor(message: string, options?: { code?: string }) {
		super(message);
		this.code = options?.code ?? 'WEBDAV_SYNC_ERROR';
	}
}
