const STORAGE_PREFIX = "hypersync:last-view:v1:";

function storageKey(userId) {
  const id = String(userId ?? "").trim();
  return id ? STORAGE_PREFIX + encodeURIComponent(id) : "";
}

export function readPersistedAppView(userId, storage = globalThis.localStorage) {
  const key = storageKey(userId);
  if (!key || !storage?.getItem) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;

    return {
      active_page: value.active_page,
      search_query: typeof value.search_query === "string"
        ? value.search_query.slice(0, 200)
        : "",
      profile_username: typeof value.profile_username === "string"
        ? value.profile_username.slice(0, 100)
        : "",
    };
  } catch {
    return null;
  }
}

export function writePersistedAppView(userId, state, storage = globalThis.localStorage) {
  const key = storageKey(userId);
  if (!key || !storage?.setItem || !state || typeof state !== "object") {
    return false;
  }

  // Persist navigation context only; never store tokens, messages, or private page data.
  const safeState = {
    active_page: typeof state.active_page === "string"
      ? state.active_page
      : "home",
    search_query: typeof state.search_query === "string"
      ? state.search_query.slice(0, 200)
      : "",
    profile_username: typeof state.profile_username === "string"
      ? state.profile_username.slice(0, 100)
      : "",
  };

  try {
    storage.setItem(key, JSON.stringify(safeState));
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedAppView(userId, storage = globalThis.localStorage) {
  const key = storageKey(userId);
  if (!key || !storage?.removeItem) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
