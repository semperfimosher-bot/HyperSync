export function getHomeRecentlyPlayed(
  profile,
  limit = 6,
) {
  const tracks =
    Array.isArray(
      profile?.recently_played,
    )
      ? profile.recently_played
      : [];

  return tracks.slice(
    0,
    limit,
  );
}
