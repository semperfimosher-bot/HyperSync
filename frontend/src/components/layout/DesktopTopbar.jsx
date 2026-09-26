import Icon from "../ui/Icon.jsx";
import Avatar from "../profile/Avatar.jsx";
import { PAGE_TITLES } from "../../constants.js";

import {
  getGreetingName,
} from "../../utils/user.js";


function DesktopTopbar({
  activePage,
  searchQuery,
  onSearchChange,
  onSearchFocus,
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const isAdminPage =
    String(
      activePage ?? "",
    ).startsWith(
      "admin",
    );


  function handleProfileClick() {
    if (currentUser) {
      onNavigate("profile");
      return;
    }

    onOpenAuth();
  }


  return (
    <header className="desktop-topbar">
      <div className="desktop-topbar__title">
        <span>HyperSynced</span>

        <h1>
          {PAGE_TITLES[activePage]}
        </h1>
      </div>


      {isAdminPage ? (
        <div
          className="desktop-search-spacer"
          aria-hidden="true"
        />
      ) : (
        <label className="desktop-search">
          <Icon
            name="search"
            size={18}
          />

          <input
            type="search"
            name="hypersync_global_search"
            autoComplete="off"
            enterKeyHint="search"
            value={searchQuery}
            placeholder="Search songs, artists, genres, or type a vibe..."
            data-1p-ignore="true"
            data-lpignore="true"
            onPointerDown={() => {
              onSearchFocus?.();
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter"
              ) {
                event.currentTarget
                  .blur();

                onSearchFocus?.();

                return;
              }

              if (
                event.key === "Tab" ||
                event.key === "Shift" ||
                event.key === "Control" ||
                event.key === "Alt" ||
                event.key === "Meta"
              ) {
                return;
              }

              onSearchFocus?.();
            }}
            onChange={(event) => {
              onSearchChange(
                event.target.value,
              );
            }}
          />
        </label>
      )}


      <button
        className="desktop-profile-button"
        type="button"
        onClick={handleProfileClick}
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
          <span className="avatar avatar--tiny">
            G
          </span>
        )}

        <span>
          {currentUser
            ? greetingName
            : "Guest"}
        </span>

        <Icon
          name="chevron"
          size={15}
        />
      </button>
    </header>
  );
}


export default DesktopTopbar;
