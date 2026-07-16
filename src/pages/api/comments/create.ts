import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { readEncryptedText } from "../../../lib/private-payload";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/local-store";

function savedDraftKey(value: FormDataEntryValue | null) {
  const key = String(value || "").trim();
  return /^(record|blog)-comment-[0-9a-f-]{36}$/i.test(key) ? key : "";
}

function appendDraftSaved(path: string, key: string) {
  if (!key) return path;
  const hashIndex = path.indexOf("#");
  const base = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}draft_saved=${encodeURIComponent(key)}${hash}`;
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const targetType = String(form.get("target_type") || "").trim();
  const targetId = String(form.get("target_id") || "").trim();
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/");
  const draftKey = savedDraftKey(form.get("draft_key"));
  const errorRedirect = (msg: string) => {
    const sep = safeReturn.includes("?") ? "&" : "?";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(msg)}`, 303);
  };
  let body = "";
  try {
    body = readEncryptedText(form.get("body"), { maxLength: 4096, context: "comment.body" });
  } catch (error) {
    return errorRedirect(error instanceof Error ? error.message : "Invalid encrypted comment.");
  }

  if (targetType !== "blog" && targetType !== "record") {
    return errorRedirect("Invalid comment target.");
  }
  if (!isUuid(targetId)) {
    return errorRedirect("Missing comment target id.");
  }
  if (!body) {
    return errorRedirect("Comment must be between 1 and 500 characters.");
  }

  const store = createLocalsClient(locals);
  const targetQuery = targetType === "blog"
    ? store.from("blog_posts").select("id").eq("id", targetId)
    : store.from("life_records").select("id").eq("id", targetId);
  const { data: target, error: targetError } = await targetQuery.maybeSingle();
  if (targetError) return errorRedirect("Could not verify the comment target.");
  if (!target) return errorRedirect("Comment target not found.");

  const { error } = await store.from("comments").insert({
    target_type: targetType,
    target_id: targetId,
    author_id: user.id,
    body,
  });
  if (error) return errorRedirect("Could not save the comment.");

  if (draftKey) {
    await store.from("private_drafts").delete().eq("owner_id", user.id).eq("draft_key", draftKey);
  }

  // 评论提交后回到原页面，并加上锚点滚到对应区域
  const anchor = targetType === "record" ? `#rc-${targetId}` : "#comments";
  return redirect(`${appendDraftSaved(safeReturn, draftKey)}${anchor}`, 303);
};
