import {
  useRef,
  useState,
} from "react";

import Icon from "../ui/Icon.jsx";

export default function UploadDropzone({
  onFiles,
  disabled,
}) {
  const inputRef = useRef(null);

  const [isDragging, setIsDragging] =
    useState(false);

  const handleFiles = (files) => {
    if (
      disabled ||
      !files ||
      files.length === 0
    ) {
      return;
    }

    onFiles(files);
  };

  return (
    <section
      className={
        "upload-dropzone" +
        (isDragging
          ? " upload-dropzone--active"
          : "") +
        (disabled
          ? " upload-dropzone--disabled"
          : "")
      }
      onDragOver={(event) => {
        event.preventDefault();

        if (!disabled) {
          setIsDragging(true);
        }
      }}
      onDragLeave={() => {
        setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();

        setIsDragging(false);

        handleFiles(
          event.dataTransfer.files,
        );
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);

          event.target.value = "";
        }}
      />

      <div className="upload-dropzone__icon">
        <Icon
          name="plus"
          size={30}
        />
      </div>

      <div className="upload-dropzone__copy">
        <strong>
          Drop your music here
        </strong>

        <span>
          MP3, WAV, FLAC, M4A, AAC and OGG
        </span>
      </div>

      <button
        type="button"
        className="upload-browse-button"
        disabled={disabled}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        Browse Files
      </button>

      <small>
        Add multiple tracks, review metadata,
        then upload the entire queue.
      </small>
    </section>
  );
}
