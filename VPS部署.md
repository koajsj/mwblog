# VPS 部署和更新

## 首次部署

在 VPS 上执行一条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo bash
```

脚本会提示输入 Supabase URL、anon key、service role key，并自动生成 `BACKUP_ENCRYPTION_KEY`。生产运行时不需要 `APP_ENCRYPTION_KEY`；它只用于显式允许的一次性旧数据迁移。如果已有 `/opt/mwblog/.env`，脚本会保留现有配置，只补缺失的备份密钥并做必需项校验。传入 `DOMAIN` 时会写入 `APP_ORIGIN`，让 Astro 仅信任该域名对应的 Nginx HTTPS 转发头。

如果要绑定域名：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo env DOMAIN="example.com" ENABLE_SSL=1 CERTBOT_EMAIL="admin@example.com" bash
```

## 更新

部署完成后，以后更新只需要：

```bash
sudo /opt/mwblog/scripts/vps-update.sh
```

更新脚本会先拉取代码、按 `package-lock.json` 执行 `npm ci`、完成构建，然后才重启 systemd 服务。构建或重启失败时会尝试恢复到更新前的提交并重新构建启动；启用数据迁移时，数据库和 Storage 的变更不能自动回滚。固定账号已存在时只同步身份资料，不会重置密码。

常用开关：

```bash
# 更新时顺手重新同步固定双账号，默认关闭
sudo env RUN_SETUP_USERS=1 /opt/mwblog/scripts/vps-update.sh

# 客户端加密迁移需要先准备 SPACE_PASSPHRASE 或 SPACE_RECOVERY_CODE
sudo env RUN_CLIENT_MIGRATION=1 SPACE_RECOVERY_CODE="..." /opt/mwblog/scripts/vps-update.sh

# 仅在明确需要重置固定账号密码时使用
sudo env RUN_SETUP_USERS=1 RESET_FIXED_USER_PASSWORDS=1 /opt/mwblog/scripts/vps-update.sh
```

## 自动备份

部署和更新脚本会自动安装每天 03:20 运行的加密备份任务。手动备份可以执行：

```bash
sudo /opt/mwblog/scripts/vps-backup.sh
```

备份文件默认保存在：

```text
/var/backups/mwblog/
```

备份包包含数据库导出与照片/Markdown 密文，不包含 `.env`、service role key 或其他运行凭据，并且会加密成 `*.tar.gz.enc`。

第一次部署后，请把备份密钥保存到 VPS 之外，比如自己的电脑或密码管理器：

```bash
sudo grep '^BACKUP_ENCRYPTION_KEY=' /opt/mwblog/.env
```

`BACKUP_ENCRYPTION_KEY` 只用于备份包。网站正文由浏览器端私密空间密钥加密，恢复能力依赖私密空间口令或恢复码，而不是 VPS 上的应用密钥。

检查备份能不能解密：

```bash
cd /opt/mwblog
sudo BACKUP_DIR=/var/backups/mwblog npm run backup:decrypt -- /var/backups/mwblog/你的备份文件.tar.gz.enc /tmp/mwblog-backup.tar.gz
sudo tar -tzf /tmp/mwblog-backup.tar.gz | head
```

建议定期把 `/var/backups/mwblog/*.enc` 下载到自己电脑。只放在同一台 VPS 上，VPS 坏掉时也会一起丢。

## Supabase 迁移

首次部署或更新后，在 Supabase SQL Editor 按顺序执行 `supabase/migrations/` 里的全部迁移，当前至少要到：

```text
017_private_space_closure.sql
018_client_private_space_keys.sql
019_enforce_client_ciphertext.sql
020_lock_private_space_identities.sql
021_harden_private_helpers.sql
022_client_only_private_data_and_storage.sql
```

`017_private_space_closure.sql` 会关闭公开注册并收口到固定私密空间。
`018_client_private_space_keys.sql` 会创建客户端密钥包表。
`019_enforce_client_ciphertext.sql` 会强制敏感字段写入客户端密文。
`020_lock_private_space_identities.sql` 会锁定身份字段并禁止客户端覆盖已存在的密钥包。
`021_harden_private_helpers.sql` 会收紧辅助函数并清理多态评论孤儿数据。
`022_client_only_private_data_and_storage.sql` 会强制新写入使用客户端密文，并收口最终 Storage 读取策略。

## 恢复到新 Supabase

先在新项目执行全部迁移，并把 `.env` 改成新项目的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。然后执行：

```bash
cd /opt/mwblog
sudo BACKUP_ENCRYPTION_KEY="你的备份密钥" npm run restore -- /var/backups/mwblog/你的备份文件.tar.gz.enc
```

恢复前必须在目标环境配置新的 Supabase 凭据，并单独提供原备份的 `BACKUP_ENCRYPTION_KEY`。备份不会恢复或覆盖 `.env`。
