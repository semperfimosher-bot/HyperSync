export const MUSIC_SHARE_REQUEST_EVENT =
  "hypersync:share-music";


export function normalizeSharedMusicItem(
  item,
) {
  const kind =
    String(
      item?.kind ??
      "",
    ).trim();

  if (
    ![
      "track",
      "album",
      "artist",
      "playlist",
    ].includes(
      kind,
    )
  ) {
    return null;
  }

  const key =
    String(
      item?.key ??
      item?.id ??
      "",
    ).trim();

  const title =
    String(
      item?.title ??
      item?.name ??
      "",
    ).trim();

  if (
    !key ||
    !title
  ) {
    return null;
  }

  const subtitle =
    String(
      item?.subtitle ??
      item?.artist ??
      "",
    ).trim();

  const artworkUrl =
    String(
      item?.artwork_url ??
      item?.artworkUrl ??
      "",
    ).trim();

  return {
    kind,
    key,
    title,
    subtitle:
      subtitle ||
      null,
    artwork_url:
      artworkUrl ||
      null,
  };
}


export function requestMusicShare(
  item,
) {
  const normalized =
    normalizeSharedMusicItem(
      item,
    );

  if (
    !normalized ||
    typeof window ===
      "undefined"
  ) {
    return false;
  }

  window.dispatchEvent(
    new CustomEvent(
      MUSIC_SHARE_REQUEST_EVENT,
      {
        detail:
          normalized,
      },
    ),
  );

  return true;
}


export function trackShareItem(
  track,
) {
  return normalizeSharedMusicItem({
    kind:
      "track",
    key:
      track?.id,
    title:
      track?.title,
    subtitle:
      [
        track?.artist,
        track?.album,
      ]
        .filter(Boolean)
        .join(
          " • ",
        ),
    artwork_url:
      track?.artwork_url ??
      track?.artworkUrl ??
      null,
  });
}
