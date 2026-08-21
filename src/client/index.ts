/**
 * Client-side entry point — no-op for browser context.
 * Settings are managed server-side; the web UI reads from ctx.settings.
 * @module dsh-webdav-sync/client
 */

export const inject = ['settings'] as const;

export function apply(_ctx: { get: (key: string) => unknown }): void {
	// Client-side stub — all logic runs in the host
}
