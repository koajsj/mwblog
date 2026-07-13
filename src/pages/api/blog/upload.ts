import type { APIRoute } from "astro";
import { isOwnedStoragePath, storageSafeName } from "../../../lib/files";
import { ensureStorageBuckets } from "../../../lib/storage";
import { safeLocalRedirect } from "../../../lib/redirect";
import { readEncryptedText } from "../../../lib/private-payload";
import { createLocalsClient, createServiceClient } from "../../../lib/local-store";

function mergeTags(...groups: string[][]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  groups.flat().forEach((tag) => {
    const clean = tag.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    tags.push(clean.slice(0, 4096));
  });
  return tags.slice(0, 12);
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const payload = await request.json().catch(() => null);
  const manualSlug = String(payload?.slug || "").trim().slice(0, 180);
  const rawReturn = String(payload?.return_to || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/blog");
  const sep = safeReturn.includes("?") ? "&" : "?";
  let title = "";
  let excerpt = "";
  let content = "";
  try {
    title = readEncryptedText(payload?.title, { maxLength: 4096, context: "blog.title" });
    excerpt = readEncryptedText(payload?.excerpt, { maxLength: 4096, context: "blog.excerpt" });
    content = readEncryptedText(payload?.content_markdown, { maxLength: 2000000, context: "blog.content" });
  } catch (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid encrypted blog content.")}`, 303);
  }

  let tags: string[] = [];
  try {
    tags = mergeTags(Array.isArray(payload?.tags) ? payload.tags : [])
      .map((tag) => readEncryptedText(tag, { maxLength: 4096, context: "blog.tag" }));
  } catch (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid encrypted tags.")}`, 303);
  }
  // User-supplied slugs remain supported for editing old posts. New posts use
  // an opaque identifier so titles and filenames are not exposed in URLs.
  const requestedSlug = /^[a-z0-9][a-z0-9-]{0,119}$/i.test(manualSlug) ? manualSlug : "";
  const slug = requestedSlug || crypto.randomUUID();
  const store = createLocalsClient(locals);
  const storage = createServiceClient().storage.from("blog-markdown");
  const storageName = storageSafeName(slug, "post");
  const storagePath = `${user.id}/${storageName}-${Date.now()}-${crypto.randomUUID()}.md`;
  const { data: existingPost } = await store
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

  const { error: upsertError } = await store.from("blog_posts").upsert(
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
