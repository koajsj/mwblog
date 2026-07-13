import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/local-store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function read(store: ReturnType<typeof createServiceClient>, table: string, selection: string) {
  const { data, error } = await store.from(table).select(selection);
  if (error) throw new Error(`Could not read ${table}.`);
  return data || [];
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: "Please log in." }, 401);

  try {
    const store = createServiceClient();
    const [profiles, posts, records, photos, activities, places, comments, todos] = await Promise.all([
      read(store, "profiles", "id,author_key,display_name,mood_text,mood_date,doing_text,doing_date"),
      read(store, "blog_posts", "id,title,excerpt,content_markdown,tags,author_id,published_at,created_at,updated_at"),
      read(store, "life_records", "id,owner_id,record_on,mood,body,created_at,updated_at"),
      read(store, "photos", "id,owner_id,title,caption,taken_on,mime_type,created_at"),
      read(store, "activity_entries", "id,owner_id,activity_on,period,category,minutes,body,start_time,end_time,created_at,updated_at"),
      read(store, "places", "id,owner_id,name,note,tone,created_at,updated_at"),
      read(store, "comments", "id,target_type,target_id,author_id,body,created_at"),
      read(store, "todos", "id,owner_id,title,due_on,completed,completed_on,completed_start_time,completed_end_time,completed_minutes,archived_at,created_at,updated_at"),
    ]);

    return json({
      version: 1,
      exported_at: new Date().toISOString(),
      profiles,
      posts,
      records,
      photos: photos.map((photo: Record<string, unknown>) => ({
        ...photo,
        file_url: `/api/photos/file?id=${encodeURIComponent(String(photo.id || ""))}`,
      })),
      activities,
      places,
      comments,
      todos,
    });
  } catch (error) {
    console.error("Readable export snapshot failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not prepare the export." }, 500);
  }
};
