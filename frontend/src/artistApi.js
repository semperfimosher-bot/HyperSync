import {
  apiRequest,
} from "./api/client.js";


export async function getArtistProfile(
  artistName,
) {
  return apiRequest(
    "/artists/" +
      encodeURIComponent(
        artistName,
      ),
  );
}


export async function followArtist(
  artistName,
) {
  return apiRequest(
    "/artists/" +
      encodeURIComponent(
        artistName,
      ) +
      "/follow",
    {
      method:
        "POST",
    },
  );
}


export async function unfollowArtist(
  artistName,
) {
  return apiRequest(
    "/artists/" +
      encodeURIComponent(
        artistName,
      ) +
      "/follow",
    {
      method:
        "DELETE",
    },
  );
}
