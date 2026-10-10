export function totalSearchResultCount(counts) {
  return (
    Number(counts?.tracks || 0) +
    Number(counts?.artists || 0) +
    Number(counts?.collaborations || 0) +
    Number(counts?.albums || 0) +
    Number(counts?.people || 0) +
    Number(counts?.playlists || 0)
  );
}

export function searchFilterCount(filter, counts) {
  if (filter === "all") {
    return totalSearchResultCount(counts);
  }

  return Number(counts?.[filter] || 0);
}
