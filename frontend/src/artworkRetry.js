const API_ARTWORK_PATH =
  /\/api\/catalog\/tracks\/[^/]+\/artwork(?:[?#]|$)/;


/**
 * Retry transient failures from the local API artwork proxy.
 *
 * The backend intentionally caps concurrent media streams and can return 503
 * with Retry-After when busy. <img> errors do not expose response headers, so
 * retry with bounded exponential backoff and jitter rather than dropping art
 * immediately. Direct B2/external URLs are not retried by this helper.
 */
export function retryTransientArtwork(event, source) {
  const image = event?.currentTarget;

  if (
    !image ||
    !API_ARTWORK_PATH.test(String(source ?? image.currentSrc ?? image.src))
  ) {
    return false;
  }

  const attempts = Number(image.dataset.artworkRetryCount ?? 0);

  if (attempts >= 3) {
    return false;
  }

  const nextAttempt = attempts + 1;
  image.dataset.artworkRetryCount = String(nextAttempt);

  const retrySource =
    image.dataset.artworkRetrySource ||
    String(source ?? image.currentSrc ?? image.src);

  image.dataset.artworkRetrySource = retrySource;

  const baseDelay = Math.min(4_000, 750 * (2 ** attempts));
  const jitter = Math.floor(Math.random() * 350);

  window.setTimeout(() => {
    if (!image.isConnected) {
      return;
    }

    image.src = retrySource;
  }, baseDelay + jitter);

  return true;
}

export function resetArtworkRetry(image) {
  if (!image?.dataset) {
    return;
  }

  delete image.dataset.artworkRetryCount;
  delete image.dataset.artworkRetrySource;
}
