import DesktopSidebar from "./DesktopSidebar";

function DesktopTopbar({
  activePage,
  searchQuery,
  onSearchChange,
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const userInitial =
    getUserInitial(currentUser);

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
        <span>HyperSync</span>
        <h1>{PAGE_TITLES[activePage]}</h1>
      </div>

      <label className="desktop-search">
        <Icon
          name="search"
          size={18}
        />

        <input
          type="search"
          value={searchQuery}
          placeholder="Search songs, artists, or albums"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
        />
      </label>

      <button
        className="desktop-profile-button"
        type="button"
        onClick={handleProfileClick}
      >
        <span className="avatar avatar--tiny">
          {userInitial}
        </span>

        <span>
          {currentUser ? greetingName : "Guest"}
        </span>

        <Icon
          name="chevron"
          size={15}
        />
      </button>
    </header>
  );
}

export default DesktopTopbar
