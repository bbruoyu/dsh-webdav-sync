#!/bin/bash
# 安装 dsh-webdav-sync 插件到 DSH
# 用法: bash install.sh [/path/to/dsh-profile]
# 默认: /vol1/@appshare/deepseek.harness/dsh-data/profiles/web

PROFILE="${1:-/vol1/@appshare/deepseek.harness/dsh-data/profiles/web}"
PLUGIN_DIR="/vol2/@team/Clawzone/Harness/dsh-webdav-sync"

echo "=== 安装 dsh-webdav-sync ==="
echo "目标 profile: $PROFILE"

# 1. 创建插件目录
mkdir -p "$PROFILE/node_modules/dsh-webdav-sync/lib/host"

# 2. 复制文件
cp "$PLUGIN_DIR/lib/host/"*.js "$PROFILE/node_modules/dsh-webdav-sync/lib/host/"
cp "$PLUGIN_DIR/lib/host/"*.d.ts "$PROFILE/node_modules/dsh-webdav-sync/lib/host/"
cp "$PLUGIN_DIR/cordis.patch.yml" "$PROFILE/node_modules/dsh-webdav-sync/"
cp "$PLUGIN_DIR/package.json" "$PROFILE/node_modules/dsh-webdav-sync/"
cp "$PLUGIN_DIR/README.md" "$PROFILE/node_modules/dsh-webdav-sync/"
cp "$PLUGIN_DIR/LICENSE" "$PROFILE/node_modules/dsh-webdav-sync/"

# 3. 更新 package.json
python3 -c "
import json, sys
path = '$PROFILE/package.json'
try:
    with open(path) as f:
        d = json.load(f)
except Exception as e:
    print(f'读取 package.json 失败: {e}', file=sys.stderr)
    sys.exit(1)

deps = d.setdefault('dependencies', {})
dsh = d.setdefault('dsh', {}).setdefault('profile', {})
bundles = dsh.setdefault('bundles', [])

if 'dsh-webdav-sync' not in deps:
    deps['dsh-webdav-sync'] = 'file:./node_modules/dsh-webdav-sync'
    print('✓ 添加 dependency')
else:
    print('✓ dependency 已存在')

if 'dsh-webdav-sync' not in bundles:
    bundles.append('dsh-webdav-sync')
    print('✓ 添加到 bundles')
else:
    print('✓ bundles 已包含')

with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('✓ package.json 已更新')
"

echo ""
echo "=== 安装完成 ==="
echo ""
echo "重启 DSH 后使用："
echo "  /webdav-sync test       # 测试 WebDAV 连接"
echo "  /webdav-sync push-config # 推送配置"
echo "  /webdav-sync backup     # 全量备份"
echo ""
echo "配置地址：DSH 设置 → 插件 → dsh-webdav-sync"
