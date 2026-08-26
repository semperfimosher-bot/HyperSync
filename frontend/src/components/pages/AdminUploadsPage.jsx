import {
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
} = useCatalogTracks();

  const [catalogMessage, setCatalogMessage] =
    useState("");

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
  } = useUploadQueue();

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

  return (
    <div className="page-stack admin-page">
      <section className="admin-page__header">
        <span>ADMINISTRATION</span>

        <h2>Upload Studio</h2>
        
      </section>

      <section className="upload-studio">
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

      <section className="admin-upload-list">
        <div className="admin-panel__heading">
          <div>
            <span>
              CATALOG
            </span>

            <h3>
              Published Tracks
            </h3>
          </div>

          <strong className="admin-panel-count">
            {uploadedTracks.length} total
          </strong>
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
                      {track.album}
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
