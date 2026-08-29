import BrandLogo from "../ui/BrandLogo.jsx";
import Icon from "../ui/Icon.jsx";
import Avatar from "../profile/Avatar.jsx";


function MobileHeader({
  title,
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
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

        <button
          className="icon-button mobile-notification-button"
          type="button"
          onClick={onOpenAuth}
          aria-label="Open notifications"
        >
          <Icon
            name="bell"
            size={18}
          />

          <span
            className="icon-button__dot"
            aria-hidden="true"
          />
        </button>
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
