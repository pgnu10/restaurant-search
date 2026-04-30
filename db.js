import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

let supabase = null;

export function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

export async function logSearch(entry) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("search_logs").insert(entry);
}

const MENU_FRESH_MS = 3 * 86400000;
const MENU_STALE_MS = 14 * 86400000;

export async function getCachedMenus(placeId) {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("menus")
    .select("menus, fetched_at")
    .eq("place_id", placeId)
    .single();

  if (error || !data) return null;

  const age = Date.now() - new Date(data.fetched_at).getTime();
  if (age > MENU_STALE_MS) return { menus: data.menus, status: "expired" };
  if (age > MENU_FRESH_MS) return { menus: data.menus, status: "stale" };
  return { menus: data.menus, status: "fresh" };
}

export async function setCachedMenus(placeId, menus) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("menus").upsert({
    place_id: placeId,
    menus,
    fetched_at: new Date().toISOString(),
  });
}

const SEARCH_TTL_MS = 86400000;

function searchCacheKey(location, keyword, bounds) {
  const raw = JSON.stringify({ location, keyword, bounds: bounds || null });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export async function getCachedSearch(location, keyword, bounds) {
  const sb = getSupabase();
  if (!sb) return null;

  const id = searchCacheKey(location, keyword, bounds);
  const { data, error } = await sb
    .from("search_cache")
    .select("response, cached_at")
    .eq("id", id)
    .single();

  if (error || !data) return null;

  const age = Date.now() - new Date(data.cached_at).getTime();
  if (age > SEARCH_TTL_MS) return null;
  return data.response;
}

export async function setCachedSearch(location, keyword, bounds, response) {
  const sb = getSupabase();
  if (!sb) return;

  const id = searchCacheKey(location, keyword, bounds);
  await sb.from("search_cache").upsert({
    id,
    location,
    keyword,
    bounds: bounds || null,
    response,
    cached_at: new Date().toISOString(),
  });
}
