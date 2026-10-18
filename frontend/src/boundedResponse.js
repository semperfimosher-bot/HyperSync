/** Bound buffered media independently of an untrusted Content-Length header. */
export async function readBoundedResponse(response, maxBytes, { signal } = {}) {
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  let complete = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  try {
    if (signal?.aborted) throw new DOMException("Response read aborted.", "AbortError");
    signal?.addEventListener("abort", abort, { once: true });
    if (Number(response.headers.get("Content-Length")) > maxBytes) {
      throw new RangeError("Downloaded artwork has an invalid size.");
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Response read aborted.", "AbortError");
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maxBytes) throw new RangeError("Downloaded artwork has an invalid size.");
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  } finally {
    signal?.removeEventListener("abort", abort);
    // Response.clone() tees its stream; awaiting cancellation would wait for the
    // original image consumer too. Cancel this branch without delaying delivery.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
