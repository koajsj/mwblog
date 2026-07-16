import type { APIRoute } from "astro";
import { readBackupHealth } from "../../../lib/backup-status";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: "unauthorized" }, 401);
  return json({ ok: true, backup: await readBackupHealth() });
};
