import { runServerUpload } from "../serverUploadGate.js";
import {
  API_BASE,
  apiRequest,
  formatApiError,
  refreshAccessToken,
} from "./client.js";

import { getAccessToken } from "./storage.js";

// Browser CORS rejection is exposed as an XHR network error. Cool down the
// optional direct path so a whole album does not repeat the same failed PUT.
const DIRECT_UPLOAD_RETRY_DELAY_MS = 2 * 60 * 1000;
const UPLOAD_STALL_TIMEOUT_MS = 90_000;
let directUploadRetryAt = 0;


/**
 * Ensure an XHR upload cannot remain pending forever when a network, proxy or
 * storage endpoint stops making progress. Progress events restart the timer;
 * continuous slow transfers are allowed, while a true stall is aborted.
 */
function createUploadStallWatchdog(xhr, signal, { direct = false } = {}) {
  let timer = null;
  let finished = false;
  let stalled = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const reset = () => {
    if (finished) return;
    clearTimer();
    timer = setTimeout(() => {
      if (finished) return;
      stalled = true;
      xhr.abort();
    }, UPLOAD_STALL_TIMEOUT_MS);
  };

  const abortFromSignal = () => {
    if (!finished) xhr.abort();
  };

  signal?.addEventListener("abort", abortFromSignal, { once: true });
  reset();

  return {
    reset,
    finish() {
      if (finished) return false;
      finished = true;
      clearTimer();
      signal?.removeEventListener("abort", abortFromSignal);
      return true;
    },
    abortError() {
      if (stalled) {
        const error = new Error(
          `Upload stalled with no progress for ${UPLOAD_STALL_TIMEOUT_MS / 1000} seconds.`,
        );
        if (direct) error.directTransportUnavailable = true;
        return error;
      }

      const error = new Error("Upload cancelled.");
      error.name = "AbortError";
      return error;
    },
  };
}

function buildPreparationPayload(
  item,
) {
  return {
    filename:
      item.file.name,
    mime_type:
      item.file.type ||
      "application/octet-stream",
    file_size:
      item.file.size,
    duration_seconds:
      Math.max(
        0,
        Math.round(
          item.duration ||
          0,
        ),
      ),
    title:
      item.title.trim(),
    artist:
      item.artist.trim(),
    album:
      item.album.trim(),
    genre:
      String(
        item.genre ?? "",
      ).trim(),
    release_year:
      Number.isInteger(
        item.releaseYear,
      )
        ? item.releaseYear
        : null,
    estimated_bitrate_kbps:
      Number.isFinite(
        item.bitrateKbps,
      )
        ? item.bitrateKbps
        : null,
  };
}


async function prepareDirectUpload(
  item,
) {
  return apiRequest(
    "/admin/tracks/upload/prepare",
    {
      method:
        "POST",
      body:
        JSON.stringify(
          buildPreparationPayload(
            item,
          ),
        ),
    },
  );
}


function sendDirectB2Upload({
  item,
  preparation,
  signal,
  onProgress,
}) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      if (signal?.aborted) {
        reject(new DOMException("Upload cancelled.", "AbortError"));
        return;
      }

      const xhr =
        new XMLHttpRequest();

      xhr.open(
        "PUT",
        preparation.upload_url,
      );

      xhr.setRequestHeader(
        "Content-Type",
        preparation.content_type,
      );

      let watchdog = null;

      xhr.upload.onprogress =
        (event) => {
          watchdog?.reset();

          if (
            !event.lengthComputable
          ) {
            return;
          }

          const progress =
            Math.min(
              95,
              Math.round(
                (
                  event.loaded /
                  event.total
                ) *
                95,
              ),
            );

          onProgress(
            progress,
          );
        };

      xhr.onload =
        () => {
          if (!watchdog?.finish()) return;

          if (
            xhr.status >= 200 &&
            xhr.status < 300
          ) {
            resolve();

            return;
          }

          const error =
            new Error(
              "Direct B2 upload failed.",
            );

          error.status =
            xhr.status;

          reject(
            error,
          );
        };

      xhr.onerror = () => {
        if (!watchdog?.finish()) return;
        const error = new Error("Direct B2 upload was unavailable.");
        error.directTransportUnavailable = true;
        reject(error);
      };

      xhr.onabort =
        () => {
          const error = watchdog?.abortError()
            ?? new DOMException("Upload cancelled.", "AbortError");
          if (!watchdog?.finish()) return;
          reject(error);
        };

      watchdog = createUploadStallWatchdog(xhr, signal, { direct: true });

      xhr.send(
        item.file,
      );
    },
  );
}


function artworkFilename(
  mimeType,
) {
  const subtype =
    String(
      mimeType ?? "",
    )
      .split(
        "/",
        2,
      )[1]
      ?.split(
        ";",
        1,
      )[0]
      ?.trim()
      || "jpg";

  return (
    "cover." +
    (
      subtype === "jpeg"
        ? "jpg"
        : subtype
    )
  );
}


async function finalizeDirectUpload(
  item,
  preparation,
  signal,
) {
  const formData =
    new FormData();

  formData.append(
    "object_key",
    preparation.object_key,
  );

  formData.append(
    "title",
    item.title.trim(),
  );

  formData.append(
    "artist",
    item.artist.trim(),
  );

  formData.append(
    "album",
    item.album.trim(),
  );

  formData.append(
    "genre",
    String(
      item.genre ?? "",
    ).trim(),
  );

  if (
    Number.isInteger(
      item.releaseYear,
    )
  ) {
    formData.append(
      "release_year",
      String(
        item.releaseYear,
      ),
    );
  }

  formData.append(
    "duration_seconds",
    String(
      Math.max(
        0,
        Math.round(
          item.duration ||
          0,
        ),
      ),
    ),
  );

  formData.append(
    "mime_type",
    preparation.content_type,
  );

  formData.append(
    "original_file_size",
    String(
      item.file.size,
    ),
  );

  if (
    item.artworkBlob &&
    item.artworkMimeType
  ) {
    formData.append(
      "artwork",
      item.artworkBlob,
      artworkFilename(
        item.artworkMimeType,
      ),
    );
  }

  let started = false;
  try {
    return await runServerUpload(() => {
      started = true;
      return apiRequest(
        "/admin/tracks/upload/finalize",
        { method: "POST", body: formData, signal },
      );
    }, { signal });
  } catch (error) {
    // Once submitted, the server owns cleanup. A lost response or abort can
    // follow a durable commit, so deleting prepared audio would corrupt it.
    if (!started) await cancelPreparedUpload(preparation);
    throw error;
  }
}


async function cancelPreparedUpload(
  preparation,
) {
  if (
    !preparation
      ?.object_key
  ) {
    return;
  }

  try {
    await apiRequest(
      "/admin/tracks/upload/cancel",
      {
        method:
          "POST",
        body:
          JSON.stringify({
            object_key:
              preparation.object_key,
          }),
      },
    );
  } catch {
    // Cleanup failure must not hide
    // the original upload result.
  }
}


function sendUpload({
  item,
  token,
  signal,
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }

    const formData = new FormData();

    formData.append("file", item.file);
    formData.append("title", item.title.trim());
    formData.append("artist", item.artist.trim());
    formData.append("album", item.album.trim());
    formData.append(
      "genre",
      String(
        item.genre ?? "",
      ).trim(),
    );
    if (
      Number.isInteger(
        item.releaseYear,
      )
    ) {
      formData.append(
        "release_year",
        String(
          item.releaseYear,
        ),
      );
    }
    formData.append(
      "duration_seconds",
      String(item.duration || 0),
    );

    const edited =
  item.metadataEdited
  ?? {};


formData.append(
  "title_edited",
  String(
    Boolean(
      edited.title,
    ),
  ),
);


formData.append(
  "artist_edited",
  String(
    Boolean(
      edited.artist,
    ),
  ),
);


formData.append(
  "album_edited",
  String(
    Boolean(
      edited.album,
    ),
  ),
);


formData.append(
  "duration_edited",
  String(
    Boolean(
      edited.duration,
    ),
  ),
);

    const xhr = new XMLHttpRequest();
    let watchdog = null;

    xhr.open(
      "POST",
      `${API_BASE}/admin/tracks/upload`,
    );

    xhr.withCredentials = true;

    if (token) {
      xhr.setRequestHeader(
        "Authorization",
        `Bearer ${token}`,
      );
    }

    xhr.upload.onprogress = (event) => {
      watchdog?.reset();

      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.round(
        (event.loaded / event.total) * 100,
      );

      onProgress(progress);
    };

    xhr.onload = () => {
      if (!watchdog?.finish()) return;

      let data = null;

      try {
        data = xhr.responseText
          ? JSON.parse(xhr.responseText)
          : null;
      } catch {
        data = null;
      }

      if (
        xhr.status >= 200 &&
        xhr.status < 300
      ) {
        resolve(data);
        return;
      }

      const error = new Error(
        formatApiError(data?.detail),
      );

      error.status = xhr.status;

      reject(error);
    };

    xhr.onerror = () => {
      if (!watchdog?.finish()) return;
      reject(
        new Error(
          "Network error while uploading track.",
        ),
      );
    };

    xhr.onabort = () => {
      const error = watchdog?.abortError()
        ?? new DOMException("Upload cancelled.", "AbortError");
      if (!watchdog?.finish()) return;
      reject(error);
    };

    watchdog = createUploadStallWatchdog(xhr, signal);

    xhr.send(formData);
  });
}

export async function enrichUploadedTrackMetadata(
  trackId,
) {
  return apiRequest(
    "/admin/tracks/"
      + encodeURIComponent(
          trackId,
        )
      + "/enrich-metadata",
    {
      method:
        "POST",
      cache:
        "no-store",
    },
  );
}


export async function uploadTrack(
  item,
  {
    signal,
    onProgress = () => {},
  } = {},
) {
  let preparation =
    null;

  try {
    if (Date.now() >= directUploadRetryAt) {
      preparation = await prepareDirectUpload(item);
    }
  } catch (error) {
    if (
      error?.status ===
        409 ||
      error?.status ===
        400 ||
      error?.status ===
        403
    ) {
      throw error;
    }

    preparation =
      null;
  }

  if (
    preparation
      ?.direct_upload
  ) {
    try {
      await sendDirectB2Upload({
        item,
        preparation,
        signal,
        onProgress,
      });
    } catch (error) {
      await cancelPreparedUpload(
        preparation,
      );

      if (
        error?.name ===
        "AbortError"
      ) {
        throw error;
      }

      if (error?.directTransportUnavailable) {
        directUploadRetryAt = Date.now() + DIRECT_UPLOAD_RETRY_DELAY_MS;
      }

      /*
       * Direct B2 is an optimization,
       * never a hard dependency. If
       * bucket CORS/network conditions
       * reject it, reset progress and
       * use the original backend upload.
       */
      onProgress(
        0,
      );

      preparation =
        null;
    }
  }

  if (preparation?.direct_upload) {
    onProgress(96);
    const response = await finalizeDirectUpload(item, preparation, signal);
    onProgress(100);
    return response;
  }

  return runServerUpload(async () => {
    let token = getAccessToken();
    try {
      return await sendUpload({ item, token, signal, onProgress });
    } catch (error) {
      if (error?.status !== 401) throw error;
      const auth = await refreshAccessToken();
      token = auth.access_token;
      return sendUpload({ item, token, signal, onProgress });
    }
  }, { signal });
}
