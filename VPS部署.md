# VPS 部署和更新

## 首次部署

在 VPS 上执行一条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo bash
```

脚本会提示输入 Supabase URL、anon key、service role key，并自动生成 `APP_ENCRYPTION_KEY` 和 `BACKUP_ENCRYPTION_KEY`。如果已有 `/opt/mwblog/.env`，脚本会保留现有配置，只补缺失的加密密钥并做必需项校验。

如果要绑定域名：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo env DOMAIN="example.com" ENABLE_SSL=1 CERTBOT_EMAIL="admin@example.com" bash
```

## 更新

部署完成后，以后更新只需要：

```bash
sudo /opt/mwblog/scripts/vps-update.sh
```

更新脚本会先拉取代码、按 `package-lock.json` 执行 `npm ci`、完成构建，然后才重启 systemd 服务。构建失败时不会提前重启线上服务。

常用开关：

```bash
# 更新时顺手重新同步固定双账号，默认关闭
sudo env RUN_SETUP_USERS=1 /opt/mwblog/scripts/vps-update.sh

# 仅旧服务端加密数据迁移时使用，默认关闭
sudo env RUN_LEGACY_ENCRYPTION=1 /opt/mwblog/scripts/vps-update.sh

# 客户端加密迁移需要先准备 SPACE_PASSPHRASE 或 SPACE_RECOVERY_CODE
sudo env RUN_CLIENT_MIGRATION=1 SPACE_RECOVERY_CODE="..." /opt/mwblog/scripts/vps-update.sh
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

备份包包含数据库导出、照片/Markdown 文件、以及恢复必需的 `.env` 副本，并且会加密成 `*.tar.gz.enc`。

第一次部署后，请至少把这两个恢复码保存到 VPS 之外，比如自己的电脑或密码管理器：

```bash
sudo grep -E '^(APP_ENCRYPTION_KEY|BACKUP_ENCRYPTION_KEY)=' /opt/mwblog/.env
```

`APP_ENCRYPTION_KEY` 用来解密网站私密文本；`BACKUP_ENCRYPTION_KEY` 用来解密备份包。两个都丢了，已加密内容就无法恢复。

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
```

`017_private_space_closure.sql` 会关闭公开注册并收口到固定私密空间。
`018_client_private_space_keys.sql` 会创建客户端密钥包表。
`019_enforce_client_ciphertext.sql` 会强制敏感字段写入客户端密文。

## 恢复到新 Supabase

先在新项目执行全部迁移，并把 `.env` 改成新项目的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。然后执行：

```bash
cd /opt/mwblog
sudo BACKUP_PASSWORD="你的备份恢复码" npm run restore -- /var/backups/mwblog/你的备份文件.tar.gz.enc
```

如果当前 `.env` 没有 `APP_ENCRYPTION_KEY`，恢复脚本会从备份包里补上。若当前密钥和备份密钥不一致，脚本会停止，防止恢复出无法解密的数据。
