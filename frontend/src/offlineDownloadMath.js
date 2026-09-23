export function getMissingDownloadBytes(
  fileSize,
  record = null,
) {
  const normalizedSize =
    Number(
      fileSize,
    );

  if (
    !Number.isSafeInteger(
      normalizedSize,
    ) ||
    normalizedSize <= 0
  ) {
    return 0;
  }

  const cachedBytes =
    Number.isFinite(
      record?.cachedBytes,
    )
      ? Math.max(
          0,
          Math.min(
            normalizedSize,
            record.cachedBytes,
          ),
        )
      : 0;

  return Math.max(
    0,
    normalizedSize -
      cachedBytes,
  );
}
