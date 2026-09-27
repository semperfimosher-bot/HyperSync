import {
  apiRequest,
} from "./api/client.js";


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

  return apiRequest(
    `/search?${params.toString()}`,
    {
      signal:
        options.signal,
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
    });

  return apiRequest(
    `/on-demand/search?${params.toString()}`,
    {
      signal:
        options.signal,
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
