import {
  useCallback,
  useRef,
  useState,
} from "react";

import { uploadTrack } from "../api/uploads.js";

import {
  createUploadItem,
} from "../utils/audioMetadata.js";

const MAX_CONCURRENT_UPLOADS = 2;

export default function useUploadQueue() {
  const [queue, setQueue] = useState([]);
  const [isUploading, setIsUploading] =
    useState(false);

  const queueRef = useRef([]);
  const controllersRef = useRef(new Map());

  const updateQueue = useCallback((updater) => {
    setQueue((current) => {
      const next =
        typeof updater === "function"
          ? updater(current)
          : updater;

      queueRef.current = next;

      return next;
    });
  }, []);

  const updateItem = useCallback(
    (id, patch) => {
      updateQueue((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
              }
            : item,
        ),
      );
    },
    [updateQueue],
  );

  const addFiles = useCallback(
    async (files) => {
      const audioFiles =
        Array.from(files).filter(
          (file) =>
            file.type.startsWith("audio/") ||
            /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(
              file.name,
            ),
        );

      const items = await Promise.all(
        audioFiles.map(createUploadItem),
      );

      updateQueue((current) => [
        ...current,
        ...items,
      ]);
    },
    [updateQueue],
  );

  const updateMetadata = useCallback(
    (id, patch) => {
      updateItem(id, patch);
    },
    [updateItem],
  );

  const removeItem = useCallback(
    (id) => {
      const controller =
        controllersRef.current.get(id);

      if (controller) {
        controller.abort();
        controllersRef.current.delete(id);
      }

      updateQueue((current) =>
        current.filter(
          (item) => item.id !== id,
        ),
      );
    },
    [updateQueue],
  );

  const cancelItem = useCallback(
    (id) => {
      const controller =
        controllersRef.current.get(id);

      if (controller) {
        controller.abort();
      }

      updateItem(id, {
        status: "cancelled",
      });
    },
    [updateItem],
  );

  const retryItem = useCallback(
    (id) => {
      updateItem(id, {
        status: "queued",
        progress: 0,
        error: "",
        response: null,
      });
    },
    [updateItem],
  );

  const clearFinished = useCallback(() => {
    updateQueue((current) =>
      current.filter(
        (item) =>
          item.status !== "success" &&
          item.status !== "cancelled",
      ),
    );
  }, [updateQueue]);

  const uploadOne = useCallback(
    async (id) => {
      const item =
        queueRef.current.find(
          (entry) => entry.id === id,
        );

      if (!item) {
        return;
      }

      if (
        !item.title.trim() ||
        !item.artist.trim() ||
        !item.album.trim()
      ) {
        updateItem(id, {
          status: "failed",
          error:
            "Title, artist, and album are required.",
        });

        return;
      }

      const controller =
        new AbortController();

      controllersRef.current.set(
        id,
        controller,
      );

      updateItem(id, {
        status: "uploading",
        progress: 0,
        error: "",
      });

      try {
        const response = await uploadTrack(
          item,
          {
            signal: controller.signal,

            onProgress: (progress) => {
              updateItem(id, {
                progress,
              });
            },
          },
        );

        updateItem(id, {
          status: "success",
          progress: 100,
          response,
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          updateItem(id, {
            status: "cancelled",
          });
        } else {
          updateItem(id, {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Upload failed.",
          });
        }
      } finally {
        controllersRef.current.delete(id);
      }
    },
    [updateItem],
  );

  const startUploads = useCallback(
    async () => {
      const pendingIds =
        queueRef.current
          .filter(
            (item) =>
              item.status === "queued",
          )
          .map((item) => item.id);

      if (pendingIds.length === 0) {
        return;
      }

      setIsUploading(true);

      let nextIndex = 0;

      const worker = async () => {
        while (true) {
          const currentIndex = nextIndex;

          nextIndex += 1;

          if (
            currentIndex >=
            pendingIds.length
          ) {
            return;
          }

          await uploadOne(
            pendingIds[currentIndex],
          );
        }
      };

      try {
        await Promise.all(
          Array.from(
            {
              length: Math.min(
                MAX_CONCURRENT_UPLOADS,
                pendingIds.length,
              ),
            },
            () => worker(),
          ),
        );
      } finally {
        setIsUploading(false);
      }
    },
    [uploadOne],
  );

  const queuedCount = queue.filter(
    (item) => item.status === "queued",
  ).length;

  const uploadingCount = queue.filter(
    (item) =>
      item.status === "uploading",
  ).length;

  const successCount = queue.filter(
    (item) => item.status === "success",
  ).length;

  return {
    queue,
    isUploading,
    queuedCount,
    uploadingCount,
    successCount,
    addFiles,
    updateMetadata,
    removeItem,
    cancelItem,
    retryItem,
    clearFinished,
    startUploads,
  };
}
