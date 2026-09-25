function removeExtension(
  fileName,
) {
  return fileName.replace(
    /\.[^/.]+$/,
    "",
  );
}


function parseFileName(
  fileName,
) {
  const cleanName =
    removeExtension(
      fileName,
    )
      .replace(
        /[_]+/g,
        " ",
      )
      .replace(
        /\s+/g,
        " ",
      )
      .trim();

  const parts =
    cleanName
      .split(
        /\s+-\s+/,
      )
      .map(
        (part) =>
          part.trim(),
      )
      .filter(Boolean);

  if (
    parts.length >= 2
  ) {
    return {
      artist:
        parts[0],

      title:
        parts
          .slice(1)
          .join(" - "),
    };
  }

  return {
    artist:
      "Unknown Artist",

    title:
      cleanName ||
      "Untitled Track",
  };
}


export function buildInitialMetadata(
  fileName,
) {
  const parsed =
    parseFileName(
      fileName,
    );

  return {
    title:
      parsed.title,

    artist:
      parsed.artist,

    // Do NOT invent an album.
    album: "",

    metadataEdited: {
      title: false,
      artist: false,
      album: false,
      duration: false,
    },
  };
}

function cleanEmbeddedValue(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value.trim();
}


export function mergeEmbeddedMetadata(
  initialMetadata,
  embeddedMetadata,
) {
  const embedded =
    embeddedMetadata ?? {};

  const edited =
    initialMetadata
      .metadataEdited ?? {};

  const embeddedTitle =
    cleanEmbeddedValue(
      embedded.title,
    );

  const embeddedArtist =
    cleanEmbeddedValue(
      embedded.artist,
    );

  const embeddedAlbum =
    cleanEmbeddedValue(
      embedded.album,
    );

  return {
    ...initialMetadata,

    title:
      !edited.title &&
      embeddedTitle
        ? embeddedTitle
        : initialMetadata.title,

    artist:
      !edited.artist &&
      embeddedArtist
        ? embeddedArtist
        : initialMetadata.artist,

    album:
      !edited.album &&
      embeddedAlbum
        ? embeddedAlbum
        : initialMetadata.album,

    genre:
      cleanEmbeddedValue(
        embedded.genre,
      ),

    bitrateKbps:
      Number.isFinite(
        embedded.bitrateKbps,
      )
        ? embedded.bitrateKbps
        : null,

    artworkBlob:
      embedded.artworkBlob ??
      null,

    artworkMimeType:
      cleanEmbeddedValue(
        embedded
          .artworkMimeType,
      ),
  };
}


export async function readEmbeddedAudioMetadata(
  file,
) {
  const empty = {
    title: "",
    artist: "",
    album: "",
    genre: "",
    bitrateKbps: null,
    artworkBlob: null,
    artworkMimeType: "",
  };

  if (!file) {
    return empty;
  }

  try {
    /*
     * Dynamic import means the metadata
     * parser only needs to load when an
     * admin actually selects music.
     */
    const {
      parseBlob,
    } = await import(
      "music-metadata"
    );

    const metadata =
      await parseBlob(
        file,
        {
          /*
           * One metadata pass feeds both the
           * preview and the optional direct-B2
           * fast path. Keeping the embedded
           * cover here avoids sending the whole
           * audio file through the API just to
           * extract artwork.
           */
          skipCovers: false,
        },
      );

    const common =
      metadata?.common ?? {};

    const picture =
      Array.isArray(
        common.picture,
      )
        ? common.picture[0]
        : null;

    const artworkMimeType =
      cleanEmbeddedValue(
        picture?.format,
      );

    const artworkBlob =
      picture?.data &&
      artworkMimeType
        ? new Blob(
            [
              picture.data,
            ],
            {
              type:
                artworkMimeType,
            },
          )
        : null;

    const genre =
      Array.isArray(
        common.genre,
      )
        ? cleanEmbeddedValue(
            common.genre[0],
          )
        : cleanEmbeddedValue(
            common.genre,
          );

    const bitrate =
      Number(
        metadata?.format
          ?.bitrate,
      );

    return {
      title:
        cleanEmbeddedValue(
          common.title,
        ),

      artist:
        cleanEmbeddedValue(
          common.artist,
        ),

      album:
        cleanEmbeddedValue(
          common.album,
        ),

      genre,

      bitrateKbps:
        Number.isFinite(
          bitrate,
        ) &&
        bitrate > 0
          ? bitrate / 1000
          : null,

      artworkBlob,
      artworkMimeType,
    };
  } catch {
    /*
     * Missing/broken tags must never
     * prevent someone from uploading.
     *
     * Filename parsing remains the
     * fallback.
     */
    return empty;
  }
}

export function applyManualMetadataEdit(
  item,
  patch,
) {
  const edited = {
    ...(
      item.metadataEdited
      ?? {}
    ),
  };

  for (
    const field of [
      "title",
      "artist",
      "album",
      "duration",
    ]
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          patch,
          field,
        )
    ) {
      edited[field] =
        true;
    }
  }

  return {
    ...item,
    ...patch,

    metadataEdited:
      edited,
  };
}


function getAudioDuration(
  file,
) {
  return new Promise(
    (resolve) => {
      const audio =
        document
          .createElement(
            "audio",
          );

      const objectUrl =
        URL.createObjectURL(
          file,
        );

      const cleanup = () => {
        URL.revokeObjectURL(
          objectUrl,
        );
      };

      audio.preload =
        "metadata";

      audio.onloadedmetadata =
        () => {
          const duration =
            Number.isFinite(
              audio.duration,
            )
              ? Math.round(
                  audio.duration,
                )
              : 0;

          cleanup();

          resolve(
            duration,
          );
        };

      audio.onerror =
        () => {
          cleanup();

          resolve(0);
        };

      audio.src =
        objectUrl;
    },
  );
}


export async function createUploadItem(
  file,
) {
  const initialMetadata =
  buildInitialMetadata(
    file.name,
  );

const [
  embeddedMetadata,
  duration,
] = await Promise.all([
  readEmbeddedAudioMetadata(
    file,
  ),

  getAudioDuration(
    file,
  ),
]);

const metadata =
  mergeEmbeddedMetadata(
    initialMetadata,
    embeddedMetadata,
  );

  const estimatedBitrateKbps =
    Number.isFinite(
      metadata.bitrateKbps,
    ) &&
    metadata.bitrateKbps > 0
      ? metadata.bitrateKbps
      : (
          duration > 0 &&
          file.size > 0
            ? (
                file.size *
                8 /
                duration /
                1000
              )
            : null
        );

  return {
    id:
      crypto.randomUUID(),

    file,

    ...metadata,

    bitrateKbps:
      estimatedBitrateKbps,

    duration,

    progress: 0,

    status:
      "queued",

    error: "",

    response: null,
  };
}
