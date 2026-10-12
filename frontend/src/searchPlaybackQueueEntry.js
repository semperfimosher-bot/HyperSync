import { resolveArtworkUrl } from "./artworkUrl.js";

export function searchPlaybackQueueEntry(
  track,
  overrides = {},
) {
  return {
    id:
      overrides.id ??
      track?.id,

    audioUrl:
      overrides.audioUrl ??
      track?.audio_url ??
      track?.audioUrl ??
      null,

    artworkUrl:
      resolveArtworkUrl(
        track?.artwork_url ??
        track?.artworkUrl ??
        null,
      ),

    mimeType:
      track?.mime_type ??
      track?.mimeType ??
      null,

    fileSize:
      track?.file_size ??
      track?.fileSize ??
      null,

    mediaVersion:
      track?.media_version ??
      track?.mediaVersion ??
      null,

    title:
      track?.title ??
      "",

    artist:
      track?.artist ??
      "",

    album:
      track?.album ??
      "",

    genre:
      track?.genre ??
      "",

    releaseYear:
      track?.release_year ??
      track?.releaseYear ??
      null,

    durationSeconds:
      track?.duration_seconds ??
      track?.durationSeconds ??
      null,

    catalogTrackId:
      overrides.catalogTrackId ??
      track?.catalog_track_id ??
      track?.catalogTrackId ??
      null,
  };
}
