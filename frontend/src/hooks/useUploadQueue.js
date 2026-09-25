import {
  useCallback,
  useRef,
  useState,
} from "react";

import { uploadTrack } from "../api/uploads.js";

import {
  applyManualMetadataEdit,
  createUploadItem,
} from "../utils/audioMetadata.js";

import {
  findCatalogDuplicate,
  findQueuedUploadDuplicates,
} from "../uploadIdentity.js";

import {
  getUploadConcurrency,
} from "../uploadConcurrency.js";

const MAX_CONCURRENT_UPLOADS = 2;

export default function useUploadQueue({
  existingTracks = [],
} = {}) {
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

  const updateMetadata =
  useCallback(
    (id, patch) => {
      updateQueue(
        (current) =>
          current.map(
            (item) => {
              if (
                item.id !== id
              ) {
                return item;
              }

              return (
                applyManualMetadataEdit(
                  item,
                  patch,
                )
              );
            },
          ),
      );
    },
    [updateQueue],
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
  !item.artist.trim()
) {
  updateItem(id, {
    status: "failed",
    error:
      "Title and artist are required.",
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
      const snapshot =
        queueRef.current;

      const queueDuplicates =
        findQueuedUploadDuplicates(
          snapshot,
        );

      const catalogDuplicates =
        new Map();

      for (const item of snapshot) {
        if (
          item.status !== "queued"
        ) {
          continue;
        }

        const duplicate =
          findCatalogDuplicate(
            item,
            existingTracks,
          );

        if (duplicate) {
          catalogDuplicates.set(
            item.id,
            duplicate,
          );
        }
      }

      if (
        queueDuplicates.size > 0 ||
        catalogDuplicates.size > 0
      ) {
        updateQueue(
          (current) =>
            current.map(
              (item) => {
                const queuedOriginal =
                  queueDuplicates.get(
                    item.id,
                  );

                if (queuedOriginal) {
                  return {
                    ...item,
                    status:
                      "failed",
                    progress:
                      0,
                    error:
                      `Duplicate in upload queue: "${queuedOriginal.title}" by ${queuedOriginal.artist} is already queued.`,
                  };
                }

                const catalogDuplicate =
                  catalogDuplicates.get(
                    item.id,
                  );

                if (catalogDuplicate) {
                  return {
                    ...item,
                    status:
                      "failed",
                    progress:
                      0,
                    error:
                      `Duplicate track prevented: "${catalogDuplicate.title}" by ${catalogDuplicate.artist} already exists in the catalog.`,
                  };
                }

                return item;
              },
            ),
        );
      }

      const pendingIds =
        snapshot
          .filter(
            (item) =>
              item.status === "queued" &&
              !queueDuplicates.has(
                item.id,
              ) &&
              !catalogDuplicates.has(
                item.id,
              ),
          )
          .map(
            (item) =>
              item.id,
          );

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
        const workerCount =
          getUploadConcurrency({
            queuedCount:
              pendingIds.length,
          });

        await Promise.all(
          Array.from(
            {
              length:
                workerCount,
            },
            () => worker(),
          ),
        );
      } finally {
        setIsUploading(false);
      }
    },
    [
      existingTracks,
      updateQueue,
      uploadOne,
    ],
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
