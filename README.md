# dsh-webdav-sync

[![npm version](https://img.shields.io/npm/v/dsh-webdav-sync.svg)](https://npmjs.com/package/dsh-webdav-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-yes-blue.svg)](https://github.com/topics/dsh-plugin)

WebDAV sync plugin for DeepSeek Harness — sync settings, presets, and sessions to any WebDAV server (飞牛 NAS, Nextcloud, 坚果云, Tailscale, etc.).

> **核心设计**：只同步配置，不同步会话历史。两端 Harness 实例拥有相同的 agent preset 和模型配置，但各自保留独立的会话记录。

## 同步内容

| 内容 | 本地路径 | 远程路径 | 默认开启 |
|------|---------|---------|---------|
| 设置 | `~/.dsh/settings.yaml` | `/dsh/config/settings.yaml` | ✅ |
| Agent Presets | `~/.dsh/.agent-presets/` | `/dsh/presets/` | ✅ |
| Pet 配置 | `~/.dsh/pet.json` | `/dsh/config/pet.json` | ❌ |
| 会话历史 | `~/.dsh/sessions/` | `/dsh/sessions/` | ❌ 不建议 |
| 附件 | `~/.dsh/attachments/` | `/dsh/attachments/` | ❌ 不建议 |

**不同步：** `.credentials.yaml`、`node_modules/`、临时文件、本地缓存。

---

## 跨网络访问方案：Tailscale

飞牛 NAS 没有公网 IP 时，用 **Tailscale** 组建虚拟局域网，Mac 和 NAS 无论在哪都能互通：

### 1. 在飞牛 NAS 上安装 Tailscale

```bash
# 飞牛 NAS 基于 Linux，直接运行：
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
# 登录授权后，NAS 会获得一个 100.x.x.x 的内网 IP
```

### 2. 在 Mac 上安装 Tailscale

```bash
brew install tailscale
sudo tailscale up
# 登录同一个 Tailscale 账号
```

### 3. 获取 NAS 的 Tailscale IP

在 Mac 上执行：
```bash
tailscale ping <nas-tailname>
# 输出: pong from <nas-tailname> ([100.x.x.x]) beat 0.098 ms
```

### 4. 配置 WebDAV URL

将 `remoteUrl` 改为 Tailscale IP：
```yaml
remoteUrl: "https://100.x.x.x:5005/webdav/"
```

> **注意**：如果飞牛 NAS 的 WebDAV 是 HTTP（非 HTTPS），Tailscale 会加密传输，所以用 `http://100.x.x.x:5005/webdav/` 也可以，安全性由 Tailscale 保证。

---

## 安装

```sh
# 从 GitHub 安装（推荐）
dsh plugin --profile web add github:你的用户名/dsh-webdav-sync

# 从本地目录安装（开发阶段）
dsh plugin --profile web add /vol2/@team/Clawzone/Harness/dsh-webdav-sync

# 或发布到 npm 后
dsh plugin --profile web add dsh-webdav-sync
```

---

## 配置

### 一键预设（推荐）

在 DSH Web GUI 的设置页面，找到 **webdav-sync** → **provider** 字段，选择对应服务商：

| 预设 | 适用场景 | 只需填写 |
|------|---------|---------|
| **🍎 坚果云** | 最简单，零部署，跨网络自动同步 | 邮箱 + 授权码 |
| **🐂 飞牛NAS 本地** | Mac 和 NAS 同局域网 | NAS 内网 IP |
| **🌲 Tailscale + 飞牛NAS** | Mac 在外网，NAS 无公网 IP | NAS Tailscale IP + 密码 |
| **☁️ Nextcloud** | 自建 Nextcloud | 服务器地址 + 用户名 |
| **📦 自定义 WebDAV** | Synology / ownCloud 等 | 手动填所有字段 |

> **坚果云授权码获取**：坚果云 → 账户信息 → 第三方应用授权 → 生成授权码（不是登录密码）

### 完整字段说明

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `provider` | `🍎 坚果云` | 服务商预设（选择后自动填充 remoteUrl 等） |
| `remoteUrl` | 由 provider 决定 | WebDAV 地址 |
| `username` | `""` | WebDAV 用户名 |
| `password` | `""` | WebDAV 密码（应用专用密码） |
| `syncSessions` | `false` | 同步会话历史（**不建议开启**） |
| `syncSettings` | `true` | 同步设置文件 |
| `syncAttachments` | `false` | 同步附件 |
| `syncPresets` | `true` | 同步 Agent Presets |
| `syncPet` | `false` | 同步 Pet 配置 |
| `autoSync` | 由 provider 决定 | 启用自动同步 |
| `syncIntervalMin` | `15` | 自动同步间隔（分钟） |
| `remoteRoot` | `/dsh/` | 远程根目录 |
| `conflictStrategy` | `newer-wins` | 冲突解决策略 |
| `pullOnStartup` | `false` | 启动时先从云端拉取 |

### YAML 配置文件（高级用法）

如果需要通过命令行或配置文件设置，编辑 `~/.dsh/webdav-sync.yaml`：

```yaml
# 方式一：使用预设（只需填认证信息）
provider: "🍎 坚果云"
username: "your@email.com"
password: "your_auth_code"

# 方式二：手动指定所有参数
provider: "📦 自定义 WebDAV"
remoteUrl: "https://100.64.0.1:5005/webdav/"
username: "your@email.com"
password: "your_app_password"
syncSettings: true
syncPresets: true
autoSync: true
syncIntervalMin: 15
conflictStrategy: newer-wins
```

---

## 冲突解决机制

当两端同时修改了同一个文件时，插件按以下规则处理：

### `_sync_version` 版本号检测

`settings.yaml` 头部会自动添加 `_sync_version: N` 字段，每次本地写入后递增。

- 两端版本号相同但内容不同 → **标记为冲突**，记入日志
- 版本号不同 → 后上传的一方覆盖前一方（`newer-wins` 策略）

### 三种冲突策略

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `newer-wins`（默认） | 比较 mtime，时间近的覆盖远的 | 大多数场景 |
| `remote-wins` | 总是以远程为准，本地覆盖为远程 | 远程是权威源（如 NAS 是主编辑端） |
| `local-wins` | 总是以本地为准，远程覆盖为本地 | 本地是权威源 |

---

## 使用

默认启用**手动同步模式**（`manualOnly: true`），后台不会轮询，所有同步需手动触发。

### 配置同步（手动）

```
/webdav-sync push-config    # 立即推送 settings/presets 到云端
/webdav-sync pull-config    # 立即从云端拉取配置到本地
```

### 会话流转（手动上传/下载）

会话历史默认**不同步**，但可以随时上传到云端，然后在另一台设备下载，实现会话跨设备流转：

```
/webdav-sync sessions       # 列出云端所有已上传的会话
/webdav-sync upload-sess <cwd> <sessionId>   # 上传当前会话 → 云端，然后清空本地
/webdav-sync download-sess <cwd> <sessionId> # 从云端下载会话到本地
```

**操作流程示例：**

```
Mac 上完成一段对话后：
  /webdav-sync upload-sess my-project abc123def
  → 会话推送到云端，本地文件删除

在飞牛 NAS 上恢复这段对话：
  /webdav-sync sessions          # 看到云端有 my-project/abc123def
  /webdav-sync download-sess my-project abc123def
  → 会话下载到本地，可以在 NAS 上继续
```

### 全量备份（dshmarket 格式兼容）

将 profile 打包为完整的 JSON 快照上传到 WebDAV，可用于跨机器迁移：

```
/webdav-sync backup       # 打包当前 profile 并上传到 /dsh/backup.json
/webdav-sync restore      # 从云端下载 backup.json 并还原（默认路径 /dsh/backup.json）
/webdav-sync restore /dsh/backup-2026.json  # 指定路径恢复
```

> 备份格式与 DSH 内置 `dshmarket` 插件完全兼容——可以用 dshmarket 的备份文件恢复，反之亦然。
> 备份**不包含** `node_modules`，恢复时会按清单重新安装插件。

### 其他命令

```
/webdav-sync status    # 查看连接状态、上次同步时间
/webdav-sync test      # 测试 WebDAV 连接
```

### 开启自动同步（可选）

如需后台自动同步配置，在设置中关闭手动模式：

```
manualOnly: false
autoSync: true
syncIntervalMin: 60   # 配置类文件建议 60 分钟，避免频繁请求
```

### CLI 独立使用

```bash
# 测试连接
node lib/cli/cli/index.js test

# 推送
node lib/cli/cli/index.js push

# 拉取
node lib/cli/cli/index.js pull

# 查看状态
node lib/cli/cli/index.js status
```

---

## 安全说明

- `password` 字段标记为 `secret`，在 UI 中会被脱敏显示
- 建议使用 WebDAV 应用专用密码，而非主账号密码
- 通过 Tailscale 访问时无需暴露 WebDAV 到公网，安全性有保障
- 若直接使用公网 URL，务必启用 HTTPS

---

## 注意事项

- **sessions 不同步**：两端各自维护会话历史，避免 SQLite/JSONL 并发写入冲突
- **配置变更生效**：修改 `settings.yaml` 后需要重启 Harness 才能生效
- **跨设备同时编辑配置**：建议约定一个主编辑设备，其他设备只读，避免冲突
- **10 分钟轮询足够**：配置文件不是高频写入，syncIntervalMin 设为 10-30 分钟即可

---

## 许可证

MIT
