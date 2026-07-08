# 「我们的小窝 / Our Nest」项目交接文档

最后更新：2026-05-27  
项目仓库：https://github.com/tkg2197/cute-blog  
线上地址：Vercel 部署，域名以后按实际项目设置为准

---

## 1. 项目概况

「我们的小窝」是一个双人情侣向生活博客。网站不是后台工具，而是一个柔和、可爱、有空气感的小窝：记录博客、照片、生活便签、想去的地方、日常活动和待办完成时间。

两位作者固定为：

| 作者 key | 显示身份 | 主色 |
|---|---|---|
| `white` | 小魏 / White | `#7aa6d4` |
| `brown` | tkg / Brown | `#d49356` |

页面文字和 UI 大多是英文风格，但业务数据支持中文。新增功能优先保持这个项目的“轻、软、可爱”气质，不要改成常规管理后台风。

---

## 2. 技术栈

| 层 | 当前选型 |
|---|---|
| 前端 / SSR | Astro `6.3.7`，`output: "server"` |
| 部署 adapter | `@astrojs/vercel` |
| React | 只在 To Do 页使用，`@astrojs/react` + React 19 |
| 数据库 / 认证 / 文件 | Supabase Auth + Postgres + Storage |
| 包管理 | npm，使用 `package-lock.json` |
| 主要语言 | Astro / TypeScript / React / CSS |
| 字体 | `public/fonts/Satoshi-Variable*.ttf` |

`astro.config.mjs` 里启用了 Vercel adapter、React integration，并把 `@supabase/supabase-js` 放进 `vite.ssr.noExternal`，避免 SSR 打包时出问题。

---

## 3. 当前功能总览

| 模块 | 路由 | 说明 |
|---|---|---|
| 首页 | `/` | 欢迎封面、双人状态、天气/定位、最近照片、入口卡片、最近文章 |
| 双人博客 | `/blog`, `/blog/[slug]` | Markdown 上传、标签、简介、作者/标签筛选、阅读时间、TOC、评论 |
| 生活记录 | `/records` | 日常便签时间线，支持照片联动和评论 |
| 照片墙 | `/photos` | 按日期分组、照片详情网格、灯箱 |
| Activity | `/activity` | 按天/月查看活动，24 小时时间输入，起止时间统计 |
| To Do | `/todo` | React 待办应用，完成任务时可填多个时间段，并同步到 Activity |
| Places | `/places` | 想去的地方卡片墙 |
| 登录 | `/auth/login` | 邮箱密码登录，账号由 Supabase 后台预置 |

注意：旧文档里提到的 `/admin` 当前代码里已经没有对应页面。上传和管理入口已经分散在各业务页面及 API 中。

---

## 4. 目录结构

```text
astro/
├── astro.config.mjs
├── package.json
├── package-lock.json
├── vercel.json
├── HANDOFF.md
├── README.md
├── 更新流程.md
├── public/
│   ├── assets/              # 首页图片等静态资产
│   ├── fonts/               # Satoshi 字体
│   ├── gif/                 # 两只小狗的待机/动作素材
│   ├── scripts/             # 页面交互脚本
│   └── styles/              # 全站和页面 CSS
├── src/
│   ├── components/
│   │   └── TodoApp.tsx      # To Do 的 React 主组件
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   └── PrototypeLayout.astro
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── author-display.ts
│   │   ├── comments-display.ts
│   │   ├── datetime.ts
│   │   ├── env.ts
│   │   ├── files.ts
│   │   ├── markdown.ts
│   │   ├── storage.ts
│   │   ├── supabase.ts
│   │   ├── todo-utils.ts
│   │   └── types.ts
│   ├── middleware.ts
│   └── pages/
│       ├── index.astro
│       ├── activity.astro
│       ├── photos.astro
│       ├── places.astro
│       ├── records.astro
│       ├── todo.astro
│       ├── blog/
│       │   ├── index.astro
│       │   └── [slug].astro
│       ├── auth/
│       │   └── login.astro
│       └── api/
│           ├── activity/
│           ├── auth/
│           ├── blog/
│           ├── comments/
│           ├── photos/
│           ├── places/
│           ├── records/
│           ├── status/
│           └── todos/
└── supabase/
    └── migrations/
        ├── 001_initial_schema.sql
        ├── 002_life_records.sql
        ├── 003_activity_entries.sql
        ├── 004_places.sql
        ├── 005_profile_weather.sql
        ├── 006_profile_status.sql
        ├── 007_profile_location.sql
        ├── 008_comments.sql
        ├── 009_activity_time_range.sql
        ├── 010_todos.sql
        ├── 011_todo_activity_entries.sql
        └── 012_todo_archived_at.sql
```

---

## 5. 主要页面和入口文件

| 要改的功能 | 主要文件 |
|---|---|
| 首页 | `src/pages/index.astro`, `public/scripts/home.js`, `public/scripts/cover.js` |
| 共享壳、导航、云朵、小狗 | `src/layouts/PrototypeLayout.astro`, `public/styles/styles.css` |
| 博客列表 / 上传 | `src/pages/blog/index.astro`, `src/pages/api/blog/upload.ts`, `public/scripts/blog-index.js`, `public/styles/blog-index.css` |
| 博客详情 / TOC / 阅读体验 | `src/pages/blog/[slug].astro`, `public/scripts/blog.js`, `public/styles/blog.css` |
| Markdown 解析 | `src/lib/markdown.ts` |
| 生活记录 | `src/pages/records.astro`, `src/pages/api/records/*`, `public/scripts/records.js`, `public/styles/records.css` |
| 照片墙 | `src/pages/photos.astro`, `src/pages/api/photos/*`, `public/scripts/photos.js`, `public/styles/photos.css` |
| Activity | `src/pages/activity.astro`, `src/pages/api/activity/*`, `public/scripts/activity.js`, `public/styles/activity.css` |
| To Do | `src/pages/todo.astro`, `src/components/TodoApp.tsx`, `src/pages/api/todos/*`, `src/lib/todo-utils.ts`, `public/styles/todo.css` |
| Places | `src/pages/places.astro`, `src/pages/api/places/*`, `public/styles/places.css` |
| 评论 | `src/pages/api/comments/*`, `src/lib/comments-display.ts`, `public/styles/comments.css` |
| 登录 | `src/pages/auth/*`, `src/pages/api/auth/*`, `src/lib/auth.ts`, `src/middleware.ts` |

---

## 6. 数据模型和迁移

所有数据库结构变化都放在 `supabase/migrations/`。本地改 SQL 文件不会自动同步到 Supabase，需要手动去 Supabase Dashboard 的 SQL Editor 执行。

当前迁移到 `012_todo_archived_at.sql`：

| 迁移 | 作用 |
|---|---|
| `001_initial_schema.sql` | `profiles`, `blog_posts`, `photos`，storage bucket 和基础 RLS |
| `002_life_records.sql` | 生活记录表 |
| `003_activity_entries.sql` | Activity 基础表 |
| `004_places.sql` | 想去地点表 |
| `005_profile_weather.sql` | profile 天气字段 |
| `006_profile_status.sql` | profile 心情 / 正在做字段 |
| `007_profile_location.sql` | profile 天气定位字段 |
| `008_comments.sql` | 博客和记录评论 |
| `009_activity_time_range.sql` | Activity 新增 `start_time` / `end_time` |
| `010_todos.sql` | To Do 表和完成时间字段 |
| `011_todo_activity_entries.sql` | To Do 和 Activity 的多条完成时间段关联表 |
| `012_todo_archived_at.sql` | 已完成 To Do 的软隐藏字段 `archived_at` |

重要：To Do 的“多个完成时间段”和“删除已完成任务后保留统计/Activity”依赖 `011` 和 `012`。代码对缺少 `011` 有一部分容错，但线上库最好完整执行到 `012`。

---

## 7. 核心表说明

### `profiles`

用户资料表。`author_key` 只有 `white` / `brown` 两种，决定作者身份、颜色和部分筛选逻辑。还包含天气、位置、心情和正在做的状态字段。

### `blog_posts`

博客文章表。正文同时存入 `content_markdown`，原始 `.md` 也备份到 `blog-markdown` bucket。列表和详情的预计阅读时间都基于同一个 `estimatedReadMinutes(markdown)` 算法。

### `photos`

照片表，配合公开的 `photos` bucket 使用。照片墙会按 `taken_on` 分组，生活记录也会按作者和日期关联当天照片。

### `life_records`

生活记录表，按日期记录日常文本和 mood。评论系统支持 `record` 类型目标。

### `comments`

评论表，`target_type` 为 `blog` 或 `record`，`target_id` 指向对应内容。评论 API 在 middleware 保护范围内，需要登录。

### `activity_entries`

活动表。当前支持精确时间范围：

- `activity_on`: 日期
- `start_time` / `end_time`: 24 小时制起止时间
- `minutes`: 由起止时间计算或同步写入
- `period`: 根据开始时间自动归入早晨/上午/中午等时段
- `category`: `学习 / 工作 / 约会 / 家务 / 娱乐 / 休息 / 运动 / 其他`

### `todos`

待办表。完成任务后会记录：

- `completed_on`
- `completed_start_time`
- `completed_end_time`
- `completed_minutes`
- `activity_entry_id`: 兼容旧的单条 Activity 关联
- `archived_at`: 已完成任务被“删除”时只软隐藏，不清除统计

### `todo_activity_entries`

To Do 和 Activity 的多对多关联表。一个任务可以有多个完成时间段，每个时间段会生成一条 Activity 记录，并在这里保存关联。

---

## 8. 认证和权限

认证走 Supabase Auth，session 放在 httpOnly cookie：

- `cb-access-token`
- `cb-refresh-token`

`src/middleware.ts` 每个请求都会：

1. 从 cookie 读取 session。
2. 验证或刷新 access token。
3. 将 `locals.user`、`locals.session`、`locals.profile` 注入 Astro 上下文。
4. 新用户没有 profile 时自动 upsert。
5. 对受保护 API 做登录拦截。

当前 middleware 保护前缀：

```ts
["/api/blog", "/api/photos", "/api/records", "/api/activity", "/api/comments"]
```

部分 API 虽不在 middleware 保护列表中，也会在 endpoint 内自己检查 `locals.user`，例如 To Do。

网站不提供注册接口。固定账号为 `mm / qwerasdf` 和 `ww / qwerasdf`，运行 `npm run setup:users` 可在 Supabase Auth 中创建或更新账号，并同步 `profiles` 表中的 `author_key`。

---

## 9. 博客系统现状

博客上传支持：

- Markdown 文件上传
- 手动填写 tags
- frontmatter 里的 `tags/tag/标签`
- frontmatter 里的 `title/标题`
- frontmatter 里的 `excerpt/description/summary/desc/简介/摘要`
- 英文冒号和中文全角冒号
- 中文文件名和中文 slug

曾经出现过 Supabase Storage 报 `Invalid key: .../中文文件名.md`。现在 `src/lib/files.ts` 里的 `storageSafeName()` 会生成安全 ASCII 文件名，避免 storage key 被中文和特殊字符弄坏；博客公开 slug 仍保留可读标题。

列表页和详情页的阅读时间已经统一，都使用 `src/lib/markdown.ts` 的 `estimatedReadMinutes()`，并基于正文 `content_markdown` 计算。

博客详情页的内容显示和 TOC：

- `renderArticleSections()` 按 `##` 切 section。
- 一级标题在页面头部显示，正文里会跳过。
- 如果正文一开始没有二级标题，会先渲染普通内容，但不再强行显示一个生硬的 `Content` 标题。
- `scroll-reveal.js` 不再控制 `.article-section`，避免长文章 section 因 IntersectionObserver 阈值问题一开始空白。

---

## 10. Activity 现状

Activity 页支持日视图和月视图，作者切换在顶部。新增活动时现在使用 24 小时制文本输入，而不是浏览器默认的滚轮时间选择。

时间输入规则：

- 推荐格式：`11:00`
- 支持用户输入后自动规范化，例如 `930` 或 `9:30` 会变成 `09:30`
- HTML pattern 使用显式 `[0-9]`，避免 `\d` 在浏览器 pattern 里兼容异常
- 后端 `src/pages/api/activity/create.ts` 会再次校验并计算分钟数

Activity 页面展示包含：

- 每日/每月统计
- 作者筛选
- 分类占比
- 精确开始/结束时间
- 按任务名聚合
- 开始时间概览

---

## 11. To Do 现状

To Do 页是项目里目前唯一的 React island，主逻辑在 `src/components/TodoApp.tsx`。

当前能力：

- 按作者查看各自任务。
- 只能编辑当前登录作者自己的任务。
- 新建、编辑、完成、恢复、删除任务。
- 完成任务时弹窗选择日期和一个或多个 24 小时时间段。
- 每个时间段都会同步生成一条 Activity 记录。
- 多个时间段分别统计进 Activity，而 To Do 自身合计总分钟。
- 热力图为 8 行布局，尽量不用左右滑动就能看完全年。
- 已完成任务点删除时只是 `archived_at` 软隐藏，不会删掉任务统计，也不会删掉 Activity 记录。
- 未完成任务点删除时仍然硬删除。
- `Clear completed` 对已完成任务也是软隐藏。

几个关键 API：

| API | 作用 |
|---|---|
| `GET /api/todos` | 读取指定作者任务 |
| `POST /api/todos/create` | 新建任务 |
| `POST /api/todos/update` | 改标题 |
| `POST /api/todos/complete` | 完成任务，写入多时间段 Activity |
| `POST /api/todos/uncomplete` | 恢复任务，并清理关联 Activity |
| `POST /api/todos/delete` | 未完成任务硬删除，已完成任务软隐藏 |
| `POST /api/todos/clear-completed` | 批量软隐藏已完成任务 |
| `POST /api/todos/toggle-all` | 批量状态操作 |

如果改 To Do 统计，特别注意“列表显示”和“统计数据”的边界：`archived_at` 的任务不应出现在列表里，但已完成的 archived 任务仍要进入热力图、总时长、连续天数等统计。

---

## 12. 首页状态、天气和定位

首页读 `profiles` 里的状态字段，相关 API 在 `src/pages/api/status/`：

- `field.ts`: 更新心情、正在做等文本字段
- `weather.ts`: 更新天气文本和定位信息

这些字段不是单独建表，而是挂在 `profiles` 上。对应迁移为 `005`、`006`、`007`。

---

## 13. 共享脚本和样式

| 文件 | 作用 |
|---|---|
| `site-loader.js/css` | 全站加载动画 |
| `site-prefetch.js` | 站内页面预取 |
| `page-transition.js/css` | 站内跳转过渡动画 |
| `corner-dogs.js/css` | 右下角两只小狗互动 |
| `ghost.js/css` | 页面氛围装饰 |
| `scroll-reveal.js/css` | 滚动出现动画 |
| `confirm-delete.js/css` | 删除确认弹窗 |
| `comments.css` | 评论组件样式 |

改共享脚本时要特别小心：它们会影响多个页面。比如 `scroll-reveal.js` 曾经导致博客正文在初次进入时不可见。

---

## 14. 环境变量和 Supabase Storage

`.env` 必须本地保留，不能提交。至少需要：

```text
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Storage bucket：

| Bucket | 公开 | 用途 |
|---|---|---|
| `photos` | 是 | 照片公开展示 |
| `blog-markdown` | 否 | 原始 Markdown 文件备份 |

`src/lib/storage.ts` 负责确保 bucket 存在。生产环境里 service role key 只能在服务端使用，不能传给浏览器。

---

## 15. 本地开发和构建

```bash
npm install
npm run dev
npm run build
npm run preview
```

本地开发地址通常是 `http://localhost:4321`。如果依赖或 Node 版本有警告，先看 `package.json`：当前要求 Node `>=22.12.0`。

上线前至少跑一次：

```bash
npm run build
```

数据库迁移不会随 build 自动执行。改了 `supabase/migrations` 后，要手动去 Supabase SQL Editor 跑对应 SQL。

---

## 16. 后续接手时最该注意的坑

1. 不要把 `.env`、Supabase service role key、真实 token 提交到 git。
2. 当前本地很可能直接连生产 Supabase，调试删除/上传前先确认自己在做什么。
3. To Do 的 completed 删除是软隐藏，不能随手改回硬删除，否则 Activity 和统计会丢。
4. To Do 多时间段依赖 `todo_activity_entries`，线上库必须执行到 `011`。
5. To Do 软隐藏依赖 `todos.archived_at`，线上库必须执行到 `012`。
6. 博客 storage path 必须保持安全 ASCII，公开 slug 可以是中文。
7. 博客阅读时间列表页和详情页必须走同一个算法，避免再次出现不一致。
8. Activity 时间输入要保持文本 `HH:mm`，不要改回 `type="time"`，否则又会出现 12 小时制/滚轮选择体验。
9. `PrototypeLayout.astro` 是大多数页面的壳，改导航、登录胶囊、全站装饰会影响所有主页面。
10. `public/scripts/scroll-reveal.js` 是全局脚本，新增 reveal 选择器前要确认不会让大块内容初始不可见。

---

## 17. 建议阅读顺序

新接手时建议按这个顺序看：

1. `src/lib/types.ts`：先理解数据模型。
2. `src/middleware.ts`：理解登录态和 profile 注入。
3. `src/layouts/PrototypeLayout.astro`：理解全站壳。
4. `src/pages/blog/index.astro` + `src/pages/api/blog/upload.ts`：理解上传和内容解析。
5. `src/pages/activity.astro` + `src/pages/api/activity/create.ts`：理解时间统计。
6. `src/components/TodoApp.tsx` + `src/pages/api/todos/complete.ts`：理解 To Do 和 Activity 联动。
7. `supabase/migrations/001_initial_schema.sql` 到 `012_todo_archived_at.sql`：对照数据库真实结构。

改完任何功能后，尽量同时更新这份文档。这个项目变化很快，文档最怕“看起来详细，但其实是旧世界地图”。
