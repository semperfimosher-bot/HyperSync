const TYPE_PRIORITY = {
  track: 50,
  artist: 40,
  album: 30,
  person: 20,
  collaboration: 10,
};


const TYPE_LABEL = {
  track: "TRACK",
  artist: "ARTIST",
  album: "ALBUM",
  person: "PERSON",
  collaboration: "COLLABORATION",
};


const FALLBACK_LABEL_SCORE = {
  "EXACT MATCH": 900,
  "STRONG MATCH": 700,
  MATCH: 500,
  "CLOSE MATCH": 300,
  PERSONALIZED: 200,
  COLLABORATION: 150,
};


function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLocaleLowerCase()
    .replace(
      /^@+/,
      "",
    )
    .replace(
      /['’]/g,
      "",
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    )
    .trim()
    .replace(
      /\s+/g,
      " ",
    );
}


function similarityScore(
  left,
  right,
) {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const previous =
    Array.from(
      {
        length:
          b.length + 1,
      },
      (_, index) => index,
    );

  for (
    let row = 1;
    row <= a.length;
    row += 1
  ) {
    let diagonal =
      previous[0];

    previous[0] = row;

    for (
      let column = 1;
      column <= b.length;
      column += 1
    ) {
      const above =
        previous[column];

      const cost =
        a[row - 1] ===
        b[column - 1]
          ? 0
          : 1;

      previous[column] =
        Math.min(
          previous[column] + 1,
          previous[column - 1] + 1,
          diagonal + cost,
        );

      diagonal = above;
    }
  }

  const distance =
    previous[b.length];

  const longest =
    Math.max(
      a.length,
      b.length,
    );

  return Math.max(
    0,
    1 - distance / longest,
  );
}


function scoreIdentity(
  value,
  query,
) {
  const normalizedValue =
    normalizeText(value);

  const normalizedQuery =
    normalizeText(query);

  if (
    !normalizedValue ||
    !normalizedQuery
  ) {
    return {
      score: 0,
      label: "",
    };
  }

  if (
    normalizedValue ===
    normalizedQuery
  ) {
    return {
      score: 5000,
      label: "EXACT MATCH",
    };
  }

  if (
    normalizedValue.startsWith(
      normalizedQuery,
    )
  ) {
    return {
      score: 4000,
      label: "STRONG MATCH",
    };
  }

  if (
    normalizedValue.includes(
      normalizedQuery,
    )
  ) {
    return {
      score: 3000,
      label: "MATCH",
    };
  }

  /*
   * Very short fuzzy queries
   * create too many false matches.
   */
  if (
    normalizedQuery.length < 3
  ) {
    return {
      score: 0,
      label: "",
    };
  }

  const similarity =
    similarityScore(
      normalizedValue,
      normalizedQuery,
    );

  if (similarity >= 0.72) {
    return {
      score:
        1200 +
        Math.round(
          similarity * 800,
        ),
      label: "CLOSE MATCH",
    };
  }

  return {
    score: 0,
    label: "",
  };
}


function fallbackScore(
  label,
) {
  return (
    FALLBACK_LABEL_SCORE[
      String(
        label || "",
      ).toUpperCase()
    ] || 0
  );
}


function matchingTracksText(
  count,
) {
  const safeCount =
    Number(count || 0);

  return (
    `${safeCount} matching ` +
    `${safeCount === 1
      ? "track"
      : "tracks"}`
  );
}


function makeCandidate({
  type,
  item,
  identity,
  query,
  trackIndex = null,
  peopleIntent = false,
}) {
  const direct =
    scoreIdentity(
      identity,
      query,
    );

  /*
   * Direct identity matching is
   * deliberately much stronger
   * than an item's backend
   * match_label.
   *
   * Example:
   *
   * query = "post malone"
   *
   * Artist "Post Malone"
   * gets a direct exact score.
   *
   * Track "Circles"
   * may have EXACT MATCH because
   * its artist is Post Malone,
   * but its title itself did not
   * directly match the query.
   */
  const baseScore =
    direct.score > 0
      ? direct.score
      : fallbackScore(
          item?.match_label,
        );

  if (baseScore <= 0) {
    return null;
  }

  let score =
    baseScore +
    (
      TYPE_PRIORITY[type] ||
      0
    );

  if (
    peopleIntent &&
    type === "person"
  ) {
    score += 10000;
  }

  let title = "";
  let subtitle = "";
  let artworkUrl = null;
  let avatarUrl = null;
  let actionType = "";
  let actionLabel = "";
  let actionIcon =
    "chevron";

  if (type === "track") {
    title =
      item.title;

    subtitle =
      [
        item.artist,
        item.album,
      ]
        .filter(Boolean)
        .join(" • ");

    artworkUrl =
      item.artwork_url;

    actionType =
      "play";

    actionLabel =
      "PLAY";

    actionIcon =
      "play";
  }

  if (type === "artist") {
    title =
      item.name;

    subtitle =
      matchingTracksText(
        item.track_count,
      );

    artworkUrl =
      item.artwork_url;

    actionType =
      "artist";

    actionLabel =
      "VIEW";
  }

  if (
    type ===
    "collaboration"
  ) {
    title =
      item.name;

    subtitle =
      matchingTracksText(
        item.track_count,
      );

    artworkUrl =
      item.artwork_url;

    actionType =
      "artist";

    actionLabel =
      "VIEW";
  }

  if (type === "album") {
    title =
      item.title;

    subtitle =
      item.artist || "";

    artworkUrl =
      item.artwork_url;

    actionType =
      "album";

    actionLabel =
      "SEARCH";
  }

  if (type === "person") {
    title =
      item.display_name ||
      `@${item.username}`;

    subtitle =
      [
        `@${item.username}`,
        `${Number(
          item.followers_count ||
            0,
        )} followers`,
      ].join(" • ");

    avatarUrl =
      item.avatar_url;

    actionType =
      "person";

    actionLabel =
      "PROFILE";
  }

  const label =
    (
      direct.label ||
      item?.match_label ||
      "MATCH"
    ) +
    ` • ${TYPE_LABEL[type]}`;

  return {
    type,
    item,
    score,
    label,

    title,
    subtitle,

    artworkUrl,
    avatarUrl,

    actionType,
    actionLabel,
    actionIcon,

    trackIndex,
  };
}


export function pickTopSignal(
  results,
) {
  if (!results) {
    return null;
  }

  const query =
    results.interpreted_query ||
    results.query ||
    "";

  const normalizedQuery =
    normalizeText(query);

  /*
   * History commands can have an
   * empty interpreted term.
   *
   * Preserve the old behavior and
   * use the first track.
   */
  if (!normalizedQuery) {
    const firstTrack =
      results.tracks?.[0];

    if (!firstTrack) {
      return null;
    }

    return {
      type: "track",
      item: firstTrack,

      score: 1,

      label:
        (
          firstTrack.match_label ||
          "PERSONALIZED"
        ) +
        " • TRACK",

      title:
        firstTrack.title,

      subtitle:
        [
          firstTrack.artist,
          firstTrack.album,
        ]
          .filter(Boolean)
          .join(" • "),

      artworkUrl:
        firstTrack.artwork_url,

      avatarUrl: null,

      actionType: "play",
      actionLabel: "PLAY",
      actionIcon: "play",

      trackIndex: 0,
    };
  }

  const rawQuery =
    String(
      results.query || "",
    ).trim();

  const peopleIntent =
    results.intent ===
      "people" ||
    rawQuery.startsWith("@");

  const candidates = [];


  (
    results.tracks || []
  ).forEach(
    (
      track,
      trackIndex,
    ) => {
      const candidate =
        makeCandidate({
          type: "track",
          item: track,

          /*
           * IMPORTANT:
           * Track identity is the
           * TITLE, not its artist.
           */
          identity:
            track.title,

          query,

          trackIndex,
          peopleIntent,
        });

      if (candidate) {
        candidates.push(
          candidate,
        );
      }
    },
  );


  (
    results.artists || []
  ).forEach(
    (artist) => {
      const candidate =
        makeCandidate({
          type: "artist",
          item: artist,

          identity:
            artist.name,

          query,
          peopleIntent,
        });

      if (candidate) {
        candidates.push(
          candidate,
        );
      }
    },
  );


  /*
   * Works whether collaborations
   * have already been added to
   * this particular local build
   * or not.
   */
  (
    results.collaborations ||
    []
  ).forEach(
    (collaboration) => {
      const candidate =
        makeCandidate({
          type:
            "collaboration",

          item:
            collaboration,

          identity:
            collaboration.name,

          query,
          peopleIntent,
        });

      if (candidate) {
        candidates.push(
          candidate,
        );
      }
    },
  );


  (
    results.albums || []
  ).forEach(
    (album) => {
      const candidate =
        makeCandidate({
          type: "album",
          item: album,

          identity:
            album.title,

          query,
          peopleIntent,
        });

      if (candidate) {
        candidates.push(
          candidate,
        );
      }
    },
  );


  (
    results.people || []
  ).forEach(
    (person) => {
      const usernameMatch =
        scoreIdentity(
          person.username,
          query,
        );

      const displayMatch =
        scoreIdentity(
          person.display_name,
          query,
        );

      const identity =
        usernameMatch.score >=
        displayMatch.score
          ? person.username
          : person.display_name;

      const candidate =
        makeCandidate({
          type: "person",
          item: person,

          identity,

          query,
          peopleIntent,
        });

      if (candidate) {
        candidates.push(
          candidate,
        );
      }
    },
  );


  if (
    candidates.length === 0
  ) {
    return null;
  }

  candidates.sort(
    (
      left,
      right,
    ) =>
      right.score -
      left.score,
  );

  return candidates[0];
}
