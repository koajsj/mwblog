export interface ParsedMarkdown {
  title: string;
  excerpt: string;
  tags: string[];
  body: string;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(input: string) {
  return escapeHtml(input).replace(/'/g, "&#39;");
}

function isSafeUrl(input: string) {
  return /^(https?:|mailto:|\/|#|\.\/|\.\.\/)/i.test(input);
}

function inlineMarkdown(input: string) {
  const codeSpans: string[] = [];
  const withCodeTokens = input.replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  let html = escapeHtml(withCodeTokens);
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, alt, rawSrc, title) => {
    const src = String(rawSrc || "").trim();
    if (!isSafeUrl(src)) return escapeHtml(alt || "");
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt || "")}"${titleAttr} loading="lazy" />`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, label, rawHref, title) => {
    const href = String(rawHref || "").trim();
    if (!isSafeUrl(href)) return label;
    const external = /^https?:/i.test(href) ? ' target="_blank" rel="noreferrer"' : "";
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
    return `<a href="${escapeAttr(href)}"${external}${titleAttr}>${label}</a>`;
  });
  html = html
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([\s\S]+?)__/g, "<strong>$1</strong>")
    .replace(/~~([\s\S]+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  codeSpans.forEach((code, index) => {
    html = html.replaceAll(`\u0000CODE${index}\u0000`, code);
  });
  return html;
}

function parseFrontmatter(source: string) {
  if (!source.startsWith("---")) return { attrs: new Map<string, string>(), body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { attrs: new Map<string, string>(), body: source };
  const raw = source.slice(3, end).trim();
  const body = source.slice(end + 4).trim();
  const attrs = new Map<string, string>();
  raw.split(/\r?\n/).forEach((line) => {
    const hit = line.match(/^([\p{L}\p{N}_-]+)\s*[:：]\s*(.*)$/u);
    if (hit) attrs.set(hit[1].toLowerCase(), hit[2].replace(/^["']|["']$/g, "").trim());
  });
  return { attrs, body };
}

function frontmatterValue(attrs: Map<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = attrs.get(key.toLowerCase());
    if (value) return value;
  }
  return "";
}

export function parseTagList(value: string) {
  const seen = new Set<string>();
  return value
    .replace(/^\s*\[|\]\s*$/g, "")
    .split(/[,，、\n]+/u)
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function estimatedReadMinutes(markdown: string) {
  const text = markdownToPlainText(markdown || "");
  return Math.max(3, Math.ceil(text.length / 280));
}

export function slugify(value: string) {
  const base = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `post-${Date.now()}`;
}

export function parseMarkdown(source: string, fallbackTitle: string): ParsedMarkdown {
  const { attrs, body } = parseFrontmatter(source);
  const heading = firstMarkdownHeading(body);
  const title = frontmatterValue(attrs, ["title", "标题"]) || heading || fallbackTitle;
  const excerpt =
    frontmatterValue(attrs, ["excerpt", "description", "summary", "desc", "简介", "摘要"]) ||
    plainTextExcerpt(body) ||
    "";
  const tags = parseTagList(frontmatterValue(attrs, ["tags", "tag", "标签"]) || "");

  return { title, excerpt, tags, body };
}

export function firstMarkdownHeading(source: string) {
  return source.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim() || "";
}

export function markdownToPlainText(source: string) {
  const { body } = parseFrontmatter(source || "");
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "")
    .replace(/[|*_~`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainTextExcerpt(source: string) {
  return source
    .replace(/```[\s\S]*?```/g, "")
    .split(/\r?\n\r?\n/)
    .map((part) =>
      part
        .split(/\r?\n/)
        .filter((line) => !/^\s{0,3}#{1,6}\s+/.test(line))
        .join(" ")
        .trim(),
    )
    .map(markdownToPlainText)
    .find(Boolean);
}

function parseTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function renderTable(lines: string[]) {
  const header = parseTableRow(lines[0]);
  const rows = lines.slice(2).map(parseTableRow);
  return [
    "<table>",
    `<thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows
      .map((row) => `<tr>${header.map((_cell, index) => `<td>${inlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`)
      .join("")}</tbody>`,
    "</table>",
  ].join("");
}

export function renderMarkdown(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let codeLang = "";

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function renderList(start: number, ordered: boolean) {
    const items: string[] = [];
    let index = start;
    while (index < lines.length) {
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      const hit = lines[index].match(pattern);
      if (!hit) break;
      const checkbox = hit[1].match(/^\[([ xX])\]\s+(.+)$/);
      if (checkbox) {
        const checked = checkbox[1].toLowerCase() === "x" ? " checked" : "";
        items.push(`<li class="task-list-item"><input type="checkbox" disabled${checked} /> ${inlineMarkdown(checkbox[2])}</li>`);
      } else {
        items.push(`<li>${inlineMarkdown(hit[1])}</li>`);
      }
      index += 1;
    }
    html.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
    return index - 1;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      if (inCode) {
        const langClass = codeLang ? ` class="language-${escapeAttr(codeLang)}"` : "";
        html.push(`<pre><code${langClass}>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        codeLang = "";
        inCode = false;
      } else {
        flushParagraph();
        codeLang = line.trim().slice(3).trim().split(/\s+/)[0] || "";
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (line.includes("|") && lines[i + 1] && isTableDivider(lines[i + 1])) {
      flushParagraph();
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html.push(renderTable(tableLines));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      html.push("<hr />");
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      i = renderList(i, false);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      i = renderList(i, true);
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      const quoteLines = [quote[1]];
      while (lines[i + 1] && /^>\s?/.test(lines[i + 1])) {
        i += 1;
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
      }
      html.push(`<blockquote><p>${inlineMarkdown(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  if (code.length) {
    const langClass = codeLang ? ` class="language-${escapeAttr(codeLang)}"` : "";
    html.push(`<pre><code${langClass}>${escapeHtml(code.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

export interface ArticleSection {
  id: string;
  title: string;
  html: string;
}

// 切分 markdown，按 ## 二级标题切成多个 article-section 块，供原型 TOC 使用。
export function renderArticleSections(source: string): ArticleSection[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const sections: ArticleSection[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let counter = 0;

  function pushSection(title: string, body: string[]) {
    counter += 1;
    const id = slugify(title) || `section-${counter}`;
    sections.push({
      id,
      title: title || "Content",
      html: renderMarkdown(body.join("\n")),
    });
  }

  lines.forEach((line) => {
    // 跳过 # 一级标题，已经在 head 里展示
    if (/^#\s+/.test(line)) return;
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (currentTitle || currentLines.some((item) => item.trim())) {
        pushSection(currentTitle, currentLines);
      }
      currentTitle = h2[1].trim();
      currentLines = [];
      return;
    }
    currentLines.push(line);
  });

  if (currentTitle || currentLines.some((item) => item.trim())) {
    pushSection(currentTitle, currentLines);
  }

  return sections;
}
