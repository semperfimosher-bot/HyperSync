import {
  NAV_ITEMS,
} from "../../constants.js";

import Icon from
  "../ui/Icon.jsx";


export default function MobileBottomNav({
  activePage,
  onNavigate,
  currentUser,
}) {
  const mobileActivePage =
    activePage === "messages"
      ? "search"
      : activePage;

  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS
        .filter(
          (item) =>
            item.id !== "messages" &&
            (
              !item.requiresAuth ||
              currentUser?.account_type ===
                "registered"
            ),
        )
        .map((item) => (
        <button
          className={
            mobileActivePage === item.id
              ? "is-active"
              : ""
          }
          type="button"
          key={item.id}
          onClick={() => {
            onNavigate(item.id);
          }}
          aria-current={
            mobileActivePage === item.id
              ? "page"
              : undefined
          }
        >
          <Icon
            name={item.icon}
            size={20}
          />

          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
