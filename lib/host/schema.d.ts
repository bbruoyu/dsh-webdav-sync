/**
 * WebDAV sync schema — settings namespace definition.
 * @module dsh-webdav-sync/schema
 */
import Schema from '@deepseek-ai/schemastery';
export declare const NS = "webdav-sync";
export interface PresetDefinition {
    label: string;
    description: string;
    remoteUrl: string;
    remoteRoot?: string;
    syncSettings?: boolean;
    syncPresets?: boolean;
    autoSync?: boolean;
    syncIntervalMin?: number;
    note?: string;
}
export declare const PRESETS: PresetDefinition[];
export declare const PRESET_KEYS: string[];
export declare const WebDavSyncSchema: Schema<Schemastery.ObjectS<{
    provider: Schema<string, string>;
    remoteUrl: Schema<string, string>;
    username: Schema<string, string>;
    password: Schema<string, string>;
    syncSessions: Schema<boolean, boolean>;
    syncSettings: Schema<boolean, boolean>;
    syncAttachments: Schema<boolean, boolean>;
    syncPresets: Schema<boolean, boolean>;
    syncPet: Schema<boolean, boolean>;
    autoSync: Schema<boolean, boolean>;
    syncIntervalMin: Schema<number, number>;
    pullOnStartup: Schema<boolean, boolean>;
    remoteRoot: Schema<string, string>;
    conflictStrategy: Schema<"newer-wins" | "remote-wins" | "local-wins", "newer-wins" | "remote-wins" | "local-wins">;
    manualOnly: Schema<boolean, boolean>;
}>, Schemastery.ObjectT<{
    provider: Schema<string, string>;
    remoteUrl: Schema<string, string>;
    username: Schema<string, string>;
    password: Schema<string, string>;
    syncSessions: Schema<boolean, boolean>;
    syncSettings: Schema<boolean, boolean>;
    syncAttachments: Schema<boolean, boolean>;
    syncPresets: Schema<boolean, boolean>;
    syncPet: Schema<boolean, boolean>;
    autoSync: Schema<boolean, boolean>;
    syncIntervalMin: Schema<number, number>;
    pullOnStartup: Schema<boolean, boolean>;
    remoteRoot: Schema<string, string>;
    conflictStrategy: Schema<"newer-wins" | "remote-wins" | "local-wins", "newer-wins" | "remote-wins" | "local-wins">;
    manualOnly: Schema<boolean, boolean>;
}>>;
/** Return the preset config for the selected provider. */
export declare function getPresetConfig(provider: string): Partial<Record<string, unknown>>;
//# sourceMappingURL=schema.d.ts.map