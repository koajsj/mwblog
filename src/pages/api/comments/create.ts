import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const targetType = String(form.get("target_type") || "").trim();
  const targetId = String(form.get("target_id") || "").trim();
  const body = String(form.get("body") || "").trim();
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/");
  const errorRedirect = (msg: string) => {
    const sep = safeReturn.includes("?") ? "&" : "?";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(msg)}`, 303);
  };

  if (targetType !== "blog" && targetType !== "record") {
    return errorRedirect("Invalid comment target.");
  }
  if (!targetId) {
    return errorRedirect("Missing comment target id.");
  }
  if (!body || body.length > 500) {
    return errorRedirect("Comment must be between 1 and 500 characters.");
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("comments").insert({
    target_type: targetType,
    target_id: targetId,
    author_id: user.id,
    body,
  });
  if (error) return errorRedirect(error.message);

  // 评论提交后回到原页面，并加上锚点滚到对应区域
  const anchor = targetType === "record" ? `#rc-${targetId}` : "#comments";
  return redirect(`${safeReturn}${anchor}`, 303);
};
