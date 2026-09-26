const SMART_QUERY_WORDS = new Set([
  "chill",
  "relax",
  "relaxed",
  "mellow",
  "calm",
  "evening",
  "night",
  "late",
  "study",
  "focus",
  "sleep",
  "workout",
  "gym",
  "hype",
  "party",
  "driving",
  "road",
  "sad",
  "happy",
  "music",
  "mix",
  "playlist",
  "vibe",
  "vibes",
]);

const GENRE_QUERIES = new Set([
  "country",
  "americana",
  "bluegrass",
  "western",
  "hip hop",
  "hip-hop",
  "rap",
  "trap",
  "r&b",
  "rnb",
  "soul",
  "neo soul",
  "electronic",
  "edm",
  "dance",
  "house",
  "techno",
  "trance",
  "dubstep",
  "ambient",
  "lofi",
  "lo-fi",
  "rock",
  "alternative",
  "indie",
  "metal",
  "metalcore",
  "punk",
  "pop punk",
  "hardcore",
  "pop",
  "dance pop",
  "synthpop",
  "dream pop",
  "funk",
  "disco",
  "latin",
  "reggaeton",
  "bachata",
  "salsa",
  "folk",
  "acoustic",
  "jazz",
  "classical",
  "orchestral",
  "instrumental",
  "gospel",
  "christian",
  "worship",
]);

const SEARCH_COMMANDS = [
  /^songs?\s+by\s+/i,
  /^albums?\s+by\s+/i,
  /^(?:recent|recently\s+played)\s+songs?/i,
  /^my\s+most\s+played/i,
  /^(?:my\s+)?top\s+(?:artists?|albums?)$/i,
  /^(?:find\s+)?(?:people|users?|person)(?:\s|$)/i,
  /^@[^\s]+$/i,
  /^(?:new\s+releases?|new\s+music)$/i,
];

export function looksLikeSmartPlaylistQuery(
  query,
) {
  const normalized =
    String(
      query ?? "",
    )
      .trim()
      .replace(
        /\s+/g,
        " ",
      )
      .toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    SEARCH_COMMANDS.some(
      (pattern) =>
        pattern.test(
          normalized,
        ),
    )
  ) {
    return false;
  }

  const withoutSuffix =
    normalized
      .replace(
        /\s+(?:music|songs?|mix|playlist|vibes?)$/i,
        "",
      )
      .trim();

  if (
    GENRE_QUERIES.has(
      normalized,
    )
    || GENRE_QUERIES.has(
      withoutSuffix,
    )
  ) {
    return true;
  }

  return normalized
    .split(
      /\s+/,
    )
    .some(
      (word) =>
        SMART_QUERY_WORDS.has(
          word,
        ),
    );
}
