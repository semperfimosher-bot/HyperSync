export function isAccessTokenExpired(
  token,
  skewMs = 10_000,
) {
  if (!token) {
    return true;
  }

  try {
    const segment = token.split(".")[1];

    if (!segment) {
      return true;
    }

    const payload = JSON.parse(
      atob(
        segment
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
      ),
    );

    if (!payload.exp) {
      return false;
    }

    return (
      payload.exp * 1000 <=
      Date.now() + skewMs
    );
  } catch {
    return true;
  }
}
