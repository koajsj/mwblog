import type { APIRoute } from "astro";
import { clientIpFromRequest } from "../../../lib/security";

type CachedWeather = {
  expiresAt: number;
  payload: { location: string; weather: string };
};

const cache = new Map<string, CachedWeather>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const CACHE_LIMIT = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "private, max-age=600" : "no-store",
    },
  });
}

function weatherLabel(code: number) {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Weather changing";
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "OurNest/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function remember(ip: string, payload: CachedWeather["payload"]) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(ip, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
}

export const GET: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: "unauthorized" }, 401);
  if (String(process.env.ENABLE_IP_WEATHER || import.meta.env.ENABLE_IP_WEATHER || "") !== "1") {
    return json({ ok: false, error: "IP weather is disabled for privacy." }, 503);
  }

  const ip = clientIpFromRequest(request);
  if (!ip || ip === "unknown") return json({ ok: false, error: "location unavailable" }, 503);

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return json({ ok: true, ...cached.payload });
  }

  try {
    const geo = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`) as {
      success?: boolean;
      city?: string;
      region?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    };
    if (geo.success === false || typeof geo.latitude !== "number" || typeof geo.longitude !== "number") {
      throw new Error("IP location unavailable");
    }

    const weather = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}`
      + "&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=celsius",
    ) as {
      current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
    };
    const current = weather.current;
    if (!current || typeof current.temperature_2m !== "number" || typeof current.weather_code !== "number") {
      throw new Error("weather unavailable");
    }

    const location = [geo.city, geo.region, geo.country].filter(Boolean).slice(0, 2).join(", ") || "Your area";
    const payload = {
      location,
      weather: `${location} · ${weatherLabel(Number(current.weather_code))} ${Math.round(Number(current.temperature_2m))}°C`,
    };
    remember(ip, payload);
    return json({ ok: true, ...payload });
  } catch {
    return json({ ok: false, error: "weather temporarily unavailable" }, 503);
  }
};
