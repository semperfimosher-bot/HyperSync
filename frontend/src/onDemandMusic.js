export const ON_DEMAND_TRACK_PREFIX =
  "ondemand:";


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
  };
}
