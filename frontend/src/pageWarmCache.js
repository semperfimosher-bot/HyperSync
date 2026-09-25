export const PAGE_WARM_TTL_MS =
  2 * 60 * 60 * 1000;

export const PAGE_WARM_SWEEP_MS =
  60 * 1000;


export function warmPageKey(
  page,
  profileUsername = "",
) {
  const normalizedPage =
    String(
      page ?? "home",
    ).trim() ||
    "home";

  if (
    normalizedPage !==
    "public-profile"
  ) {
    return normalizedPage;
  }

  const normalizedUsername =
    String(
      profileUsername ?? "",
    )
      .trim()
      .toLocaleLowerCase();

  return normalizedUsername
    ? (
        "public-profile:" +
        encodeURIComponent(
          normalizedUsername,
        )
      )
    : "home";
}


export function pruneWarmPages(
  pages,
  {
    activeKey,
    ownerKey,
    now = Date.now(),
    ttlMs =
      PAGE_WARM_TTL_MS,
  },
) {
  const entries =
    Array.isArray(
      pages,
    )
      ? pages
      : [];

  return entries.filter(
    (entry) => {
      if (
        entry?.ownerKey !==
        ownerKey
      ) {
        return false;
      }

      if (
        entry?.key ===
        activeKey
      ) {
        return true;
      }

      const lastVisitedAt =
        Number(
          entry?.lastVisitedAt,
        );

      return (
        Number.isFinite(
          lastVisitedAt,
        ) &&
        now - lastVisitedAt <
          ttlMs
      );
    },
  );
}


export function touchWarmPage(
  pages,
  {
    page,
    profileUsername = "",
    ownerKey,
    now = Date.now(),
    ttlMs =
      PAGE_WARM_TTL_MS,
  },
) {
  const key =
    warmPageKey(
      page,
      profileUsername,
    );

  const retained =
    pruneWarmPages(
      pages,
      {
        activeKey:
          key,
        ownerKey,
        now,
        ttlMs,
      },
    ).filter(
      (entry) =>
        entry.key !== key,
    );

  return [
    ...retained,
    {
      key,
      page:
        key === "home"
          ? "home"
          : page,
      profileUsername:
        page ===
        "public-profile"
          ? profileUsername
          : "",
      ownerKey,
      lastVisitedAt:
        now,
    },
  ];
}
