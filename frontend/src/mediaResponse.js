export function createMediaRangeResponse({
  data,
  byteStart,
  byteEnd,
  fileSize,
  mimeType,
}) {
  const expectedByteLength =
    byteEnd -
    byteStart +
    1;

  if (
    data.byteLength !==
    expectedByteLength
  ) {
    throw new RangeError(
      "Media range body length does not match requested byte range.",
    );
  }

  return new Response(
    data,
    {
      status: 206,
      headers: {
        "Accept-Ranges":
          "bytes",
        "Content-Length":
          String(
            data.byteLength,
          ),
        "Content-Range":
          `bytes ${byteStart}-${byteEnd}/${fileSize}`,
        "Content-Type":
          mimeType,
      },
    },
  );
}
