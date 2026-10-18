import {
  apiRequest,
} from "./api/client.js";

import {
  getAccessToken,
  readCachedUserProfile,
} from "./api/storage.js";


const SEARCH_CACHE_TTL_MS =
  10_000;

const SEARCH_CACHE_MAX_ENTRIES =
  100;

const searchCache =
  new Map();

const inFlightSearches =
  new Map();


function getSearchCacheScopeKey() {
  const token =
    getAccessToken();

  if (token) {
    return "token:" + token;
  }

  const profile =
    readCachedUserProfile();

  if (
    profile?.id !== null &&
    profile?.id !== undefined &&
    String(profile.id).trim()
  ) {
    return "user:" + String(profile.id);
  }

  if (
    typeof profile?.username === "string" &&
    profile.username.trim()
  ) {
    return "username:" +
      profile.username.trim().toLocaleLowerCase();
  }

  return "anonymous";
}


function getCachedSearch(
  cacheKey,
  now = Date.now(),
) {
  const cached =
    searchCache.get(
      cacheKey,
    );

  if (!cached) {
    return null;
  }

  if (
    now - cached.savedAt >
    SEARCH_CACHE_TTL_MS
  ) {
    searchCache.delete(
      cacheKey,
    );

    return null;
  }

  /*
   * Map insertion order doubles as a small LRU list. Touching a hit moves it
   * to the end so frequently used queries survive a burst of unique searches.
   */
  searchCache.delete(
    cacheKey,
  );

  searchCache.set(
    cacheKey,
    cached,
  );

  return cached;
}


function cacheSearchResult(
  cacheKey,
  value,
  now = Date.now(),
) {
  searchCache.delete(
    cacheKey,
  );

  searchCache.set(
    cacheKey,
    {
      savedAt: now,
      value,
    },
  );

  for (
    const [
      key,
      cached,
    ]
    of searchCache
  ) {
    if (
      now - cached.savedAt >
      SEARCH_CACHE_TTL_MS
    ) {
      searchCache.delete(
        key,
      );
    }
  }

  while (
    searchCache.size >
    SEARCH_CACHE_MAX_ENTRIES
  ) {
    const oldestKey =
      searchCache.keys().next().value;

    if (oldestKey === undefined) {
      break;
    }

    searchCache.delete(
      oldestKey,
    );
  }
}


function createSearchAbortError() {
  const error =
    new Error(
      "Search request was aborted.",
    );

  error.name =
    "AbortError";

  return error;
}


function waitForSharedSearch(
  entry,
  signal,
) {
  if (signal?.aborted) {
    return Promise.reject(
      createSearchAbortError(),
    );
  }

  entry.waiterCount += 1;

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled = false;

      const release = () => {
        if (settled) {
          return false;
        }

        settled = true;

        signal?.removeEventListener(
          "abort",
          handleAbort,
        );

        entry.waiterCount =
          Math.max(
            entry.waiterCount - 1,
            0,
          );

        if (
          entry.waiterCount === 0 &&
          !entry.settled
        ) {
          if (
            inFlightSearches.get(
              entry.cacheKey,
            ) === entry
          ) {
            inFlightSearches.delete(
              entry.cacheKey,
            );
          }

          entry.controller.abort();
        }

        return true;
      };

      const handleAbort = () => {
        if (release()) {
          reject(
            createSearchAbortError(),
          );
        }
      };

      signal?.addEventListener(
        "abort",
        handleAbort,
        {
          once: true,
        },
      );

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      entry.promise.then(
        (value) => {
          if (release()) {
            resolve(value);
          }
        },
        (error) => {
          if (release()) {
            reject(error);
          }
        },
      );
    },
  );
}


export const SEARCH_SORT_OPTIONS = [
  {
    value: "smart",
    label: "Smart Sort",
  },
  {
    value: "recent",
    label: "Recents",
  },
  {
    value: "albums",
    label: "Albums",
  },
  {
    value: "alphabetical",
    label: "Alphabetical Order",
  },
];


export function searchHypersync(
  query,
  sortMode,
  options = {},
) {
  if (
    options.signal?.aborted
  ) {
    return Promise.reject(
      createSearchAbortError(),
    );
  }

  const params =
    new URLSearchParams({
      q: query,
      sort: sortMode,
    });

  const scopeKey =
    getSearchCacheScopeKey();

  const cacheKey =
    scopeKey +
    "|" +
    params.toString();

  const url =
    `/search?${params.toString()}`;

  if (
    !options.bypassCache
  ) {
    const cached =
      getCachedSearch(
        cacheKey,
      );

    if (cached) {
      return Promise.resolve(
        cached.value,
      );
    }
  }

  /*
   * Quiet refresh deliberately skips both the completed-result cache read and
   * in-flight sharing: it requests a fresh result and may refresh the cache
   * when its owner is still active.
   */
  if (
    options.bypassCache
  ) {
    return apiRequest(
      url,
      {
        signal:
          options.signal,
      },
    ).then(
      (value) => {
        if (
          !options.signal?.aborted
        ) {
          cacheSearchResult(
            cacheKey,
            value,
          );
        }

        return value;
      },
    );
  }

  let entry =
    inFlightSearches.get(
      cacheKey,
    );

  if (!entry) {
    const controller =
      new AbortController();

    entry = {
      cacheKey,
      controller,
      waiterCount: 0,
      settled: false,
      promise: null,
    };

    entry.promise =
      apiRequest(
        url,
        {
          signal:
            controller.signal,
        },
      )
        .then(
          (value) => {
            if (
              !controller.signal.aborted
            ) {
              cacheSearchResult(
                cacheKey,
                value,
              );
            }

            return value;
          },
        )
        .finally(
          () => {
            entry.settled = true;

            if (
              inFlightSearches.get(
                cacheKey,
              ) === entry
            ) {
              inFlightSearches.delete(
                cacheKey,
              );
            }
          },
        );

    inFlightSearches.set(
      cacheKey,
      entry,
    );
  }

  return waitForSharedSearch(
    entry,
    options.signal,
  );
}


export function getSearchPreferences() {
  return apiRequest(
    "/search/preferences",
  );
}


export function saveSearchPreferences(
  sortMode,
) {
  return apiRequest(
    "/search/preferences",
    {
      method: "PATCH",

      body: JSON.stringify({
        sort_mode: sortMode,
      }),
    },
  );
}
