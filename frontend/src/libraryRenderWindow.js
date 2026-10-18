export const LIBRARY_RENDER_BATCH_SIZE = 100;

export function getLibraryRenderItems(
  items,
  visibleCount = LIBRARY_RENDER_BATCH_SIZE,
) {
  if (!Array.isArray(items)) {
    return [];
  }

  const numericCount =
    Number(visibleCount);

  const safeCount =
    Number.isFinite(numericCount)
      ? Math.max(
          0,
          Math.floor(numericCount),
        )
      : LIBRARY_RENDER_BATCH_SIZE;

  return items.slice(
    0,
    safeCount,
  );
}


export function getNextLibraryRenderCount(
  currentCount,
  totalCount,
  batchSize = LIBRARY_RENDER_BATCH_SIZE,
) {
  const total =
    Number.isFinite(Number(totalCount))
      ? Math.max(0, Math.floor(Number(totalCount)))
      : 0;

  const current =
    Number.isFinite(Number(currentCount))
      ? Math.max(0, Math.floor(Number(currentCount)))
      : 0;

  const batch =
    Number.isFinite(Number(batchSize))
      ? Math.max(1, Math.floor(Number(batchSize)))
      : LIBRARY_RENDER_BATCH_SIZE;

  return Math.min(
    total,
    current + batch,
  );
}
