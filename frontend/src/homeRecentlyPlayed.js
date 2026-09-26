export function getHomeRecentlyPlayed(
  profile,
) {
  return Array.isArray(
    profile?.recently_played,
  )
    ? profile.recently_played
    : [];
}
