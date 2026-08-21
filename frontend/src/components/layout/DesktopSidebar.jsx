function DesktopSidebar({
  activePage,
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const isAdmin =
    isAdminUser(currentUser);

  return (
    <aside className="desktop-sidebar">
      <BrandLogo idPrefix="desktop-logo" />

      <nav
        className="desktop-nav"
        aria-label="Desktop navigation"
      >
        <span className="desktop-nav__label">
          Menu
        </span>

        {NAV_ITEMS.map((item) => (
          <button
            className={
              activePage === item.id
                ? "desktop-nav__item is-active"
                : "desktop-nav__item"
            }
            type="button"
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            <Icon
              name={item.icon}
              size={20}
            />

            <span>{item.label}</span>
          </button>
        ))}
        {isAdmin ? (
  <>
    <span
      className={
        "desktop-nav__label " +
        "desktop-nav__label--admin"
      }
    >
      Admin
    </span>

    {ADMIN_NAV_ITEMS.map((item) => (
      <button
        className={
          activePage === item.id
            ? "desktop-nav__item is-active"
            : "desktop-nav__item"
        }
        type="button"
        key={item.id}
        onClick={() => {
          onNavigate(item.id);
        }}
      >
        <Icon
          name={item.icon}
          size={20}
        />

        <span>{item.label}</span>
      </button>
    ))}
  </>
) : null}
      </nav>

      <div className="desktop-sidebar__spacer" />

    </aside>
  );
}

export default DesktopSidebar
