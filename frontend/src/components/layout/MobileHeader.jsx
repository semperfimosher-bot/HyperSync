import BrandLogo from "../ui/BrandLogo.jsx";
import Icon from "../ui/Icon.jsx";
import Avatar from "../profile/Avatar.jsx";
import PlaylistUpdateNotice from "../ui/PlaylistUpdateNotice.jsx";
import MessageNotificationPanel from "../ui/MessageNotificationPanel.jsx";

import { useEffect, useState } from "react";


function MobileHeader({
  title,
  currentUser,
  onNavigate,
  onOpenAuth,
  playlistUpdate,
  onDownloadPlaylistUpdate,
  onDismissPlaylistUpdate,
  messageNotifications,
  onOpenMessage,
  onOpenNotification,
  onEnablePush,
  pushBusy,
  pushEnabled,
}) {
  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);

  useEffect(() => {
    if (
      !playlistUpdate &&
      !messageNotifications?.unread_count
    ) {
      setNotificationsOpen(
        false,
      );
    }
  }, [
    playlistUpdate,
    messageNotifications?.unread_count,
  ]);
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

            {playlistUpdate ||
            messageNotifications?.unread_count ? (
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
                  }}
                />
              ) : null}

              <MessageNotificationPanel
                data={
                  messageNotifications
                }
                onOpenNotification={(
                  notification,
                ) => {
                  setNotificationsOpen(
                    false,
                  );

                  onOpenNotification?.(
                    notification,
                  );
                }}
                onEnablePush={
                  onEnablePush
                }
                pushBusy={
                  pushBusy
                }
                pushEnabled={
                  pushEnabled
                }
              />
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
