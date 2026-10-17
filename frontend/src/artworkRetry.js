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
function currentImageSource(image) {
  if (typeof image?.getAttribute === "function") {
    return image.getAttribute("src");
  }

  return image?.src ?? image?.currentSrc ?? "";
}


export function retryTransientArtwork(event, source) {
  const image = event?.currentTarget;
  if (!image) return false;

  const requestedSource = String(
    source ?? image.currentSrc ?? image.src ?? "",
  );

  if (!API_ARTWORK_PATH.test(requestedSource)) {
    return false;
  }

  // An image element can be reused for a new track while a previous retry is
  // waiting. Reset retry accounting whenever the requested artwork changes.
  if (
    image.dataset.artworkRetrySource &&
    image.dataset.artworkRetrySource !== requestedSource
  ) {
    resetArtworkRetry(image);
  }

  const attempts = Number(image.dataset.artworkRetryCount ?? 0);

  if (attempts >= 3) {
    return false;
  }

  const nextAttempt = attempts + 1;
  image.dataset.artworkRetryCount = String(nextAttempt);
  image.dataset.artworkRetrySource = requestedSource;

  const baseDelay = Math.min(4_000, 750 * (2 ** attempts));
  const jitter = Math.floor(Math.random() * 350);

  window.setTimeout(() => {
    if (!image.isConnected) {
      return;
    }

    // Never let a pending retry for an old track overwrite a newer src prop.
    if (String(currentImageSource(image) ?? "") !== requestedSource) {
      return;
    }

    image.src = requestedSource;
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
