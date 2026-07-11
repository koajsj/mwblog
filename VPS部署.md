# VPS 一键部署与更新

适用于 Debian 12、Cloudflare 托管的 `076113.xyz`，以及已经创建好的 Supabase 项目。

## 首次部署

先在 Supabase SQL Editor 按文件名顺序执行 `supabase/migrations/` 下全部迁移，最新必须执行到：

```text
024_switch_fixed_accounts_to_kikou_scoinmic.sql
```

然后在 VPS 执行一条命令。项目已经把 `076113.xyz` 设为默认域名，不需要再输入域名：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/mwblog/main/scripts/vps-deploy.sh | sudo bash
```

脚本只会在首次询问三个 Supabase 值：

```text
Supabase URL
Supabase anon key
Supabase service role key
```

其余步骤自动完成：安装 Node.js、Nginx 和 Certbot，拉取代码，执行 `npm ci`、测试和构建，创建两个固定账号，申请 HTTPS 证书，安装 systemd 服务和每日加密备份。

Cloudflare 中必须先把 `076113.xyz` 的 A 记录指向 VPS。首次部署时建议先使用灰云（仅 DNS），证书申请成功后再打开橙云代理。HTTPS 证书申请失败时部署会失败，不会把 HTTP 当作成功。

## 固定账号

网站没有注册入口，应用和数据库都只允许以下两个账号：

```text
kikou / Qwer@1432
scoinmic / Qwer@1432
```

如果旧 Supabase 中存在 `mm/ww`，先执行迁移 `024`，部署脚本会保留原用户 UUID 和历史内容归属，并把账号改名为 `kikou/scoinmic`。

同时在 Supabase Dashboard 的 `Authentication -> Providers -> Email` 中关闭公开注册。

## 后续更新

部署完成后只需：

```bash
sudo mwblog-update
```

更新脚本会拉取 `main`、执行 `npm ci`、同步固定账号、运行测试、构建、重启并检查服务。失败时会尝试恢复到更新前版本。

## 常用检查

```bash
sudo systemctl status mwblog
sudo journalctl -u mwblog -n 100 --no-pager
sudo systemctl status mwblog-backup.timer
```

网站地址为 `https://076113.xyz`。天气会识别 Cloudflare 转发的真实访问 IP 自动定位，不需要浏览器位置权限。
