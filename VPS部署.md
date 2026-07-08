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

## 必做备份

备份 VPS 上的这个文件：

```text
/opt/mwblog/.env
```

里面的 `APP_ENCRYPTION_KEY` 用来解密网站私密内容。密钥丢失后，已经加密入库的内容无法恢复。

## Supabase 迁移

首次部署或更新后，在 Supabase SQL Editor 按顺序执行 `supabase/migrations/` 里的迁移，至少要包含最新的：

```text
014_privacy_lockdown.sql
015_private_text_encryption.sql
```

`015_private_text_encryption.sql` 会放宽加密字段的长度约束，并清空旧的经纬度字段。
