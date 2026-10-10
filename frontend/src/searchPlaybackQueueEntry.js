import { resolveArtworkUrl } from "../../artworkUrl.js";
import { isOnDemandTrackId } from "../../onDemandMusic.js";

export function searchPlaybackQueueEntry(
  track,
  overrides = {},
) {
  const onDemand =
    track?.source_type ===
      "on_demand" ||
    isOnDemandTrackId(
      track?.id,
    );

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

    onDemand:
      overrides.onDemand ??
      onDemand,

    provisionKey:
      overrides.provisionKey ??
      track?.provision_key ??
      track?.provisionKey ??
      null,

    provisionId:
      overrides.provisionId ??
      track?.provision_id ??
      track?.provisionId ??
      null,

    catalogTrackId:
      overrides.catalogTrackId ??
      track?.catalog_track_id ??
      track?.catalogTrackId ??
      null,
  };
}
