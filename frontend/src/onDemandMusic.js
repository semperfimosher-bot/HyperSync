export const ON_DEMAND_TRACK_PREFIX =
  "ondemand:";

export const ON_DEMAND_PLAYLIST_LIMIT =
  500;


export function onDemandTrackId(
  value,
) {
  const key =
    String(
      value ?? "",
    ).trim();

  return (
    key
      ? (
          ON_DEMAND_TRACK_PREFIX +
          key
        )
      : null
  );
}


export function isOnDemandTrackId(
  value,
) {
  return String(
    value ?? "",
  ).startsWith(
    ON_DEMAND_TRACK_PREFIX,
  );
}


export function normalizeOnDemandTrack(
  candidate,
) {
  const provisionKey =
    String(
      candidate?.provision_key ??
      candidate?.key ??
      "",
    ).trim();

  if (!provisionKey) {
    return null;
  }

  const id =
    onDemandTrackId(
      provisionKey,
    );

  return {
    id,
    provision_key:
      provisionKey,
    source_type:
      "on_demand",
    title:
      String(
        candidate?.title ??
        "",
      ),
    artist:
      String(
        candidate?.artist ??
        "",
      ),
    album:
      candidate?.album ??
      null,
    genre:
      candidate?.genre ??
      null,
    release_year:
      candidate?.release_year ??
      null,
    duration_seconds:
      candidate?.duration_seconds ??
      null,
    audio_url:
      null,
    artwork_url:
      candidate?.artwork_url ??
      null,
    mime_type:
      null,
    file_size:
      null,
    media_version:
      null,
    artwork_version:
      null,
    match_label:
      candidate?.match_label ??
      "AVAILABLE ON DEMAND",
    matched_field:
      "external",
    user_play_count:
      0,
    global_play_count:
      0,
    provider:
      candidate?.provider ??
      null,
    confidence:
      candidate?.confidence ??
      null,
    isrc:
      candidate?.isrc ??
      null,
    track_number:
      candidate?.track_number ??
      null,
    disc_number:
      candidate?.disc_number ??
      null,
  };
}


function normalizedWords(
  value,
) {
  return String(
    value ?? "",
  )
    .normalize(
      "NFKC",
    )
    .toLocaleLowerCase()
    .match(
      /[\p{L}\p{N}]+/gu,
    )
    ?.join(
      " ",
    ) ?? "";
}


function primaryArtistCredit(
  value,
) {
  const raw =
    String(
      value ?? "",
    ).trim();

  if (!raw) {
    return "";
  }

  return (
    raw.split(
      /\s+(?:&|and|x|with|feat(?:uring)?\.?|ft\.?)\s+/i,
    )[0]?.trim() ??
    raw
  );
}


export function inferOnDemandArtistName(
  query,
  tracks = [],
) {
  const cleanQuery =
    String(
      query ?? "",
    )
      .trim()
      .replace(
        /^songs\s+by\s+/i,
        "",
      );

  const wanted =
    normalizedWords(
      cleanQuery,
    );

  if (!wanted) {
    return null;
  }

  const exact = new Map();

  for (const track of tracks) {
    const artist =
      primaryArtistCredit(
        track?.artist,
      );

    if (
      normalizedWords(
        artist,
      ) !==
      wanted
    ) {
      continue;
    }

    exact.set(
      normalizedWords(
        artist,
      ),
      artist,
    );
  }

  return (
    exact.size === 1
      ? Array.from(
          exact.values(),
        )[0]
      : null
  );
}


export function buildOnDemandArtistPlaylist({
  artistName,
  catalogTracks = [],
  onDemandTracks = [],
  limit =
    ON_DEMAND_PLAYLIST_LIMIT,
} = {}) {
  const cleanArtist =
    String(
      artistName ?? "",
    ).trim();

  const wanted =
    normalizedWords(
      cleanArtist,
    );

  if (!wanted) {
    return null;
  }

  const cap =
    Math.max(
      1,
      Math.min(
        Number.isFinite(
          Number(limit),
        )
          ? Math.floor(
              Number(limit),
            )
          : ON_DEMAND_PLAYLIST_LIMIT,
        ON_DEMAND_PLAYLIST_LIMIT,
      ),
    );

  const unique = [];
  const seen = new Set();

  for (
    const track
    of [
      ...(
        Array.isArray(
          catalogTracks,
        )
          ? catalogTracks
          : []
      ),
      ...(
        Array.isArray(
          onDemandTracks,
        )
          ? onDemandTracks
          : []
      ),
    ]
  ) {
    if (!track) {
      continue;
    }

    const primary =
      primaryArtistCredit(
        track.artist,
      );

    if (
      normalizedWords(
        primary,
      ) !==
      wanted
    ) {
      continue;
    }

    const identity = [
      wanted,
      normalizedWords(
        track.title,
      ),
    ].join(
      "\u0000",
    );

    if (
      !identity ||
      seen.has(
        identity,
      )
    ) {
      continue;
    }

    seen.add(
      identity,
    );

    unique.push(
      track,
    );

    if (
      unique.length >=
      cap
    ) {
      break;
    }
  }

  if (!unique.length) {
    return null;
  }

  const artworkUrls =
    unique
      .map(
        (track) =>
          track.artwork_url ??
          track.artworkUrl ??
          null,
      )
      .filter(
        Boolean,
      )
      .slice(
        0,
        4,
      );

  return {
    id:
      "ondemand-artist:" +
      encodeURIComponent(
        wanted,
      ),
    title:
      cleanArtist,
    description:
      "Metadata playlist. Tracks are prepared for temporary playback when opened and are only published after you play them.",
    visibility:
      "generated",
    owner_username:
      "HyperSynced",
    track_count:
      unique.length,
    artwork_url:
      artworkUrls[0] ??
      null,
    artwork_urls:
      artworkUrls,
    is_owner:
      false,
    is_saved:
      false,
    generated_kind:
      "artist",
    generated_query:
      cleanArtist,
    transient:
      true,
    source_type:
      "on_demand",
    tracks:
      unique,
  };
}
