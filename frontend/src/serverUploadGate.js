// Serialize memory-intensive server work within this browser tab. Direct B2
// transfers remain parallel; POST results are never automatically replayed.
const pending = [];
let active = false;

function abortError() {
  return new DOMException("Upload cancelled.", "AbortError");
}

function drain() {
  if (active || !pending.length) return;
  const job = pending.shift();
  job.started = true;
  job.signal?.removeEventListener("abort", job.abort);
  if (job.signal?.aborted) {
    job.reject(abortError());
    drain();
    return;
  }
  active = true;
  Promise.resolve().then(job.action).then(job.resolve, job.reject).finally(() => {
    active = false;
    drain();
  });
}

export function runServerUpload(action, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const job = { action, signal, resolve, reject, started: false };
    job.abort = () => {
      if (job.started) return;
      const index = pending.indexOf(job);
      if (index >= 0) pending.splice(index, 1);
      reject(abortError());
    };
    signal?.addEventListener("abort", job.abort, { once: true });
    pending.push(job);
    drain();
  });
}
