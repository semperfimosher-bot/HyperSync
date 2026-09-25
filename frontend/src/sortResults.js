export const RESULTS_SORT_OPTIONS = [
  {
    value: "smart",
    label: "Smart Sort",
  },
  {
    value: "recent",
    label: "Recents",
  },
  {
    value: "albums",
    label: "Albums",
  },
  {
    value: "alphabetical",
    label: "Alphabetical Order",
  },
];


function sortText(
  value,
) {
  return String(
    value ?? "",
  )
    .trim()
    .toLocaleLowerCase();
}


function itemTitle(
  item,
) {
  return (
    item?.title ??
    item?.name ??
    item?.username ??
    item?.artist ??
    ""
  );
}


function recentTime(
  item,
) {
  for (const value of [
    item?.last_played_at,
    item?.lastPlayedAt,
    item?.added_at,
    item?.addedAt,
    item?.created_at,
    item?.createdAt,
    item?.updated_at,
    item?.updatedAt,
    item?.downloaded_at,
    item?.downloadedAt,
  ]) {
    if (!value) {
      continue;
    }

    const time =
      new Date(
        value,
      ).getTime();

    if (
      Number.isFinite(
        time,
      )
    ) {
      return time;
    }
  }

  return null;
}


function compareText(
  left,
  right,
) {
  return sortText(
    left,
  ).localeCompare(
    sortText(
      right,
    ),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}


export function sortResultItems(
  items,
  mode = "smart",
) {
  const source =
    Array.isArray(items)
      ? items
      : [];

  const indexed =
    source.map(
      (
        item,
        index,
      ) => ({
        item,
        index,
      }),
    );

  if (
    mode === "smart"
  ) {
    return [
      ...source,
    ];
  }

  indexed.sort(
    (
      left,
      right,
    ) => {
      const a =
        left.item;

      const b =
        right.item;

      if (
        mode === "recent"
      ) {
        const aTime =
          recentTime(
            a,
          );

        const bTime =
          recentTime(
            b,
          );

        if (
          aTime !== null ||
          bTime !== null
        ) {
          if (
            aTime === null
          ) {
            return 1;
          }

          if (
            bTime === null
          ) {
            return -1;
          }

          if (
            aTime !==
            bTime
          ) {
            return (
              bTime -
              aTime
            );
          }
        }
      }

      if (
        mode === "albums"
      ) {
        const albumOrder =
          compareText(
            a?.album,
            b?.album,
          );

        if (
          albumOrder !== 0
        ) {
          return albumOrder;
        }

        const artistOrder =
          compareText(
            a?.artist ??
              a?.owner_username,
            b?.artist ??
              b?.owner_username,
          );

        if (
          artistOrder !== 0
        ) {
          return artistOrder;
        }
      }

      if (
        mode === "alphabetical" ||
        mode === "albums"
      ) {
        const titleOrder =
          compareText(
            itemTitle(
              a,
            ),
            itemTitle(
              b,
            ),
          );

        if (
          titleOrder !== 0
        ) {
          return titleOrder;
        }
      }

      return (
        left.index -
        right.index
      );
    },
  );

  return indexed.map(
    ({ item }) =>
      item,
  );
}
