function normalizeSortText(
  value,
) {
  return String(
    value ?? "",
  )
    .trim()
    .toLocaleLowerCase(
      "en-US",
    );
}


function compareText(
  left,
  right,
) {
  const normalizedLeft =
    normalizeSortText(
      left,
    );

  const normalizedRight =
    normalizeSortText(
      right,
    );

  if (
    normalizedLeft <
    normalizedRight
  ) {
    return -1;
  }

  if (
    normalizedLeft >
    normalizedRight
  ) {
    return 1;
  }

  return 0;
}


function compareWithTieBreaker(
  leftPrimary,
  rightPrimary,
  leftSecondary,
  rightSecondary,
) {
  const primaryResult =
    compareText(
      leftPrimary,
      rightPrimary,
    );

  if (primaryResult !== 0) {
    return primaryResult;
  }

  return compareText(
    leftSecondary,
    rightSecondary,
  );
}


export function alphabetizeSearchResults(
  results,
) {
  return {
    ...results,

    tracks: [
      ...(results?.tracks || []),
    ].sort(
      (left, right) =>
        compareWithTieBreaker(
          left.title,
          right.title,
          left.artist,
          right.artist,
        ),
    ),

    artists: [
      ...(results?.artists || []),
    ].sort(
      (left, right) =>
        compareText(
          left.name,
          right.name,
        ),
    ),

    collaborations: [
      ...(
        results?.collaborations ||
        []
      ),
    ].sort(
      (left, right) =>
        compareText(
          left.name,
          right.name,
        ),
    ),

    albums: [
      ...(results?.albums || []),
    ].sort(
      (left, right) =>
        compareWithTieBreaker(
          left.title,
          right.title,
          left.artist,
          right.artist,
        ),
    ),

    people: [
      ...(results?.people || []),
    ].sort(
      (left, right) =>
        compareWithTieBreaker(
          left.display_name,
          right.display_name,
          left.username,
          right.username,
        ),
    ),
  };
}
