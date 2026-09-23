import BrandLogo from "../ui/BrandLogo.jsx";
import Icon from "../ui/Icon.jsx";
import Avatar from "../profile/Avatar.jsx";
import PlaylistUpdateNotice from "../ui/PlaylistUpdateNotice.jsx";

import { useEffect, useState } from "react";


function MobileHeader({
  title,
  currentUser,
  onNavigate,
  onOpenAuth,
  playlistUpdate,
  onDownloadPlaylistUpdate,
  onDismissPlaylistUpdate,
}) {
  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);

  useEffect(() => {
    if (!playlistUpdate) {
      setNotificationsOpen(
        false,
      );
    }
  }, [playlistUpdate]);
  function openProfile() {
    if (currentUser) {
      onNavigate("profile");
      return;
    }

    onOpenAuth();
  }


  return (
    <header className="mobile-header">
      <div className="mobile-header__left">
        <BrandLogo
          idPrefix="mobile-logo"
          compact
        />

        <h1>{title}</h1>

        <div className="mobile-notification-center">
          <button
            className="icon-button mobile-notification-button"
            type="button"
            onClick={() => {
              if (!currentUser) {
                onOpenAuth();
                return;
              }

              setNotificationsOpen(
                (open) => !open,
              );
            }}
            aria-label="Open notifications"
            aria-expanded={
              notificationsOpen
            }
          >
            <Icon
              name="bell"
              size={18}
            />

            {playlistUpdate ? (
              <span
                className="icon-button__dot"
                aria-hidden="true"
              />
            ) : null}
          </button>

          {notificationsOpen ? (
            <div
              className="mobile-notification-panel"
              role="region"
              aria-label="Notifications"
            >
              {playlistUpdate ? (
                <PlaylistUpdateNotice
                  update={
                    playlistUpdate
                  }
                  variant="mobile-header"
                  onDownload={
                    onDownloadPlaylistUpdate
                  }
                  onDismiss={() => {
                    onDismissPlaylistUpdate?.();
                    setNotificationsOpen(
                      false,
                    );
                  }}
                />
              ) : (
                <div className="mobile-notification-empty">
                  <strong>
                    No new notifications
                  </strong>

                  <small>
                    Playlist download updates will appear here.
                  </small>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>


      <button
        className="mobile-profile-button"
        type="button"
        onClick={openProfile}
        aria-label={
          currentUser
            ? "Open your profile"
            : "Sign in"
        }
      >
        {currentUser ? (
          <Avatar
            src={currentUser.avatar_url}
            name={
              currentUser.display_name ||
              currentUser.username
            }
            size="header"
            className="hs-header-avatar"
          />
        ) : (
          <Icon
            name="profile"
            size={21}
          />
        )}
      </button>
    </header>
  );
}


export default MobileHeader;
