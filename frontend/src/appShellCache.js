/** Precached same-origin assets have no Origin header until loaded as CORS modules.
 * Reuse only the Origin variant; preserve all user-dependent cache distinctions.
 */
export async function matchAppShell(cache, request, origin) {
  const exact = await cache.match(request);
  if (exact) return exact;
  if (new URL(request.url).origin !== origin) return undefined;
  const candidate = await cache.match(request, { ignoreVary: true });
  return candidate?.headers.get('Vary')?.trim().toLowerCase() === 'origin'
    ? candidate : undefined;
}
