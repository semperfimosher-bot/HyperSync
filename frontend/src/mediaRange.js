export function parseMediaRangeHeader(
  rangeHeader,
  fileSize,
) {
  const normalizedRangeHeader =
    rangeHeader ?? "";

  if (
    normalizedRangeHeader.includes(
      ",",
    )
  ) {
    throw new RangeError(
      "Multiple media byte ranges are not supported.",
    );
  }

  const boundedOrOpenMatch =
    /^bytes=(\d+)-(\d*)$/.exec(
      rangeHeader ?? "",
    );

  if (boundedOrOpenMatch) {
    const byteStart =
      Number(
        boundedOrOpenMatch[1],
      );

    if (
      byteStart >=
      fileSize
    ) {
      throw new RangeError(
        "Media byte range is unsatisfiable.",
      );
    }

    const requestedByteEnd =
      boundedOrOpenMatch[2]
        ? Number(
            boundedOrOpenMatch[2],
          )
        : fileSize - 1;

    if (
      requestedByteEnd <
      byteStart
    ) {
      throw new RangeError(
        "Media byte range end cannot be before start.",
      );
    }

    const byteEnd =
      Math.min(
        requestedByteEnd,
        fileSize - 1,
      );

    return {
      byteStart,
      byteEnd,
    };
  }

  const suffixMatch =
    /^bytes=-(\d+)$/.exec(
      rangeHeader ?? "",
    );

  if (suffixMatch) {
    const suffixLength =
      Number(
        suffixMatch[1],
      );

    if (
      suffixLength === 0
    ) {
      throw new RangeError(
        "Media byte range is unsatisfiable.",
      );
    }

    return {
      byteStart:
        Math.max(
          0,
          fileSize -
            suffixLength,
        ),
      byteEnd:
        fileSize - 1,
    };
  }

  return null;
}
