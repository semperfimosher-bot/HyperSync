import {
  apiRequest,
} from "./api/client.js";


const SEARCH_CACHE_TTL_MS =
  10_000;

const searchCache =
  new Map();


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
  const params =
    new URLSearchParams({
      q: query,
      sort: sortMode,
    });

  const cacheKey =
    params.toString();

  if (!options.bypassCache) {
    const cached =
      searchCache.get(
        cacheKey,
      );

    if (
      cached &&
      Date.now() -
        cached.savedAt <=
        SEARCH_CACHE_TTL_MS
    ) {
      return Promise.resolve(
        cached.value,
      );
    }
  }

  return apiRequest(
    `/search?${params.toString()}`,
    {
      signal:
        options.signal,
    },
  ).then(
    (value) => {
      if (
        !options.signal
          ?.aborted
      ) {
        searchCache.set(
          cacheKey,
          {
            savedAt:
              Date.now(),
            value,
          },
        );
      }

      return value;
    },
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
