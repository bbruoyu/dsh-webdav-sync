/**
 * Host entry point — Cordis plugin registration.
 * @module dsh-webdav-sync
 */
export declare const name = "dsh-webdav-sync";
export declare const inject: readonly ["settings", "commands"];
export declare function apply(ctx: {
    get: (key: string) => unknown;
    effect: (fn: () => void | Promise<void>, label?: string) => void;
    inject: (keys: string[], fn: (c: {
        settings: {
            register: (ns: string, schema: unknown, opts: {
                base?: unknown;
            } | undefined) => unknown;
        };
    }) => void) => void;
    webServer?: {
        register: (route: {
            kind: string;
            path: string;
            handler: Function;
        }) => () => void;
    };
}): void;
//# sourceMappingURL=index.d.ts.map