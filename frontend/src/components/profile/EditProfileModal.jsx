import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  removeProfileAvatar,
  updateMyProfile,
  updatePrivacy,
  uploadProfileAvatar,
} from "../../profileApi.js";

import Avatar from "./Avatar.jsx";
import Icon from "../ui/Icon.jsx";


const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_SIZE =
  5 * 1024 * 1024;


export default function EditProfileModal({
  profile,
  onClose,
  onSaved,
}) {
  const inputRef = useRef(null);

  const [displayName, setDisplayName] =
    useState(
      profile.display_name || "",
    );

  const [bio, setBio] =
    useState(
      profile.bio || "",
    );

  const [
    musicActivityPublic,
    setMusicActivityPublic,
  ] = useState(
    Boolean(
      profile.music_activity_public,
    ),
  );

  const [selectedFile, setSelectedFile] =
    useState(null);

  const [previewUrl, setPreviewUrl] =
    useState("");

  const [
    removeRequested,
    setRemoveRequested,
  ] = useState(false);

  const [dragging, setDragging] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");


  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(
          previewUrl,
        );
      }
    };
  }, [previewUrl]);


  function chooseFile(file) {
    setError("");

    if (!file) {
      return;
    }

    if (
      !ALLOWED_TYPES.has(
        file.type,
      )
    ) {
      setError(
        "Choose a JPG, PNG, or WebP image.",
      );

      return;
    }

    if (file.size > MAX_SIZE) {
      setError(
        "Profile pictures must be 5 MB or smaller.",
      );

      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(
        previewUrl,
      );
    }

    setSelectedFile(file);

    setPreviewUrl(
      URL.createObjectURL(file),
    );

    setRemoveRequested(false);
  }


  function removePicture() {
    if (previewUrl) {
      URL.revokeObjectURL(
        previewUrl,
      );
    }

    setPreviewUrl("");
    setSelectedFile(null);
    setRemoveRequested(true);
  }


  async function save() {
    const cleanName =
      displayName.trim();

    if (!cleanName) {
      setError(
        "Display name cannot be empty.",
      );

      return;
    }

    setSaving(true);
    setError("");

    try {
      let updated =
        await updateMyProfile({
          displayName: cleanName,
          bio: bio.trim() || null,
        });

      if (
        musicActivityPublic !==
        Boolean(
          profile.music_activity_public,
        )
      ) {
        updated =
          await updatePrivacy(
            musicActivityPublic,
          );
      }

      if (removeRequested) {
        updated =
          await removeProfileAvatar();
      }

      if (selectedFile) {
        updated =
          await uploadProfileAvatar(
            selectedFile,
          );
      }

      onSaved(updated);

      onClose();

    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save profile.",
      );

    } finally {
      setSaving(false);
    }
  }


  const shownAvatar =
    removeRequested
      ? null
      : previewUrl ||
        profile.avatar_url;


  return (
    <div
      className="hs-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget &&
          !saving
        ) {
          onClose();
        }
      }}
    >
      <section
        className="hs-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-profile-title"
      >
        <header className="hs-edit-modal__header">
          <div>
            <span className="hs-eyebrow">
              HYPERSYNCED IDENTITY
            </span>

            <h2 id="edit-profile-title">
              Edit Profile
            </h2>

            <p>
              Make your corner of
              HyperSynced unmistakably yours.
            </p>
          </div>

          <button
            className="hs-icon-button"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <Icon
              name="close"
              size={19}
            />
          </button>
        </header>


        <div className="hs-edit-modal__body">
          <div className="hs-avatar-editor">
            <div className="hs-avatar-editor__preview">
              <Avatar
                src={shownAvatar}
                name={displayName}
                size="hero"
                cacheKey={
                  previewUrl
                    ? ""
                    : Date.now()
                }
              />

              <span className="hs-avatar-editor__glow" />
            </div>

            <div>
              <strong>
                Profile Picture
              </strong>

              <p>
                JPG, PNG or WebP.
                Maximum 5 MB.
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                chooseFile(
                  event.target.files?.[0],
                );
              }}
            />

            <div
              className={
                dragging
                  ? "hs-upload-zone is-dragging"
                  : "hs-upload-zone"
              }
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => {
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);

                chooseFile(
                  event.dataTransfer
                    .files?.[0],
                );
              }}
            >
              <Icon
                name="plus"
                size={22}
              />

              <strong>
                Drop a new picture here
              </strong>

              <span>
                or choose one from your device
              </span>

              <button
                className="hs-primary-button"
                type="button"
                onClick={() => {
                  inputRef.current?.click();
                }}
              >
                <Icon
                  name="edit"
                  size={16}
                />

                Upload New Photo
              </button>
            </div>

            {(profile.avatar_url ||
              selectedFile) &&
            !removeRequested ? (
              <button
                className="hs-danger-link"
                type="button"
                onClick={removePicture}
              >
                Remove Profile Picture
              </button>
            ) : null}
          </div>


          <div className="hs-edit-fields">
            <label className="hs-field">
              <span>
                Display Name

                <small>
                  {displayName.length}/80
                </small>
              </span>

              <input
                value={displayName}
                maxLength={80}
                onChange={(event) => {
                  setDisplayName(
                    event.target.value,
                  );
                }}
                placeholder="Your display name"
              />
            </label>


            <label className="hs-field">
              <span>
                Bio

                <small>
                  {bio.length}/500
                </small>
              </span>

              <textarea
                value={bio}
                maxLength={500}
                rows={5}
                onChange={(event) => {
                  setBio(
                    event.target.value,
                  );
                }}
                placeholder="Tell people what you're listening to..."
              />
            </label>


            <div className="hs-privacy-card">
              <div className="hs-privacy-card__icon">
                <Icon
                  name="shield"
                  size={20}
                />
              </div>

              <div>
                <strong>
                  Public Music Activity
                </strong>

                <p>
                  When enabled, anyone can
                  see your listening stats,
                  top artists, and recently
                  played music. When disabled,
                  only accepted followers can.
                </p>
              </div>

              <button
                className={
                  musicActivityPublic
                    ? "hs-switch is-on"
                    : "hs-switch"
                }
                type="button"
                role="switch"
                aria-checked={
                  musicActivityPublic
                }
                onClick={() => {
                  setMusicActivityPublic(
                    (value) => !value,
                  );
                }}
              >
                <span />
              </button>
            </div>


            <div className="hs-privacy-preview">
              <Icon
                name={
                  musicActivityPublic
                    ? "people"
                    : "lock"
                }
                size={18}
              />

              <div>
                <strong>
                  {musicActivityPublic
                    ? "Everyone can see your music profile"
                    : "Music activity protected"}
                </strong>

                <p>
                  Your avatar,
                  username, follower count,
                  and account age always
                  remain discoverable.
                </p>
              </div>
            </div>


            {error ? (
              <p
                className="hs-form-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        </div>


        <footer className="hs-edit-modal__footer">
          <button
            className="hs-secondary-button"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="hs-primary-button hs-primary-button--large"
            type="button"
            disabled={saving}
            onClick={save}
          >
            <Icon
              name={
                saving
                  ? "chart"
                  : "check"
              }
              size={17}
            />

            {saving
              ? "Saving Profile..."
              : "Save Changes"}
          </button>
        </footer>
      </section>
    </div>
  );
}
