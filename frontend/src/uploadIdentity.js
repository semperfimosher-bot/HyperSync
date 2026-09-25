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


export function buildUploadIdentity({
  title,
  artist,
} = {}) {
  const titleKey =
    normalizeUploadIdentityText(
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
