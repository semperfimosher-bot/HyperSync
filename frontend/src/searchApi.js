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



export function searchOnDemandMusic(
  query,
  options = {},
) {
  const params =
    new URLSearchParams({
      q:
        query,
      limit:
        "100",
    });

  return apiRequest(
    `/on-demand/search?${params.toString()}`,
    {
      signal:
        options.signal,
    },
  );
}


export function searchOnDemandArtistMusic(
  artistName,
  options = {},
) {
  const requestedLimit =
    Math.max(
      1,
      Math.min(
        100,
        Number.isFinite(
          Number(
            options.limit,
          ),
        )
          ? Math.floor(
              Number(
                options.limit,
              ),
            )
          : 100,
      ),
    );

  const params =
    new URLSearchParams({
      name:
        artistName,
      limit:
        String(
          requestedLimit,
        ),
    });

  return apiRequest(
    `/on-demand/artist?${params.toString()}`,
    {
      signal:
        options.signal,
    },
  );
}


export function warmOnDemandTracks(
  candidateKeys,
) {
  const keys =
    Array.from(
      new Set(
        (
          Array.isArray(
            candidateKeys,
          )
            ? candidateKeys
            : []
        )
          .map(
            (key) =>
              String(
                key ?? "",
              ).trim(),
          )
          .filter(
            Boolean,
          ),
      ),
    )
      .slice(
        0,
        500,
      );

  if (!keys.length) {
    return Promise.resolve({
      warmed:
        0,
      sessions:
        [],
    });
  }

  return apiRequest(
    "/on-demand/warm",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          candidate_keys:
            keys,
        }),
    },
  );
}


export function queueOnDemandTrack(
  candidateKey,
) {
  return apiRequest(
    "/on-demand/queue",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          candidate_key:
            candidateKey,
        }),
    },
  );
}


export function prepareOnDemandTrack(
  candidateKey,
) {
  return apiRequest(
    "/on-demand/prepare",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          candidate_key:
            candidateKey,
        }),
    },
  );
}


export function getOnDemandStatus(
  provisionId,
) {
  return apiRequest(
    `/on-demand/${encodeURIComponent(
      provisionId,
    )}/status`,
  );
}
