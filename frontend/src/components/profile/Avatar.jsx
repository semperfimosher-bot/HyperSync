import {
  API_BASE,
} from "../../api/client.js";


export function resolveProfileAssetUrl(
  src,
) {
  if (!src) {
    return null;
  }

  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("blob:")
  ) {
    return src;
  }

  if (
    API_BASE.startsWith("http")
  ) {
    const apiOrigin =
      new URL(API_BASE).origin;

    return `${apiOrigin}${src}`;
  }

  return src;
}


function initialsFor(name) {
  const clean =
    String(name || "User").trim();

  if (!clean) {
    return "U";
  }

  return clean
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}


export default function Avatar({
  src,
  name,
  cacheKey = "",
  size = "large",
  className = "",
}) {
  const resolved =
    resolveProfileAssetUrl(src);

  const finalSrc =
    resolved && cacheKey
      ? `${resolved}${
          resolved.includes("?")
            ? "&"
            : "?"
        }v=${encodeURIComponent(
          cacheKey,
        )}`
      : resolved;

  return (
    <div
      className={
        `hs-avatar ` +
        `hs-avatar--${size} ` +
        className
      }
      aria-label={`${name || "User"} profile picture`}
    >
      <span className="hs-avatar__initials">
        {initialsFor(name)}
      </span>

      {finalSrc ? (
        <img
          src={finalSrc}
          alt={`${name || "User"} profile`}
          onError={(event) => {
            event.currentTarget.style.display =
              "none";
          }}
        />
      ) : null}
    </div>
  );
}
