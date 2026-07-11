import type { APIRoute } from "astro";
import { isOwnedStoragePath, storageSafeName } from "../../../lib/files";
import { parseTagList, slugify } from "../../../lib/markdown";
import { ensureStorageBuckets } from "../../../lib/storage";
import { safeLocalRedirect } from "../../../lib/redirect";
import { readEncryptedText } from "../../../lib/private-payload";
import { createLocalsClient, createServiceClient } from "../../../lib/supabase";

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

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const payload = await request.json().catch(() => null);
  const manualSlug = String(payload?.slug || "").trim().slice(0, 180);
  const manualTags = parseTagList(String(payload?.tags || "").slice(0, 4096));
  const rawReturn = String(payload?.return_to || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/blog");
  const sep = safeReturn.includes("?") ? "&" : "?";
  const fallbackTitle = String(payload?.filename || "post").slice(0, 180).replace(/\.(md|markdown)$/i, "") || "post";
  let title = "";
  let excerpt = "";
  let content = "";
  try {
    title = readEncryptedText(payload?.title, { maxLength: 4096 });
    excerpt = readEncryptedText(payload?.excerpt, { maxLength: 4096 });
    content = readEncryptedText(payload?.content_markdown, { maxLength: 2000000 });
  } catch (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid encrypted blog content.")}`, 303);
  }

  const tags = mergeTags(
    Array.isArray(payload?.parsed_tags)
      ? payload.parsed_tags.slice(0, 50).map((item: unknown) => String(item || "").slice(0, 128))
      : [],
    manualTags,
  );
  const slug = slugify(manualSlug || fallbackTitle).slice(0, 120);
  const supabase = createLocalsClient(locals);
  const storage = createServiceClient().storage.from("blog-markdown");
  const storageName = storageSafeName(slug, "post");
  const storagePath = `${user.id}/${storageName}-${Date.now()}-${crypto.randomUUID()}.md`;
  const { data: existingPost } = await supabase
    .from("blog_posts")
    .select("id,storage_path")
    .eq("slug", slug)
    .eq("author_id", user.id)
    .maybeSingle();

  try {
    await ensureStorageBuckets();
  } catch {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Blog storage is temporarily unavailable.")}`, 303);
  }

  const { error: uploadError } = await storage.upload(storagePath, new Blob([content]), {
    contentType: "text/plain; charset=utf-8",
    upsert: false,
  });

  if (uploadError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not upload the encrypted diary file.")}`, 303);
  }

  const { error: upsertError } = await supabase.from("blog_posts").upsert(
    {
      slug,
      title,
      excerpt,
      content_markdown: content,
      storage_path: storagePath,
      author_id: user.id,
      tags,
      published_at: new Date().toISOString(),
    },
    { onConflict: "slug" },
  );

  if (upsertError) {
    await storage.remove([storagePath]);
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not save the diary entry.")}`, 303);
  }

  if (
    existingPost?.storage_path
    && existingPost.storage_path !== storagePath
    && isOwnedStoragePath(existingPost.storage_path, user.id)
  ) {
    await storage.remove([existingPost.storage_path]).catch(() => undefined);
  }

  return json({ ok: true, slug });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
