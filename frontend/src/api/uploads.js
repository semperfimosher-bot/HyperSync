import {
  API_BASE,
  formatApiError,
  refreshAccessToken,
} from "./client.js";

import { getAccessToken } from "./storage.js";

function sendUpload({
  item,
  token,
  signal,
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();

    formData.append("file", item.file);
    formData.append("title", item.title.trim());
    formData.append("artist", item.artist.trim());
    formData.append("album", item.album.trim());
    formData.append(
      "duration_seconds",
      String(item.duration || 0),
    );

    const xhr = new XMLHttpRequest();

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
      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.round(
        (event.loaded / event.total) * 100,
      );

      onProgress(progress);
    };

    xhr.onload = () => {
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
      reject(
        new Error(
          "Network error while uploading track.",
        ),
      );
    };

    xhr.onabort = () => {
      const error = new Error(
        "Upload cancelled.",
      );

      error.name = "AbortError";

      reject(error);
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }

      signal.addEventListener(
        "abort",
        () => xhr.abort(),
        { once: true },
      );
    }

    xhr.send(formData);
  });
}

export async function uploadTrack(
  item,
  {
    signal,
    onProgress = () => {},
  } = {},
) {
  let token = getAccessToken();

  try {
    return await sendUpload({
      item,
      token,
      signal,
      onProgress,
    });
  } catch (error) {
    if (error?.status !== 401) {
      throw error;
    }

    const auth = await refreshAccessToken();

    token = auth.access_token;

    return sendUpload({
      item,
      token,
      signal,
      onProgress,
    });
  }
}
