import {
  useEffect,
  useState,
} from "react";

import {
  deleteCatalogTrack,
  useCatalogTracks,
} from "../../catalogStore.js";

import { apiRequest } from "../../api/client.js";

import UploadDropzone from "../uploads/UploadDropzone.jsx";

import UploadQueue from "../uploads/UploadQueue.jsx";

import useUploadQueue from "../../hooks/useUploadQueue.js";

export default function AdminUploadsPage() {
  const {
  tracks: uploadedTracks,
  error: catalogError,
  refreshCatalog,
} = useCatalogTracks();

  const [catalogMessage, setCatalogMessage] =
    useState("");

  const [
    metadataBackfillBusy,
    setMetadataBackfillBusy,
  ] = useState(false);

  const [
    diagnostics,
    setDiagnostics,
  ] = useState(null);

  useEffect(() => {
    let cancelled = false;

    apiRequest(
      "/admin/diagnostics",
    )
      .then(
        (result) => {
          if (!cancelled) {
            setDiagnostics(
              result,
            );
          }
        },
      )
      .catch(
        () => {
          if (!cancelled) {
            setDiagnostics(
              null,
            );
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, []);

  const {
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
  } = useUploadQueue({
    existingTracks:
      uploadedTracks,
  });

  const deleteTrack = async (trackId) => {
  setCatalogMessage("");

  try {
    await deleteCatalogTrack(
      trackId,
    );

    setCatalogMessage(
      "Track permanently deleted.",
    );
  } catch (error) {
    setCatalogMessage(
      error instanceof Error
        ? error.message
        : "Failed to delete track.",
    );
  }
};

  const backfillMetadata =
    async () => {
      if (metadataBackfillBusy) {
        return;
      }

      setMetadataBackfillBusy(
        true,
      );
      setCatalogMessage(
        "",
      );

      try {
        const result =
          await apiRequest(
            "/admin/tracks/backfill-metadata?limit=500&external_limit=12",
            {
              method:
                "POST",
              cache:
                "no-store",
            },
          );

        await refreshCatalog({
          force:
            true,
        });

        const sourceSummary =
          Object.entries(
            result?.external_sources ??
            {},
          )
            .map(
              ([
                source,
                count,
              ]) =>
                source
                + " "
                + String(
                    count,
                  ),
            )
            .join(
              ", ",
            );

        setCatalogMessage(
          "Metadata backfill scanned "
          + String(
              result?.scanned ?? 0,
            )
          + " track(s), updated "
          + String(
              result?.updated ?? 0,
            )
          + " • genre "
          + String(
              result?.genre_updated ?? 0,
            )
          + " • year "
          + String(
              result?.year_updated ?? 0,
            )
          + " • external "
          + String(
              result?.external_matched ?? 0,
            )
          + "/"
          + String(
              result?.external_checked ?? 0,
            )
          + " matched"
          + (
              sourceSummary
                ? " • "
                  + sourceSummary
                : ""
            )
          + (
              Array.isArray(
                result?.failed,
              )
              && result.failed.length
                ? " • "
                  + result.failed.length
                  + " failed"
                : ""
            ),
        );
      } catch (error) {
        setCatalogMessage(
          error instanceof Error
            ? error.message
            : "Metadata backfill failed.",
        );
      } finally {
        setMetadataBackfillBusy(
          false,
        );
      }
    };


  const queueProgress =
    queue.length === 0
      ? 0
      : Math.round(
          queue.reduce(
            (total, item) =>
              total + item.progress,
            0,
          ) / queue.length,
        );

  const apiHealthy =
    diagnostics?.api
      ?.healthy === true;

  const storageHealthy =
    diagnostics?.storage
      ?.healthy === true;

  return (
    <div className="page-stack hs-search-page admin-page admin-upload-page">
      <section className="hs-search-console admin-command-console admin-upload-console">
        <div
          className="hs-search-console__grid"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--one"
          aria-hidden="true"
        />

        <div className="hs-search-console__heading admin-command-console__heading">
          <div className="hs-search-console__intro">
            <div className="hs-search-console__eyebrow-row">
              <span className="hs-search-eyebrow">
                <i aria-hidden="true" />
                INGEST PIPELINE
              </span>
            </div>

            <h2>
              Upload Studio
            </h2>

            <p className="admin-command-console__copy">
              Stage tracks, inspect metadata,
              watch upload progress, and publish
              directly into the HyperSynced catalog.
            </p>
          </div>
        </div>

        <div className="hs-search-console__status admin-command-status">
          <span className="hs-search-status-chip hs-search-status-chip--primary">
            <i
              className={
                apiHealthy
                  ? "admin-blue-light is-on"
                  : "admin-blue-light"
              }
            />

            {apiHealthy
              ? "API READY"
              : "API CHECK"}
          </span>

          <span className="hs-search-status-chip">
            <i
              className={
                storageHealthy
                  ? "admin-blue-light is-on"
                  : "admin-blue-light"
              }
            />

            {storageHealthy
              ? "B2 READY"
              : "B2 CHECK"}
          </span>

          <span className="hs-search-status-chip">
            {queue.length}
            {" IN QUEUE"}
          </span>
        </div>
      </section>

      <section className="upload-studio admin-upload-studio">
        <div className="upload-studio__topbar">
          <div>
            <span>
              MULTI-TRACK PIPELINE
            </span>

            <h3>
              Upload Queue
            </h3>
          </div>

          <div className="upload-stats">
            <span>
              {queuedCount} queued
            </span>

            <span>
              {uploadingCount} uploading
            </span>

            <span>
              {successCount} complete
            </span>
          </div>
        </div>

        <UploadDropzone
          disabled={isUploading}
          onFiles={addFiles}
        />

        <div className="upload-queue-summary">
          <div>
            <span>
              OVERALL PROGRESS
            </span>

            <strong>
              {queueProgress}%
            </strong>
          </div>

          <div className="upload-progress upload-progress--overall">
            <i
              style={{
                width:
                  `${queueProgress}%`,
              }}
            />
          </div>
        </div>

        <UploadQueue
          queue={queue}
          disabled={isUploading}
          onUpdate={updateMetadata}
          onRemove={removeItem}
          onCancel={cancelItem}
          onRetry={retryItem}
        />

        <div className="upload-studio__footer">
          <button
            type="button"
            className="secondary-admin-button"
            disabled={
              isUploading ||
              queue.length === 0
            }
            onClick={clearFinished}
          >
            Clear Finished
          </button>

          <button
            type="button"
            className="primary-button upload-start-button"
            disabled={
              isUploading ||
              queuedCount === 0
            }
            onClick={startUploads}
          >
            {isUploading
              ? `Uploading ${uploadingCount} track${
                  uploadingCount === 1
                    ? ""
                    : "s"
                }...`
              : `Upload Queue (${queuedCount})`}
          </button>
        </div>
      </section>

      <section className="admin-upload-list admin-panel admin-upload-catalog">
        <div className="admin-panel__heading">
          <div>
            <span>
              CATALOG
            </span>

            <h3>
              Published Tracks
            </h3>
          </div>

          <div className="admin-upload-catalog__actions">
            <button
              type="button"
              className="secondary-admin-button"
              disabled={
                metadataBackfillBusy
                || uploadedTracks.length === 0
              }
              onClick={() => {
                void backfillMetadata();
              }}
            >
              {metadataBackfillBusy
                ? "Checking tags + Apple catalog..."
                : "Backfill Genre & Year"}
            </button>

            <strong className="admin-panel-count">
              {uploadedTracks.length} total
            </strong>
          </div>
        </div>

        {catalogMessage ? (
          <p className="upload-item-error">
            {catalogMessage}
          </p>
        ) : null}

        {uploadedTracks.length === 0 ? (
          <div className="admin-empty-state">
            <strong>
              No tracks yet
            </strong>

            <p>
              Upload music above to start
              building your catalog.
            </p>
          </div>
        ) : (
          <div className="upload-list">
            {uploadedTracks.map(
              (track) => (
                <div
                  key={track.id}
                  className="upload-item"
                >
                  <div>
                    <strong>
                      {track.title}
                    </strong>

                    <small>
                      {track.artist}
                      {" • "}
                      {track.album ||
                        "No album"}
                      {" • "}
                      {track.genre ||
                        "No genre"}
                      {" • "}
                      {track.release_year ||
                        "No year"}
                    </small>
                  </div>

                  <div className="upload-item__actions">
                    <small>
                      {track.duration_seconds ??
                        0}
                      s
                    </small>

                    <button
                      type="button"
                      className="danger-button"
                      onClick={() =>
                        deleteTrack(
                          track.id,
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
