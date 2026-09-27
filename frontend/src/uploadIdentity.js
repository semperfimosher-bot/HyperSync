export function normalizeUploadIdentityText(
  value,
) {
  return String(
    value ?? "",
  )
    .normalize(
      "NFKC",
    )
    .trim()
    .toLocaleLowerCase()
    .replace(
      /\s+/g,
      " ",
    );
}


const VERSION_QUALIFIER_RE =
  /\b(?:remix(?:ed)?|remaster(?:ed)?|acoustic|live|radio\s+(?:edit|version|mix)|edit|extended(?:\s+(?:mix|version))?|club\s+mix|dance\s+mix|original\s+mix|alternate(?:\s+version)?|alt(?:\s+version)?|version|instrumental|karaoke|demo|mono|stereo|clean|explicit|sped\s*[- ]?\s*up|slowed(?:\s*(?:\+|and)\s*reverb)?|reverb|nightcore|rework|re[- ]?record(?:ed|ing)?|anniversary|deluxe)\b/i;


const BARE_VERSION_SUFFIX_RE =
  /\s+(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|remix(?:ed)?|acoustic(?:\s+version)?|live(?:\s+version)?|radio\s+(?:edit|version|mix)|edit|extended(?:\s+(?:mix|version))?|club\s+mix|dance\s+mix|original\s+mix|alternate(?:\s+version)?|alt(?:\s+version)?|version|instrumental(?:\s+version)?|karaoke(?:\s+version)?|demo(?:\s+version)?|mono(?:\s+version)?|stereo(?:\s+version)?|clean(?:\s+version)?|explicit(?:\s+version)?|sped\s*[- ]?\s*up|slowed(?:\s*(?:\+|and)\s*reverb)?|nightcore|rework|re[- ]?record(?:ed|ing)?|anniversary(?:\s+edition)?|deluxe(?:\s+version)?|single\s+version|album\s+version)\s*$/i;


export function normalizeUploadTitleIdentityText(
  value,
) {
  const normalized =
    normalizeUploadIdentityText(
      value,
    );

  if (!normalized) {
    return "";
  }

  let root =
    normalized;

  while (root) {
    const previous =
      root;

    const bracket =
      root.match(
        /\s*[\(\[\{]([^()\[\]{}]+)[\)\]\}]\s*$/,
      );

    if (
      bracket &&
      VERSION_QUALIFIER_RE.test(
        bracket[1],
      )
    ) {
      root =
        root
          .slice(
            0,
            bracket.index,
          )
          .trim();
    }

    const separator =
      root.match(
        /^(.*)\s+[-–—:]\s+(.+)$/,
      );

    if (
      separator &&
      VERSION_QUALIFIER_RE.test(
        separator[2],
      )
    ) {
      root =
        separator[1]
          .trim();
    }

    root =
      root
        .replace(
          BARE_VERSION_SUFFIX_RE,
          "",
        )
        .trim();

    if (
      root === previous
    ) {
      break;
    }
  }

  return (
    root ||
    normalized
  );
}


export function buildUploadIdentity({
  title,
  artist,
} = {}) {
  const titleKey =
    normalizeUploadTitleIdentityText(
      title,
    );

  const artistKey =
    normalizeUploadIdentityText(
      artist,
    );

  if (
    !titleKey ||
    !artistKey
  ) {
    return null;
  }

  return (
    artistKey +
    "\u001f" +
    titleKey
  );
}


export function findQueuedUploadDuplicates(
  items,
) {
  const seen =
    new Map();

  const duplicates =
    new Map();

  for (const item of (
    Array.isArray(items)
      ? items
      : []
  )) {
    if (
      item?.status !==
      "queued"
  ) {
    continue;
  }

    const identity =
      buildUploadIdentity(
        item,
      );

    if (!identity) {
      continue;
    }

    const original =
      seen.get(
        identity,
      );

    if (original) {
      duplicates.set(
        item.id,
        original,
      );

      continue;
    }

    seen.set(
      identity,
      item,
    );
  }

  return duplicates;
}


export function findCatalogDuplicate(
  item,
  tracks,
) {
  const identity =
    buildUploadIdentity(
      item,
    );

  if (!identity) {
    return null;
  }

  return (
    (
      Array.isArray(
        tracks,
      )
        ? tracks
        : []
    ).find(
      (track) =>
        buildUploadIdentity(
          track,
        )
        === identity,
    )
    ?? null
  );
}
