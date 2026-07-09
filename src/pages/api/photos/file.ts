import type { APIRoute } from "astro";
import { decryptPrivateFile } from "../../../lib/private-files";
import { createServiceClient } from "../../../lib/supabase";

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response("Please log in.", { status: 401 });
  }

  const id = url.searchParams.get("id") || "";
  if (!id) {
    return new Response("Missing photo id.", { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("id,storage_path,mime_type")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return new Response(readError.message, { status: 500 });
  }
  if (!photo?.storage_path) {
    return new Response("Photo not found.", { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase.storage.from("photos").download(photo.storage_path);
  if (downloadError || !file) {
    return new Response(downloadError?.message || "Photo file not found.", { status: 404 });
  }

  try {
    const { buffer, mimeType } = decryptPrivateFile(Buffer.from(await file.arrayBuffer()), photo.mime_type || file.type);
    return new Response(buffer, {
      headers: {
        "content-type": mimeType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not decrypt photo.";
    return new Response(message, { status: 500 });
  }
};
