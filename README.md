# Our Nest

只给两个人使用的情侣网站。数据、照片和备份全部保存在自己的 Debian VPS，不需要 Supabase，也没有注册入口。

固定账号为 `kikou` 和 `scoinmic`，登录密码已按约定写成部署时使用的 scrypt 校验值，仓库不保存明文密码。

网站域名已经默认设为 `076113.xyz`。为避免把访问者 IP 发送给第三方，自动 IP 天气默认关闭。

## 你需要准备什么

只要三样：

1. 一台 Debian 12 VPS，能用 `root` 或 `sudo`。
2. 域名 `076113.xyz`。
3. 一个 Cloudflare 免费账号。

不需要数据库账号，不需要对象存储账号，也不需要手工填写密钥。

## Cloudflare 托管域名

### 1. 把域名加到 Cloudflare

登录 Cloudflare，点“添加域”，输入：

```text
076113.xyz
```

选择免费套餐。Cloudflare 会显示两条 Nameserver，也就是名称服务器。

回到你购买 `076113.xyz` 的域名商后台，把原来的 Nameserver 换成 Cloudflare 给出的两条。等待 Cloudflare 显示域名已激活，通常几分钟到几小时。

### 2. 添加 DNS 记录

进入 Cloudflare 的“DNS”，添加：

```text
类型：A
名称：@
IPv4 地址：你的 VPS 公网 IPv4
代理状态：仅 DNS，也就是灰色云朵
TTL：自动
```

第一次部署先保持灰色云朵，让 VPS 可以顺利申请 HTTPS 证书。

### 3. 打开 VPS 端口

在 VPS 服务商的防火墙或安全组里放行：

```text
22   SSH
80   HTTP
443  HTTPS
```

## 第一次部署

SSH 登录 VPS，执行下面三步：

```bash
git clone --depth 1 --branch main https://github.com/koajsj/mwblog.git mwblog-deploy
cd mwblog-deploy
sudo bash scripts/vps-deploy.sh
```

这样部署脚本会先落到 VPS 本地，你可以在执行前查看 `scripts/vps-deploy.sh`。不要把远程脚本直接通过管道交给 `sudo` 执行。

如果第一行提示 `git: command not found`，先执行：

```bash
sudo apt-get update
sudo apt-get install -y git
```

脚本会自动完成：

- 安装 Node.js、Nginx 和 Certbot
- 拉取代码并安装锁定版本的依赖
- 运行测试和生产构建
- 创建低权限服务账号
- 初始化 SQLite 数据库和两个固定账号
- 配置 `076113.xyz`、HTTPS 和 systemd
- 创建每天一次的加密备份任务
- 安装更新、备份和恢复命令

看到下面这行才算真正成功：

```text
Deployment complete: https://076113.xyz
```

如果 HTTPS 证书申请失败，脚本会直接失败，不会把纯 HTTP 当成部署成功。

## Cloudflare 代理选择

以隐私为优先时，部署后继续保持 DNS 灰云，不要开启 Cloudflare 代理。这样 HTTPS 在浏览器与 VPS 之间直接终止，Cloudflare 只负责 DNS，不能在代理层读取或改写网站响应。

只有确实需要 Cloudflare 的代理防护时才切换为橙云，并进入“SSL/TLS”选择 `Full (strict)`。代理模式意味着 Cloudflare 参与 TLS 链路，这与“不让第三方接触网站流量”的目标存在取舍。

不要选择 `Flexible`，它会破坏安全 Cookie 和请求来源校验。

如明确接受把访问者 IP 交给 `ipwho.is` 做城市定位，可在 `/etc/mwblog.env` 增加 `ENABLE_IP_WEATHER=1` 后重启服务。默认不要开启。

## 以后更新

代码推送到 `main` 后，SSH 登录 VPS，只执行：

```bash
sudo mwblog-update
```

更新命令会自动执行以下流程：

- 先创建一份加密备份
- 在新的 release 目录拉取 `main`、安装锁定依赖、运行测试和生产构建
- 仅在构建、启动与本机健康检查都通过后，原子切换到新版本
- 任一步失败都自动切回旧版本，数据库和照片不会被代码更新覆盖

当前与最近的 4 个旧 release 会保留在 `/opt/mwblog/releases/`。数据始终位于 `/var/lib/mwblog`，备份位于 `/var/backups/mwblog`。

更新完成后可检查服务状态：

```bash
sudo systemctl status mwblog --no-pager
```

如果更新命令报错，先查看日志；旧版本已自动恢复，无需重新部署：

```bash
sudo journalctl -u mwblog -n 100 --no-pager
```

## 备份

系统每天凌晨 `03:20` 自动备份，也可以随时手动执行：

```bash
sudo mwblog-backup
```

备份位置：

```text
/var/backups/mwblog/
```

备份包含 SQLite 数据库、私密空间密钥包、文章文件和全部加密照片。备份文件使用 AES-256-GCM 加密，并带版本、文件大小、SHA-256 和 SQLite 完整性校验。默认保留 30 天。

部署脚本会自动生成备份密钥，保存在：

```text
/etc/mwblog.env
```

这个文件只有 `root` 和网站服务账号能读取。建议部署成功后把其中的 `BACKUP_ENCRYPTION_KEY` 另外保存在自己的密码管理器中；VPS 和密钥一起丢失时，加密备份无法恢复。

## 恢复备份

找到要恢复的备份文件，然后执行：

```bash
sudo mwblog-restore /var/backups/mwblog/mwblog-时间.tar.gz.enc
```

恢复命令会先备份当前状态，再停止网站、验证备份完整性、原子替换数据并重新启动。恢复后旧会话会被清除，需要重新登录。

## 下载到个人电脑长期保存

登录网站后，点击顶部的 `Export`。输入两次压缩包密码后，浏览器会下载：

```text
our-nest-readable-时间戳.zip
```

请为归档设置至少 12 位、且不同于网站登录密码的独立强密码。这个密码只用于本次归档，不会上传到 VPS，也不会修改网站登录密码。

导出范围是整个情侣空间，不是当前登录账号：两个账号的文章、生活记录、照片、活动、地点、评论、待办和状态都会放进同一个压缩包。压缩包内按内容分类，文章为 Markdown，文字表格为 UTF-8 CSV，照片恢复为原图格式。

归档使用 WinZip AES-256 加密。Windows 安装 [7-Zip](https://www.7-zip.org/) 后，右键压缩包并选择 7-Zip 解压，输入刚才设置的密码即可。Windows 自带的资源管理器不一定支持 AES 加密 ZIP，因此请使用较新版本的 7-Zip。

这个可阅读归档用于个人长期保存，不能替代 `/var/backups/mwblog/` 中用于完整恢复网站的灾难恢复备份。建议两种备份都保留，并把归档密码与文件分开保存。

## 数据放在哪里

```text
/var/lib/mwblog/our-nest.sqlite   网站数据库
/var/lib/mwblog/storage/          加密文章和照片
/var/backups/mwblog/              加密备份
/opt/mwblog/releases/             各个代码版本
/opt/mwblog/current               当前运行版本
/etc/mwblog.env                   域名、数据目录和备份密钥
```

新文章、照片和私密文字仍然在浏览器端加密，VPS 保存的是密文。SQLite 负责元数据、会话和固定账号映射。

## 常用排错命令

```bash
sudo systemctl status mwblog
sudo journalctl -u mwblog -n 100 --no-pager
sudo nginx -t
sudo systemctl status mwblog-backup.timer
```

如果第一次申请证书失败，先检查：

- `076113.xyz` 的 A 记录是否真的是 VPS 公网 IP
- Cloudflare 云朵是否还是灰色
- VPS 的 80 和 443 端口是否放行
- 其他程序是否占用了 80 或 443 端口

修好后重新运行第一次部署命令即可。

## 本地开发

本地已有依赖时：

```bash
cp .env.example .env
npm run dev
```

本地数据默认写到 `.data/`，已被 Git 忽略。不要提交 `.env`、`.data`、`node_modules`、`dist` 或 `.astro`。
