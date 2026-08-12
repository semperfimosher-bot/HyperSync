export function getGreetingName(user) {
  const rawName =
    user?.displayName ??
    user?.display_name ??
    user?.username ??
    "Guest";

  const cleanedName =
    String(rawName).trim();

  if (!cleanedName) {
    return "Guest";
  }

  return cleanedName.split(/\s+/)[0];
}

export function getUserInitial(user) {
  const name = getGreetingName(user);

  if (name === "Guest") {
    return "G";
  }

  return name.charAt(0).toUpperCase();
}

export function getTimeGreeting() {
  const hour =
    new Date().getHours();

  if (hour < 12) {
    return "good morning";
  }

  if (hour < 18) {
    return "good afternoon";
  }

  return "good evening";
}

export function isAdminUser(user) {
  return Boolean(
    user &&
    user.role === "admin",
  );
}
