import {
  API_BASE,
} from "./api/client.js";

import {
  clearAllHyperSyncClientData,
} from "./clientDataReset.js";


export const GLOBAL_RESET_GENERATION_KEY =
  "hypersync_global_reset_generation";


function normalizeGeneration(
  value,
) {
  const number =
    Number(
      value,
    );

  if (
    !Number.isSafeInteger(
      number,
    ) ||
    number < 0
  ) {
    return null;
  }

  return number;
}


export function readStoredResetGeneration(
  storage =
    globalThis.localStorage,
) {
  try {
    return normalizeGeneration(
      storage?.getItem?.(
        GLOBAL_RESET_GENERATION_KEY,
      ),
    );
  } catch {
    return null;
  }
}


export function rememberResetGeneration(
  generation,
  storage =
    globalThis.localStorage,
) {
  const normalized =
    normalizeGeneration(
      generation,
    );

  if (
    normalized === null
  ) {
    return false;
  }

  try {
    storage?.setItem?.(
      GLOBAL_RESET_GENERATION_KEY,
      String(
        normalized,
      ),
    );

    return true;
  } catch {
    return false;
  }
}


export async function fetchGlobalResetGeneration({
  fetchLike =
    globalThis.fetch,
} = {}) {
  if (
    typeof fetchLike !==
    "function"
  ) {
    return null;
  }

  const response =
    await fetchLike(
      `${API_BASE}/system/reset-state`,
      {
        method:
          "GET",
        credentials:
          "include",
        cache:
          "no-store",
        headers: {
          Accept:
            "application/json",
        },
      },
    );

  if (!response.ok) {
    return null;
  }

  const payload =
    await response.json();

  return normalizeGeneration(
    payload?.generation,
  );
}


export async function syncGlobalResetState({
  fetchLike =
    globalThis.fetch,
  navigatorLike =
    globalThis.navigator,
  storage =
    globalThis.localStorage,
  clearClientData =
    clearAllHyperSyncClientData,
} = {}) {
  if (
    navigatorLike &&
    navigatorLike.onLine ===
      false
  ) {
    return {
      checked:
        false,
      resetApplied:
        false,
      generation:
        null,
    };
  }

  let generation;

  try {
    generation =
      await fetchGlobalResetGeneration({
        fetchLike,
      });
  } catch {
    generation =
      null;
  }

  if (
    generation === null
  ) {
    return {
      checked:
        false,
      resetApplied:
        false,
      generation:
        null,
    };
  }

  const storedGeneration =
    readStoredResetGeneration(
      storage,
    );

  /*
   * Generation zero is the pre-reset
   * baseline. Store it without clearing
   * a fresh/new client.
   */
  if (
    storedGeneration === null &&
    generation === 0
  ) {
    rememberResetGeneration(
      generation,
      storage,
    );

    return {
      checked:
        true,
      resetApplied:
        false,
      generation,
    };
  }

  const shouldReset =
    storedGeneration === null
      ? generation > 0
      : generation >
        storedGeneration;

  if (!shouldReset) {
    if (
      storedGeneration !==
      generation
    ) {
      rememberResetGeneration(
        generation,
        storage,
      );
    }

    return {
      checked:
        true,
      resetApplied:
        false,
      generation,
    };
  }

  await clearClientData();

  /*
   * clearClientData removes localStorage,
   * so write the acknowledged generation
   * only after the purge completes.
   */
  rememberResetGeneration(
    generation,
    storage,
  );

  return {
    checked:
      true,
    resetApplied:
      true,
    generation,
  };
}
