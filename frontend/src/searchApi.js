import {
  apiRequest,
} from "./api/client.js";


export const SEARCH_SORT_OPTIONS = [
  {
    value: "smart",
    label: "Smart / Recommended",
  },
  {
    value: "recent",
    label: "Recently listened",
  },
  {
    value: "alphabetical",
    label: "Alphabetical",
  },
  {
    value: "artist",
    label: "Artist",
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
