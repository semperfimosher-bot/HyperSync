const APP_PAGES =
  new Set([
    "home",
    "search",
    "library",
    "profile",
    "public-profile",
    "admin",
    "admin-bot",
    "admin-uploads",
    "admin-catalog",
  ]);


const ADMIN_APP_PAGES =
  new Set([
    "admin",
    "admin-bot",
    "admin-uploads",
    "admin-catalog",
  ]);


function homeState() {
  return {
    activePage:
      "home",

    searchQuery:
      "",

    profileUsername:
      "",
  };
}


export function normalizeAppViewState(
  state,
  role = "user",
) {
  const activePage =
    typeof state?.active_page
      === "string"
      ? state.active_page
      : "home";

  if (
    !APP_PAGES.has(
      activePage,
    )
  ) {
    return homeState();
  }

  if (
    ADMIN_APP_PAGES.has(
      activePage,
    ) &&
    role !== "admin"
  ) {
    return homeState();
  }

  const searchQuery =
    typeof state?.search_query
      === "string"
      ? state.search_query
      : "";

  const profileUsername =
    typeof
      state?.profile_username
      === "string"
      ? state.profile_username.trim()
      : "";

  if (
    activePage ===
      "public-profile" &&
    !profileUsername
  ) {
    return homeState();
  }

  return {
    activePage,

    searchQuery,

    profileUsername:
      activePage ===
      "public-profile"
        ? profileUsername
        : "",
  };
}
