import { useState } from "react";

import Icon from "../ui/Icon.jsx";

function formatFileSize(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
  ];

  const index = Math.min(
    Math.floor(
      Math.log(bytes) /
        Math.log(1024),
    ),
    units.length - 1,
  );

  const value =
    bytes / Math.pow(1024, index);

  return `${value.toFixed(
    index === 0 ? 0 : 1,
  )} ${units[index]}`;
}

function formatDuration(seconds) {
  const minutes = Math.floor(
    seconds / 60,
  );

  const remainingSeconds = Math.round(
    seconds % 60,
  );

  return `${minutes}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}

export default function UploadQueueItem({
  item,
  disabled,
  onUpdate,
  onRemove,
  onCancel,
  onRetry,
}) {
  const [expanded, setExpanded] =
    useState(false);

  const isUploading =
    item.status === "uploading";

  const isSuccess =
    item.status === "success";

  const isFailed =
    item.status === "failed";

  return (
    <article
      className={
        "upload-queue-item " +
        `upload-queue-item--${item.status}`
      }
    >
      <div className="upload-queue-item__main">
        <div className="upload-queue-item__art">
          <Icon
            name={
              isSuccess
                ? "disc"
                : "music"
            }
            size={26}
          />
        </div>

        <div className="upload-queue-item__info">
          <strong>
            {item.title}
          </strong>

          <span>
            {item.artist}
            {" • "}
            {item.album}
          </span>

          <small>
            {formatFileSize(
              item.file.size,
            )}
            {" • "}
            {formatDuration(
              item.duration,
            )}
          </small>
        </div>

        <div className="upload-queue-item__status">
          {isUploading ? (
            <span>
              {item.progress}%
            </span>
          ) : isSuccess ? (
            <span>READY</span>
          ) : isFailed ? (
            <span>FAILED</span>
          ) : item.status ===
            "cancelled" ? (
            <span>CANCELLED</span>
          ) : (
            <span>QUEUED</span>
          )}
        </div>
      </div>

      {isUploading ? (
        <div className="upload-progress">
          <i
            style={{
              width: `${item.progress}%`,
            }}
          />
        </div>
      ) : null}

      {item.error ? (
        <p className="upload-item-error">
          {item.error}
        </p>
      ) : null}

      <div className="upload-queue-item__actions">
        <button
          type="button"
          className="upload-item-action"
          disabled={
            disabled ||
            isUploading
          }
          onClick={() => {
            setExpanded(
              (current) => !current,
            );
          }}
        >
          {expanded
            ? "Close"
            : "Edit"}
        </button>

        {isUploading ? (
          <button
            type="button"
            className="upload-item-action"
            onClick={() =>
              onCancel(item.id)
            }
          >
            Cancel
          </button>
        ) : null}

        {isFailed ||
        item.status === "cancelled" ? (
          <button
            type="button"
            className="upload-item-action"
            disabled={disabled}
            onClick={() =>
              onRetry(item.id)
            }
          >
            Retry
          </button>
        ) : null}

        {!isUploading &&
        !isSuccess ? (
          <button
            type="button"
            className="upload-item-action upload-item-action--danger"
            disabled={disabled}
            onClick={() =>
              onRemove(item.id)
            }
          >
            Remove
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="upload-metadata-editor">
          <label>
            Title

            <input
              value={item.title}
              disabled={
                disabled ||
                isUploading
              }
              onChange={(event) =>
                onUpdate(item.id, {
                  title:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            Artist

            <input
              value={item.artist}
              disabled={
                disabled ||
                isUploading
              }
              onChange={(event) =>
                onUpdate(item.id, {
                  artist:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            Album

            <input
              value={item.album}
              disabled={
                disabled ||
                isUploading
              }
              onChange={(event) =>
                onUpdate(item.id, {
                  album:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            Duration

            <input
              type="number"
              min="0"
              value={item.duration}
              disabled={
                disabled ||
                isUploading
              }
              onChange={(event) =>
                onUpdate(item.id, {
                  duration:
                    Number(
                      event.target.value,
                    ) || 0,
                })
              }
            />
          </label>
        </div>
      ) : null}
    </article>
  );
}