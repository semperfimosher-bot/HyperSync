const TIMESTAMP_PATTERN =
  /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

const OFFSET_PATTERN =
  /\[offset:([+-]?\d+)\]/i;


function fractionToSeconds(
  fraction,
) {
  if (!fraction) {
    return 0;
  }

  const value =
    Number(
      `0.${fraction}`,
    );

  return Number.isFinite(value)
    ? value
    : 0;
}


export function parseSyncedLyrics(
  syncedLyrics,
) {
  if (
    typeof syncedLyrics !==
      "string" ||
    syncedLyrics.trim() === ""
  ) {
    return [];
  }

  const offsetMatch =
    syncedLyrics.match(
      OFFSET_PATTERN,
    );

  const offsetSeconds =
    offsetMatch
      ? (
          Number(
            offsetMatch[1],
          ) / 1000
        )
      : 0;

  const parsed = [];

  for (
    const rawLine
    of syncedLyrics.split(
      /\r?\n/,
    )
  ) {
    const timestamps = [
      ...rawLine.matchAll(
        TIMESTAMP_PATTERN,
      ),
    ];

    if (
      timestamps.length === 0
    ) {
      continue;
    }

    const text =
      rawLine
        .replace(
          TIMESTAMP_PATTERN,
          "",
        )
        .trim();

    if (!text) {
      continue;
    }

    for (
      const timestamp
      of timestamps
    ) {
      const minutes =
        Number(
          timestamp[1],
        );

      const seconds =
        Number(
          timestamp[2],
        );

      if (
        !Number.isFinite(
          minutes,
        ) ||
        !Number.isFinite(
          seconds,
        ) ||
        seconds >= 60
      ) {
        continue;
      }

      const fraction =
        fractionToSeconds(
          timestamp[3],
        );

      const timeSeconds =
        Math.max(
          0,
          (
            minutes * 60
          ) +
          seconds +
          fraction +
          offsetSeconds,
        );

      parsed.push({
        timeSeconds,
        text,
      });
    }
  }

  return parsed.sort(
    (a, b) =>
      a.timeSeconds -
      b.timeSeconds,
  );
}


export function getActiveLyricIndex(
  lines,
  currentTime,
) {
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    typeof currentTime !==
      "number" ||
    !Number.isFinite(
      currentTime,
    )
  ) {
    return -1;
  }

  let low = 0;

  let high =
    lines.length - 1;

  let activeIndex = -1;

  while (low <= high) {
    const middle =
      Math.floor(
        (low + high) / 2,
      );

    if (
      lines[middle]
        .timeSeconds
      <= currentTime
    ) {
      activeIndex =
        middle;

      low =
        middle + 1;
    } else {
      high =
        middle - 1;
    }
  }

  return activeIndex;
}