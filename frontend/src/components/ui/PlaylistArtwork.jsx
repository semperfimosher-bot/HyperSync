import {
  resolveArtworkUrl,
} from "../../artworkUrl.js";

import Icon from "./Icon.jsx";


function artworkSources({
  tracks,
  artworkUrls,
  artworkUrl,
}) {
  const fromTracks =
    Array.isArray(
      tracks,
    )
      ? tracks
          .slice(
            0,
            4,
          )
          .map(
            (track) =>
              track?.artwork_url ??
              track?.artworkUrl ??
              null,
          )
      : [];

  const fromUrls =
    Array.isArray(
      artworkUrls,
    )
      ? artworkUrls.slice(
          0,
          4,
        )
      : [];

  const raw =
    fromTracks.length > 0
      ? fromTracks
      : fromUrls.length > 0
        ? fromUrls
        : artworkUrl
          ? [
              artworkUrl,
            ]
          : [];

  return raw.map(
    (source) =>
      source
        ? resolveArtworkUrl(
            source,
          )
        : null,
  );
}


export default function PlaylistArtwork({
  tracks = null,
  artworkUrls = null,
  artworkUrl = null,
  className = "",
  fallbackSize = 24,
}) {
  const sources =
    artworkSources({
      tracks,
      artworkUrls,
      artworkUrl,
    });

  const visibleCount =
    Math.min(
      Math.max(
        sources.length,
        1,
      ),
      4,
    );

  const rootClassName = [
    "playlist-artwork-collage",
    `playlist-artwork-collage--${visibleCount}`,
    className,
  ]
    .filter(
      Boolean,
    )
    .join(
      " ",
    );

  if (
    sources.length ===
    0
  ) {
    return (
      <span
        className={
          rootClassName
        }
      >
        <span className="playlist-artwork-collage__tile playlist-artwork-collage__fallback">
          <Icon
            name="playlist"
            size={
              fallbackSize
            }
          />
        </span>
      </span>
    );
  }

  return (
    <span
      className={
        rootClassName
      }
      aria-hidden="true"
    >
      {sources.map(
        (
          source,
          index,
        ) => (
          <span
            key={
              String(
                index,
              )
            }
            className="playlist-artwork-collage__tile"
          >
            {source ? (
              <img
                src={
                  source
                }
                alt=""
                loading={
                  index < 4
                    ? "eager"
                    : "lazy"
                }
              />
            ) : (
              <span className="playlist-artwork-collage__fallback">
                <Icon
                  name="music"
                  size={
                    Math.max(
                      14,
                      Math.round(
                        fallbackSize *
                        0.65,
                      ),
                    )
                  }
                />
              </span>
            )}
          </span>
        ),
      )}
    </span>
  );
}
