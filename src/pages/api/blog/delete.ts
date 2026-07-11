import type { APIRoute } from "astro";
import { isOwnedStoragePath } from "../../../lib/files";
import { safeLocalRedirect } from "../../../lib/redirect";
import { isUuid } from "../../../lib/security";
import { createLocalsClient, createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "");
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/blog");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!isUuid(id)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Missing post ID")}`, 303);
  }

  const supabase = createLocalsClient(locals);
  const { data: post, error: readError } = await supabase
    .from("blog_posts")
    .select("id,storage_path")
    .eq("id", id)
    .eq("author_id", user.id)
    .maybeSingle();

  if (readError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not verify the diary entry.")}`, 303);
  }

  if (!post) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Post not found, or it does not belong to the current account")}`, 303);
  }

  const storage = createServiceClient().storage.from("blog-markdown");
  if (post.storage_path && isOwnedStoragePath(post.storage_path, user.id)) {
    const { error: storageError } = await storage.remove([post.storage_path]);
    if (storageError && !/not found/i.test(storageError.message)) {
      return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not remove the encrypted diary file.")}`, 303);
    }
  }

  const { error: deleteError } = await supabase
    .from("blog_posts")
    .delete()
    .eq("id", id)
    .eq("author_id", user.id);

  if (deleteError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not delete the diary entry.")}`, 303);
  }

  return redirect(`${safeReturn}${sep}deleted=post`, 303);
};
