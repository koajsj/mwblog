import type { APIRoute } from "astro";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/supabase";

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response("Please log in.", { status: 401 });
  }

  const id = url.searchParams.get("id") || "";
  if (!isUuid(id)) {
    return new Response("Missing photo id.", { status: 400 });
  }

  const supabase = createLocalsClient(locals);
  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("id,storage_path,mime_type")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return new Response("Could not load the photo metadata.", { status: 500 });
  }
  if (!photo?.storage_path) {
    return new Response("Photo not found.", { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase.storage.from("photos").download(photo.storage_path);
  if (downloadError || !file) {
    return new Response("Photo file not found.", { status: 404 });
  }

  return new Response(await file.arrayBuffer(), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
