import { API_BASE } from "../../api/client.js";

function resolveArtworkUrl(src) {
  if (!src) {
    return null;
  }

  if (
    src.startsWith("http://") ||
    src.startsWith("https://")
  ) {
    return src;
  }

  if (API_BASE.startsWith("http")) {
    const apiOrigin = new URL(API_BASE).origin;

    return `${apiOrigin}${src}`;
  }

  return src;
}

function CoverPlaceholder({
  variant = 1,
  label = "Awaiting catalog",
}) {
  return (
    <div
      className={
        `cover-placeholder ` +
        `cover-placeholder--${variant}`
      }
      role="img"
      aria-label={label}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <defs>
          <radialGradient
            id={`cover-glow-${variant}`}
          >
            <stop
              offset="0"
              stopColor="#45e7ff"
              stopOpacity=".85"
            />
            <stop
              offset=".35"
              stopColor="#087bf1"
              stopOpacity=".34"
            />

            <stop
              offset="1"
              stopColor="#02050a"
              stopOpacity="0"
            />
          </radialGradient>
        </defs>

        <circle
          cx="50"
          cy="50"
          r="42"
          fill={`url(#cover-glow-${variant})`}
        />

        <path
          d={
            "M8 64c18-22 34-28 47-17 " +
            "11 10 20 8 37-12"
          }
          fill="none"
          stroke="rgba(123,229,255,.75)"
          strokeWidth="2"
        />

        <circle
          cx="50"
          cy="50"
          r="16"
          fill="none"
          stroke="rgba(255,255,255,.35)"
        />

        <circle
          cx="50"
          cy="50"
          r="4"
          fill="#07121b"
          stroke="#20d6ff"
        />
      </svg>
    </div>
  );
}

function TrackArtwork({
  src,
  alt,
  variant = 1,
}) {
  const artworkUrl =
    resolveArtworkUrl(src);

  if (!artworkUrl) {
    return (
      <CoverPlaceholder
        variant={variant}
        label={alt || "No track artwork"}
      />
    );
  }

  return (
    <div className="track-artwork-shell">
      <img
        className="track-artwork"
        src={artworkUrl}
        alt={alt || "Track artwork"}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = "none";

          const fallback =
            event.currentTarget.nextElementSibling;

          if (fallback) {
            fallback.style.display = "grid";
          }
        }}
      />

      <CoverPlaceholder
        variant={variant}
        label={alt || "No track artwork"}
      />
    </div>
  );
}

export {
  CoverPlaceholder,
  TrackArtwork,
};

export default TrackArtwork
