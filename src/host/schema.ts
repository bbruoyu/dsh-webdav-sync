/**
 * WebDAV sync schema — settings namespace definition.
 * @module dsh-webdav-sync/schema
 */

import Schema from '@deepseek-ai/schemastery';

export const NS = 'webdav-sync';

// ── Preset definitions ───────────────────────────────────────────────────────
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

export const PRESETS: PresetDefinition[] = [
	{
		label: '🍎 坚果云',
		description: '国内稳定，免费版配置同步完全够用（每月1GB上传）',
		remoteUrl: 'https://davs.jianguoyun.com/dav/',
		remoteRoot: '/dsh/',
		syncSettings: true,
		syncPresets: true,
		autoSync: true,
		syncIntervalMin: 15,
		note: '密码请填写「授权码」（非登录密码），在坚果云 → 账户信息 → 第三方应用授权 中生成',
	},
	{
		label: '🐂 飞牛NAS 本地',
		description: 'Mac 和 NAS 在同一局域网时直接使用',
		remoteUrl: 'http://192.168.1.x:5005/webdav/',
		remoteRoot: '/dsh/',
		syncSettings: true,
		syncPresets: true,
		autoSync: false,
		note: '将 192.168.1.x 替换为 NAS 的实际内网 IP，需要启用飞牛 WebDAV 服务',
	},
	{
		label: '🌲 Tailscale + 飞牛NAS',
		description: 'Mac 在外网时通过 Tailscale 虚拟局域网访问 NAS',
		remoteUrl: 'https://100.x.x.x:5005/webdav/',
		remoteRoot: '/dsh/',
		syncSettings: true,
		syncPresets: true,
		autoSync: true,
		syncIntervalMin: 10,
		note: '将 100.x.x.x 替换为 NAS 的 Tailscale IP（执行 tailscale ip 查看），两端都需安装 Tailscale',
	},
	{
		label: '☁️ Nextcloud',
		description: '自建 Nextcloud 实例',
		remoteUrl: 'https://your-server.com/remote.php/dav/files/USERNAME/',
		remoteRoot: '/dsh/',
		syncSettings: true,
		syncPresets: true,
		autoSync: false,
		note: '将 your-server.com 和 USERNAME 替换为你的实际值，密码使用应用专用密码',
	},
	{
		label: '📦 自定义 WebDAV',
		description: '任何支持 WebDAV 的服务（Synology、ownCloud 等）',
		remoteUrl: 'https://your-server/webdav/',
		remoteRoot: '/dsh/',
		syncSettings: true,
		syncPresets: true,
		autoSync: false,
		note: '填写你的 WebDAV 地址，确保开启 HTTPS',
	},
];

export const PRESET_KEYS = PRESETS.map((p) => p.label);

// ── Schema ───────────────────────────────────────────────────────────────────

export const WebDavSyncSchema = Schema.object({
	// Provider preset selector
	provider: Schema.union(PRESET_KEYS.map((k) => Schema.const(k)))
		.default(PRESET_KEYS[0])
		.description('选择同步服务商预设（一键配置）'),

	// Connection (preset fills these, user overrides as needed)
	remoteUrl: Schema.string()
		.default('https://davs.jianguoyun.com/dav/')
		.description('WebDAV 服务器地址'),
	username: Schema.string()
		.default('')
		.description('WebDAV 用户名（邮箱或用户名）'),
	password: Schema.string()
		.default('')
		.role('secret')
		.description('WebDAV 密码或应用专用密码'),

	// Sync targets
	syncSessions: Schema.boolean().default(false).description('同步会话历史（不建议开启，两端 sessions 各自独立）'),
	syncSettings: Schema.boolean().default(true).description('同步设置文件 settings.yaml'),
	syncAttachments: Schema.boolean().default(false).description('同步附件（通常不需要跨设备同步）'),
	syncPresets: Schema.boolean().default(true).description('同步 Agent Presets'),
	syncPet: Schema.boolean().default(false).description('同步 Pet 配置'),

	// Behavior
	autoSync: Schema.boolean().default(false).description('启用自动同步（后台定时 push+pull）'),
	syncIntervalMin: Schema.number().min(1).max(1440).default(60).description('自动同步间隔（分钟），配置类文件 60 分钟足够；手动模式下此参数无效'),
	pullOnStartup: Schema.boolean().default(false).description('启动时先从云端拉取（谨慎使用）'),
	remoteRoot: Schema.string().default('/dsh/').description('远程根目录'),

	// Conflict resolution
	conflictStrategy: Schema.union([
		Schema.const('remote-wins'),
		Schema.const('local-wins'),
		Schema.const('newer-wins'),
	])
		.default('newer-wins')
		.description('冲突解决策略：newer-wins(时间近者优先) / remote-wins(远程覆盖本地) / local-wins(本地覆盖远程)'),

	// Sync mode
	manualOnly: Schema.boolean().default(true).description('手动同步模式：关闭自动轮询，仅通过 /webdav-sync push-config / upload-sess 等命令触发同步'),
});

/** Return the preset config for the selected provider. */
export function getPresetConfig(provider: string): Partial<Record<string, unknown>> {
	const preset = PRESETS.find((p) => p.label === provider);
	if (!preset) return {};
	return {
		remoteUrl: preset.remoteUrl,
		remoteRoot: preset.remoteRoot ?? '/dsh/',
		syncSettings: preset.syncSettings ?? true,
		syncPresets: preset.syncPresets ?? true,
		autoSync: preset.autoSync ?? false,
		syncIntervalMin: preset.syncIntervalMin ?? 60,
		_presetNote: preset.note,
	};
}
