function removeExtension(fileName) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function parseFileName(fileName) {
  const cleanName = removeExtension(fileName)
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleanName
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(" - "),
    };
  }

  return {
    artist: "Unknown Artist",
    title: cleanName || "Untitled Track",
  };
}

function getAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
    };

    audio.preload = "metadata";

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration)
        ? Math.round(audio.duration)
        : 0;

      cleanup();
      resolve(duration);
    };

    audio.onerror = () => {
      cleanup();
      resolve(0);
    };

    audio.src = objectUrl;
  });
}

export async function createUploadItem(file) {
  const metadata = parseFileName(file.name);

  const duration = await getAudioDuration(file);

  return {
    id: crypto.randomUUID(),
    file,
    title: metadata.title,
    artist: metadata.artist,
    album: "Single",
    duration,
    progress: 0,
    status: "queued",
    error: "",
    response: null,
  };
}