import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAllowedImageType, MAX_PHOTO_BYTES } from "./files";

// 浏览器端直传：先向后端要一个签名上传 token，再把图片字节直接传到 Supabase
// Storage，绕过 Vercel serverless function 4.5MB 的请求体限制。

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const el = document.getElementById("supabaseConfig");
  const cfg = JSON.parse(el?.textContent || "{}");
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Missing Supabase config on page.");
  }
  cachedClient = createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

export interface UploadedPhoto {
  path: string;
  mime_type: string;
}

// 把单个图片文件直传到 photos bucket，返回存储路径，供后续写库使用。
export async function uploadImageFile(file: File): Promise<UploadedPhoto> {
  if (!isAllowedImageType(file.type)) {
    throw new Error("Only image files can be uploaded.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photos must be 50 MB or smaller.");
  }

  const signRes = await fetch("/api/photos/sign-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
  });

  if (!signRes.ok) {
    const data = await signRes.json().catch(() => ({}));
    throw new Error(data.error || "Could not start the upload.");
  }

  const { path, token } = await signRes.json();

  const { error } = await getClient()
    .storage.from("photos")
    .uploadToSignedUrl(path, token, file, { contentType: file.type });

  if (error) {
    throw new Error(error.message || "Upload to storage failed.");
  }

  return { path, mime_type: file.type };
}
