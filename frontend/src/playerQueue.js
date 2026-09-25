export function buildTrackQueue(
  tracks = [],
) {
  if (!Array.isArray(tracks)) {
    return [];
  }

  return tracks
    .filter(
      (track) =>
        track &&
        track.id !== null &&
        track.id !== undefined &&
        String(track.id).trim() !== "",
    )
    .map((track) => ({
      id:
        String(track.id),

      meta: {
        audioUrl:
          track.audioUrl ??
          track.audio_url ??
          null,

        artworkUrl:
          track.artworkUrl ??
          track.artwork_url ??
          null,

        mimeType:
          track.mimeType ??
          track.mime_type ??
          null,

        fileSize:
          track.fileSize ??
          track.file_size ??
          null,

        mediaVersion:
          track.mediaVersion ??
          track.media_version ??
          null,

        artworkVersion:
          track.artworkVersion ??
          track.artwork_version ??
          null,

        durationSeconds:
          track.durationSeconds ??
          track.duration_seconds ??
          null,

        title:
          track.title ??
          "",

        artist:
          track.artist ??
          "",

        album:
          track.album ??
          "",
      },
    }));
}


export function insertQueueEntryAsNext(
  queue,
  currentIndex,
  entry,
) {
  const source =
    Array.isArray(queue)
      ? queue
      : [];

  if (!entry?.id) {
    return source;
  }

  const safeCurrentIndex =
    Number.isInteger(
      currentIndex,
    )
      ? Math.min(
          Math.max(
            currentIndex,
            -1,
          ),
          source.length - 1,
        )
      : -1;

  const currentAndPast =
    source.slice(
      0,
      safeCurrentIndex + 1,
    );

  const upcoming =
    source
      .slice(
        safeCurrentIndex + 1,
      )
      .filter(
        (item) =>
          String(
            item?.id ?? "",
          ) !==
          String(
            entry.id,
          ),
      );

  return [
    ...currentAndPast,
    entry,
    ...upcoming,
  ];
}


export function getNextQueueIndex(
  queue,
  currentIndex,
) {
  if (
    !Array.isArray(queue) ||
    queue.length === 0
  ) {
    return -1;
  }

  const nextIndex =
    currentIndex + 1;

  if (
    nextIndex < 0 ||
    nextIndex >= queue.length
  ) {
    return -1;
  }

  return nextIndex;
}

export function getUpcomingQueueEntries(
  queue,
  currentIndex,
) {
  if (
    !Array.isArray(queue) ||
    queue.length === 0
  ) {
    return [];
  }

  const startIndex =
    Number.isInteger(
      currentIndex,
    )
      ? Math.max(
          currentIndex + 1,
          0,
        )
      : 0;

  if (
    startIndex >=
    queue.length
  ) {
    return [];
  }

  return queue
    .slice(startIndex)
    .map(
      (
        track,
        offset,
      ) => ({
        queueIndex:
          startIndex +
          offset,

        track,
      }),
    );
}


export function getQueueTrackAtIndex(
  queue,
  index,
) {
  if (
    !Array.isArray(queue) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= queue.length
  ) {
    return null;
  }

  return queue[index];
}

export function getTrackAudioSource(
  trackId,
  meta = {},
  options = {},
) {
  const mediaVersion =
    meta.mediaVersion ??
    meta.media_version ??
    null;

  const normalizedTrackId =
    trackId === null ||
    trackId === undefined
      ? ""
      : String(
          trackId,
        ).trim();

  const normalizedMediaVersion =
    mediaVersion === null ||
    mediaVersion === undefined
      ? ""
      : String(
          mediaVersion,
        ).trim();

  if (
    options.useStableMediaRoute ===
      true &&
    normalizedTrackId &&
    normalizedMediaVersion
  ) {
    return (
      "/__hypersync/media/" +
      encodeURIComponent(
        normalizedTrackId,
      ) +
      "/" +
      encodeURIComponent(
        normalizedMediaVersion,
      )
    );
  }

  const directUrl =
    meta.audioUrl ??
    meta.audio_url ??
    null;

  if (directUrl) {
    return directUrl;
  }

  return (
    `/api/audio/${trackId}`
  );
}
