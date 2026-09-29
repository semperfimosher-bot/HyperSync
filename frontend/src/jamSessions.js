import { apiRequest } from "./api/client.js";

async function request(path, method = "GET", body) {
  const startedAt = Date.now();
  const data = await apiRequest(`/jams${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return data?.server_time ? { ...data, received_at_ms: Date.now(),
    latency_ms: Date.now() - startedAt } : data;
}

export const getCurrentJam = () => request("/current");
export const createJam = (mode) => request("", "POST", { mode });
export const joinJam = (invite_code) => request("/join", "POST", { invite_code });
export const jamAction = (jam, path, body, method = "POST") =>
  request(`/${jam.id}${path}`, method, { revision: jam.revision, ...body });

export function shouldApplyJamRefresh(requestUserId, activeUserId, previous, current, next) {
  if (requestUserId !== activeUserId) return false;
  if (current !== previous && (!next || next.id !== current?.id)) return false;
  if (next && current?.id === next.id && next.revision < current.revision) return false;
  return true;
}
