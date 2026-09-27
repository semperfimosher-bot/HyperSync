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



export function getRemoteLyricsPosition(
  snapshot,
  nowMs = Date.now(),
) {
  const basePosition =
    Math.max(
      Number(
        snapshot?.position_seconds ??
          0,
      ) || 0,
      0,
    );

  if (
    snapshot?.paused ||
    !snapshot?.track?.id
  ) {
    return basePosition;
  }

  const updatedAtMs =
    Date.parse(
      String(
        snapshot?.updated_at ??
          "",
      ),
    );

  if (
    !Number.isFinite(
      updatedAtMs,
    )
  ) {
    return basePosition;
  }

  return (
    basePosition +
    Math.max(
      (
        Number(
          nowMs,
        ) -
        updatedAtMs
      ) / 1000,
      0,
    )
  );
}


export function getEffectiveLyricsPlaybackState({
  localState = {},
  accountSnapshot = null,
  currentPlaybackDeviceId = null,
  nowMs = Date.now(),
} = {}) {
  const currentDeviceId =
    String(
      currentPlaybackDeviceId ??
        "",
    ).trim();

  const ownerDeviceId =
    String(
      accountSnapshot?.device_id ??
        "",
    ).trim();

  const controllingRemote =
    Boolean(
      accountSnapshot?.track?.id &&
      ownerDeviceId &&
      currentDeviceId &&
      ownerDeviceId !==
        currentDeviceId
    );

  if (!controllingRemote) {
    return {
      ...localState,
      controllingRemote:
        false,
    };
  }

  const remoteTrack =
    accountSnapshot.track;

  return {
    ...localState,
    trackId:
      String(
        remoteTrack.id,
      ),
    title:
      remoteTrack.title ??
      "",
    artist:
      remoteTrack.artist ??
      "",
    album:
      remoteTrack.album ??
      "",
    artworkUrl:
      remoteTrack.artwork_url ??
      null,
    duration:
      Math.max(
        Number(
          remoteTrack.duration_seconds ??
            0,
        ) || 0,
        0,
      ),
    currentTime:
      getRemoteLyricsPosition(
        accountSnapshot,
        nowMs,
      ),
    paused:
      Boolean(
        accountSnapshot.paused,
      ),
    controllingRemote:
      true,
  };
}
