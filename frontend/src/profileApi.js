import {
  apiRequest,
} from "./api/client.js";


export async function getMyProfile() {
  return apiRequest(
    "/users/me",
  );
}


export async function updateMyProfile(
  {
    displayName,
    bio,
  },
) {
  return apiRequest(
    "/users/me/profile",
    {
      method: "PATCH",

      body: JSON.stringify({
        display_name:
          displayName,

        bio,
      }),
    },
  );
}


export async function updatePrivacy(
  isPublic,
) {
  return apiRequest(
    "/users/me/privacy",
    {
      method: "PATCH",

      body: JSON.stringify({
        is_public:
          isPublic,
      }),
    },
  );
}


export async function getPublicProfile(
  username,
) {
  return apiRequest(
    `/users/${encodeURIComponent(
      username,
    )}`,
  );
}


export async function followUser(
  username,
) {
  return apiRequest(
    `/users/${encodeURIComponent(
      username,
    )}/follow`,
    {
      method: "POST",
    },
  );
}


export async function unfollowUser(
  username,
) {
  return apiRequest(
    `/users/${encodeURIComponent(
      username,
    )}/follow`,
    {
      method: "DELETE",
    },
  );
}
