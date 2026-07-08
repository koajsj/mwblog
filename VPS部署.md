# VPS 部署和更新

## 首次部署

在 VPS 上执行一条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo bash
```

脚本会提示输入 Supabase URL、anon key、service role key，并自动生成 `APP_ENCRYPTION_KEY`。

如果要绑定域名：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo DOMAIN="example.com" ENABLE_SSL=1 bash
```

## 更新

部署完成后，以后更新只需要：

```bash
sudo /opt/mwblog/scripts/vps-update.sh
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

首次部署或更新后，在 Supabase SQL Editor 按顺序执行 `supabase/migrations/` 里的迁移，至少要包含最新的：

```text
014_privacy_lockdown.sql
015_private_text_encryption.sql
```

`015_private_text_encryption.sql` 会放宽加密字段的长度约束，并清空旧的经纬度字段。
