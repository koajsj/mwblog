import { isAllowedImageType, MAX_PHOTO_BYTES } from "./files";

export interface UploadedPhoto {
  path: string;
  mime_type: string;
}

// 把单个图片文件交给后端加密后上传到 photos bucket，返回存储路径，供后续写库使用。
export async function uploadImageFile(file: File): Promise<UploadedPhoto> {
  if (!isAllowedImageType(file.type)) {
    throw new Error("Only image files can be uploaded.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photos must be 50 MB or smaller.");
  }

  const form = new FormData();
  form.set("photo", file);

  const uploadRes = await fetch("/api/photos/sign-upload", {
    method: "POST",
    body: form,
  });

  if (!uploadRes.ok) {
    const data = await uploadRes.json().catch(() => ({}));
    throw new Error(data.error || "Could not start the upload.");
  }

  return uploadRes.json();
}
