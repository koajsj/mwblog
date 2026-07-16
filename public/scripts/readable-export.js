import { createAesZip } from "/scripts/aes-zip.js";

const encoder = new TextEncoder();
const form = document.getElementById("exportForm");
const button = document.getElementById("exportButton");
const passwordInput = document.getElementById("exportPassword");
const confirmInput = document.getElementById("exportPasswordConfirm");
const progress = document.getElementById("exportProgress");
const progressBar = document.getElementById("exportProgressBar");
const status = document.getElementById("exportStatus");
const backupHealth = document.getElementById("backupHealth");

function backupTime(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function loadBackupHealth() {
  if (!backupHealth) return;
  try {
    const response = await fetch("/api/status/backup", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error("unavailable");
    const backup = data.backup || {};
    if (backup.status === "unknown") {
      backupHealth.textContent = "暂时没有备份状态。首次服务器备份完成后，这里会显示校验结果。";
      return;
    }
    if (backup.status === "failed") {
      const previous = backup.lastSuccessAt ? `上次成功：${backupTime(backup.lastSuccessAt)}。` : "尚无成功备份记录。";
      backupHealth.textContent = `最近一次备份没有完成（${backupTime(backup.lastAttemptAt)}）。${previous}`;
      return;
    }
    if (backup.stale) {
      backupHealth.textContent = `上次成功备份：${backupTime(backup.lastSuccessAt)}。备份状态已超过一天半，请在 VPS 上检查定时任务。`;
      return;
    }
    backupHealth.textContent = `最近成功备份：${backupTime(backup.lastSuccessAt)}。SQLite 快照已通过完整性校验。`;
  } catch {
    backupHealth.textContent = "暂时无法读取服务器备份状态，请稍后重试。";
  }
}

function setStatus(message, percent) {
  progress.hidden = false;
  status.textContent = message;
  progressBar.style.width = Math.max(0, Math.min(100, percent || 0)) + "%";
}

function textFile(name, value) {
  return { name, data: encoder.encode(String(value || "")) };
}

function authorMap(data) {
  return new Map((data.profiles || []).map((profile) => [profile.id, profile.display_name || profile.author_key || "unknown"]));
}

function authorName(authors, id) {
  return authors.get(id) || "unknown";
}

function isoDate(value) {
  return String(value || "unknown").slice(0, 10).replace(/[^0-9-]/g, "") || "unknown";
}

function csvCell(value) {
  return '"' + String(value == null ? "" : value).replaceAll('"', '""') + '"';
}

function csv(rows) {
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function archiveManifest(data, counts) {
  return JSON.stringify({
    format: "our-nest-readable-backup",
    version: data.version,
    exported_at: data.exported_at,
    contents: counts,
    recovery: {
      purpose: "Offline reading and personal preservation.",
      import_supported: false,
      instructions: "Read 恢复说明.txt after extracting this password-protected archive.",
    },
  }, null, 2) + "\n";
}

function checkedPlaintext(value) {
  const text = String(value || "");
  if (text.startsWith("[Encrypted content")) throw new Error("Some private content could not be decrypted. Unlock the private space again and retry.");
  return text;
}

async function decrypt(privateSpace, value, context) {
  return checkedPlaintext(await privateSpace.decryptText(value || "", context));
}

function imageExtension(mimeType) {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  })[String(mimeType || "").toLowerCase()] || "bin";
}

async function buildFiles(data, privateSpace) {
  const files = [];
  const authors = authorMap(data);
  const counts = {
    profiles: data.profiles.length,
    posts: data.posts.length,
    records: data.records.length,
    photos: data.photos.length,
    activities: data.activities.length,
    places: data.places.length,
    comments: data.comments.length,
    todos: data.todos.length,
  };

  files.push(textFile("说明.txt", [
    "Our Nest 可阅读归档",
    "",
    "此归档包含情侣空间内两个账号的全部可读内容。",
    "生成时间：" + data.exported_at,
    "归档版本：" + data.version,
    "",
    "文件数量统计：",
    ...Object.entries(counts).map(([name, count]) => `${name}: ${count}`),
  ].join("\r\n")));
  files.push(textFile("恢复说明.txt", [
    "Our Nest 本地加密备份恢复说明",
    "",
    "这是一份可离线阅读的个人归档。它包含导出时的日记、生活记录、照片及其他共同内容。",
    "",
    "如何离线恢复内容：",
    "1. 请使用新版 7-Zip 或其他支持 WinZip AES-256 的解压工具，输入归档密码解压。",
    "2. 在“生活记录”目录查看日记文本；在“照片”目录查看原始照片；其他内容按目录分类保存。",
    "3. 建议将 ZIP 文件保留在两个独立、安全的位置，并将密码单独保存在密码管理器中。",
    "",
    "重要边界：",
    "- 此归档用于离线保存和阅读，不提供自动导入网站的功能。",
    "- 自动导入旧归档可能覆盖双方后来新增的内容，因此恢复网站服务请使用 VPS 的灾难恢复备份。",
    "- 如果网站暂时不可用，解压此归档后仍可在本机查看其中的日记与照片。",
    "",
    "归档生成时间：" + data.exported_at,
  ].join("\r\n")));
  files.push(textFile("归档清单.json", archiveManifest(data, counts)));

  const sortedPosts = [...data.posts].sort((a, b) => String(a.published_at || a.created_at).localeCompare(String(b.published_at || b.created_at)));
  for (let index = 0; index < sortedPosts.length; index += 1) {
    const post = sortedPosts[index];
    const [title, excerpt, content, tags] = await Promise.all([
      decrypt(privateSpace, post.title, "blog.title"),
      decrypt(privateSpace, post.excerpt, "blog.excerpt"),
      decrypt(privateSpace, post.content_markdown, "blog.content"),
      Promise.all((post.tags || []).map((tag) => decrypt(privateSpace, tag, "blog.tag"))),
    ]);
    files.push(textFile(`文章/${isoDate(post.published_at || post.created_at)}-${String(index + 1).padStart(4, "0")}.md`, [
      `# ${title || "Untitled"}`,
      "",
      `作者：${authorName(authors, post.author_id)}`,
      `时间：${post.published_at || post.created_at || ""}`,
      `标签：${tags.join(", ")}`,
      excerpt ? `摘要：${excerpt}` : "",
      "",
      content,
    ].filter((line, lineIndex) => lineIndex !== 5 || line).join("\n")));
  }

  const sortedRecords = [...data.records].sort((a, b) => String(a.record_on).localeCompare(String(b.record_on)));
  for (let index = 0; index < sortedRecords.length; index += 1) {
    const record = sortedRecords[index];
    const body = await decrypt(privateSpace, record.body, "record.body");
    files.push(textFile(`生活记录/${isoDate(record.record_on)}-${String(index + 1).padStart(4, "0")}.txt`, [
      `作者：${authorName(authors, record.owner_id)}`,
      `日期：${record.record_on || ""}`,
      `心情：${record.mood || ""}`,
      "",
      body,
    ].join("\r\n")));
  }

  const activityRows = [["日期", "作者", "时段", "分类", "分钟", "开始", "结束", "内容"]];
  for (const entry of data.activities) {
    activityRows.push([
      entry.activity_on,
      authorName(authors, entry.owner_id),
      entry.period,
      entry.category,
      entry.minutes,
      entry.start_time,
      entry.end_time,
      await decrypt(privateSpace, entry.body, "activity.body"),
    ]);
  }
  files.push(textFile("活动/全部活动.csv", csv(activityRows)));

  const todoRows = [["作者", "内容", "截止日期", "已完成", "完成日期", "分钟", "已归档", "创建时间"]];
  for (const todo of data.todos) {
    todoRows.push([
      authorName(authors, todo.owner_id),
      await decrypt(privateSpace, todo.title, "todo.title"),
      todo.due_on,
      todo.completed ? "是" : "否",
      todo.completed_on,
      todo.completed_minutes,
      todo.archived_at ? "是" : "否",
      todo.created_at,
    ]);
  }
  files.push(textFile("待办/全部待办.csv", csv(todoRows)));

  const placeRows = [["作者", "地点", "备注", "氛围", "创建时间"]];
  for (const place of data.places) {
    placeRows.push([
      authorName(authors, place.owner_id),
      await decrypt(privateSpace, place.name, "place.name"),
      await decrypt(privateSpace, place.note, "place.note"),
      place.tone,
      place.created_at,
    ]);
  }
  files.push(textFile("地点/全部地点.csv", csv(placeRows)));

  const commentRows = [["类型", "关联ID", "作者", "内容", "创建时间"]];
  for (const comment of data.comments) {
    commentRows.push([
      comment.target_type,
      comment.target_id,
      authorName(authors, comment.author_id),
      await decrypt(privateSpace, comment.body, "comment.body"),
      comment.created_at,
    ]);
  }
  files.push(textFile("评论/全部评论.csv", csv(commentRows)));

  const profileRows = [["账号", "心情日期", "心情", "状态日期", "正在做"]];
  for (const profile of data.profiles) {
    profileRows.push([
      profile.display_name || profile.author_key,
      profile.mood_date,
      await decrypt(privateSpace, profile.mood_text, "profile.mood"),
      profile.doing_date,
      await decrypt(privateSpace, profile.doing_text, "profile.doing"),
    ]);
  }
  files.push(textFile("状态/双方状态.csv", csv(profileRows)));

  const sortedPhotos = [...data.photos].sort((a, b) => String(a.taken_on || a.created_at).localeCompare(String(b.taken_on || b.created_at)));
  for (let index = 0; index < sortedPhotos.length; index += 1) {
    const photo = sortedPhotos[index];
    setStatus(`正在解密照片 ${index + 1}/${sortedPhotos.length}`, 10 + Math.round((index / Math.max(1, sortedPhotos.length)) * 45));
    const response = await fetch(photo.file_url, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Could not download photo ${index + 1}.`);
    const decrypted = await privateSpace.decryptFileBuffer(await response.arrayBuffer(), photo.mime_type || "application/octet-stream");
    const base = `${isoDate(photo.taken_on || photo.created_at)}-${String(index + 1).padStart(5, "0")}`;
    files.push({ name: `照片/${base}.${imageExtension(decrypted.mimeType)}`, data: decrypted.bytes });
    const [title, caption] = await Promise.all([
      decrypt(privateSpace, photo.title, "photo.title"),
      decrypt(privateSpace, photo.caption, "photo.caption"),
    ]);
    files.push(textFile(`照片说明/${base}.txt`, [
      `作者：${authorName(authors, photo.owner_id)}`,
      `日期：${photo.taken_on || photo.created_at || ""}`,
      `标题：${title}`,
      `说明：${caption}`,
    ].join("\r\n")));
  }
  return files;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  if (password.length < 12) {
    setStatus("压缩包密码至少需要 12 个字符。", 0);
    return;
  }
  if (password !== confirmInput.value) {
    setStatus("两次输入的密码不一致。", 0);
    return;
  }

  button.disabled = true;
  const privateSpace = window.OurNestPrivate;
  let files = [];
  try {
    if (!privateSpace) throw new Error("Private-space encryption is unavailable.");
    setStatus("正在解锁私密空间", 3);
    await privateSpace.ready();
    setStatus("正在读取两个人的完整数据", 7);
    const response = await fetch("/api/export/data", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load export data.");
    files = await buildFiles(data, privateSpace);
    setStatus("正在生成 AES-256 加密归档", 58);
    const archive = await createAesZip(files, password, (done, total) => {
      setStatus(`正在加密文件 ${done}/${total}`, 58 + Math.round((done / total) * 40));
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const url = URL.createObjectURL(archive);
    const link = document.createElement("a");
    link.href = url;
    link.download = `our-nest-readable-${stamp}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(`导出完成：${data.records.length} 篇日记、${data.photos.length} 张照片已保存。请把压缩包和密码分开保存。`, 100);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "导出失败，请重试。", 0);
  } finally {
    for (const file of files) if (file.data instanceof Uint8Array) file.data.fill(0);
    passwordInput.value = "";
    confirmInput.value = "";
    button.disabled = false;
  }
});

loadBackupHealth();
