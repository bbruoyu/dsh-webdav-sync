/**
 * Client-side entry point — no-op for browser context.
 * Settings are managed server-side; the web UI reads from ctx.settings.
 * @module dsh-webdav-sync/client
 */
export declare const inject: readonly ["settings"];
export declare function apply(_ctx: {
    get: (key: string) => unknown;
}): void;
//# sourceMappingURL=index.d.ts.map