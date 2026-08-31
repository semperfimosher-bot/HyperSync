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
  };
}


export async function readEmbeddedAudioMetadata(
  file,
) {
  const empty = {
    title: "",
    artist: "",
    album: "",
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
           * The upload preview only needs
           * textual metadata. Artwork is
           * still handled by the backend.
           */
          skipCovers: true,
        },
      );

    const common =
      metadata?.common ?? {};

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

  return {
    id:
      crypto.randomUUID(),

    file,

    ...metadata,

    duration,

    progress: 0,

    status:
      "queued",

    error: "",

    response: null,
  };
}
