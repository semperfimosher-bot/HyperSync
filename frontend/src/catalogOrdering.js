const catalogCollator =
  new Intl.Collator(
    undefined,
    {
      sensitivity:
        "base",
      numeric:
        true,
    },
  );


function cleanCatalogLabel(
  value,
) {
  return String(
    value ?? "",
  )
    .trim()
    .replace(
      /\s+/g,
      " ",
    );
}


function normalizedCatalogLabel(
  value,
) {
  return cleanCatalogLabel(
    value,
  )
    .normalize(
      "NFKC",
    )
    .toLocaleLowerCase();
}


export function isCatalogSingle(
  track,
) {
  const title =
    cleanCatalogLabel(
      track?.title,
    );

  const album =
    cleanCatalogLabel(
      track?.album,
    );

  if (!album) {
    return true;
  }

  const normalizedTitle =
    normalizedCatalogLabel(
      title,
    );

  const normalizedAlbum =
    normalizedCatalogLabel(
      album,
    );

  if (
    normalizedTitle &&
    normalizedAlbum ===
      normalizedTitle
  ) {
    return true;
  }

  const albumWithoutSingleSuffix =
    album
      .replace(
        /\s*[-–—:]\s*single\s*$/i,
        "",
      )
      .replace(
        /\s*[([]\s*single\s*[)\]]\s*$/i,
        "",
      )
      .trim();

  return (
    normalizedTitle &&
    normalizedCatalogLabel(
      albumWithoutSingleSuffix,
    ) ===
      normalizedTitle
  );
}


export function sortCatalogFolderTracks(
  tracks,
) {
  return [
    ...(
      Array.isArray(
        tracks,
      )
        ? tracks
        : []
    ),
  ].sort(
    (
      left,
      right,
    ) => {
      const leftSingle =
        isCatalogSingle(
          left,
        );

      const rightSingle =
        isCatalogSingle(
          right,
        );

      if (
        leftSingle !==
        rightSingle
      ) {
        return leftSingle
          ? 1
          : -1;
      }

      if (
        !leftSingle &&
        !rightSingle
      ) {
        const albumOrder =
          catalogCollator.compare(
            cleanCatalogLabel(
              left?.album,
            ),
            cleanCatalogLabel(
              right?.album,
            ),
          );

        if (
          albumOrder !== 0
        ) {
          return albumOrder;
        }
      }

      const titleOrder =
        catalogCollator.compare(
          cleanCatalogLabel(
            left?.title,
          ),
          cleanCatalogLabel(
            right?.title,
          ),
        );

      if (
        titleOrder !== 0
      ) {
        return titleOrder;
      }

      return catalogCollator.compare(
        cleanCatalogLabel(
          left?.artist,
        ),
        cleanCatalogLabel(
          right?.artist,
        ),
      );
    },
  );
}
