import type { APIRoute } from "astro";
import { storageSafeName } from "../../../lib/files";
import { parseMarkdown, parseTagList, slugify } from "../../../lib/markdown";
import { ensureStorageBuckets } from "../../../lib/storage";
import { safeLocalRedirect } from "../../../lib/redirect";
import { encryptPrivateText } from "../../../lib/private-data";
import { createServiceClient } from "../../../lib/supabase";

function mergeTags(...groups: string[][]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  groups.flat().forEach((tag) => {
    const clean = tag.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    tags.push(clean.slice(0, 32));
  });
  return tags.slice(0, 12);
}

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const file = form.get("markdown");
  const manualSlug = String(form.get("slug") || "").trim();
  const manualTags = parseTagList(String(form.get("tags") || ""));
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/blog");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!(file instanceof File) || file.size === 0) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please choose a Markdown file to upload.")}`, 303);
  }

  if (file.size > 1024 * 1024) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Markdown files must be 1 MB or smaller.")}`, 303);
  }

  if (!/\.(md|markdown)$/i.test(file.name)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Blog uploads only accept .md or .markdown files.")}`, 303);
  }

  const content = await file.text();
  const parsed = parseMarkdown(content, file.name.replace(/\.(md|markdown)$/i, ""));
  const tags = mergeTags(parsed.tags, manualTags);
  const slug = slugify(manualSlug || parsed.title);
  const supabase = createServiceClient();
  const storageName = storageSafeName(slug, "post");
  const storagePath = `${user.id}/${storageName}-${Date.now()}-${crypto.randomUUID()}.md`;
  const { data: existingPost, error: existingError } = await supabase
    .from("blog_posts")
    .select("id,author_id,storage_path")
    .eq("slug", slug)
    .maybeSingle();

  if (existingError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(existingError.message)}`, 303);
  }

  if (existingPost && existingPost.author_id !== user.id) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("This post slug is already used by another account.")}`, 303);
  }

  try {
    await ensureStorageBuckets();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage initialization failed";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(message)}`, 303);
  }

  const encryptedContent = encryptPrivateText(content);
  const { error: uploadError } = await supabase.storage.from("blog-markdown").upload(storagePath, new Blob([encryptedContent]), {
    contentType: "text/plain; charset=utf-8",
    upsert: false,
  });

  if (uploadError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(uploadError.message)}`, 303);
  }

  const { error: upsertError } = await supabase.from("blog_posts").upsert(
    {
      slug,
      title: encryptPrivateText(parsed.title),
      excerpt: encryptPrivateText(parsed.excerpt.slice(0, 320)),
      content_markdown: encryptedContent,
      storage_path: storagePath,
      author_id: user.id,
      tags,
      published_at: new Date().toISOString(),
    },
    { onConflict: "slug" },
  );

  if (upsertError) {
    await supabase.storage.from("blog-markdown").remove([storagePath]);
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(upsertError.message)}`, 303);
  }

  if (existingPost?.storage_path && existingPost.storage_path !== storagePath) {
    await supabase.storage.from("blog-markdown").remove([existingPost.storage_path]);
  }

  return redirect(`/blog/${encodeURIComponent(slug)}`, 303);
};
