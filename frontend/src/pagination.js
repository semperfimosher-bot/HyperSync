export function pageRows(rows, requestedPage = 0) {
  const items = Array.isArray(rows) ? rows : [];
  const pageCount = Math.max(1, Math.ceil(items.length / 100));
  const page = Math.min(pageCount - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  return { items: items.slice(page * 100, (page + 1) * 100), page, pageCount, total: items.length };
}
