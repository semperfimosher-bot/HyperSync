import { useState } from "react";
import { pageRows } from "../../pagination.js";

export function useRowPagination(rows, key) {
  const [position, setPosition] = useState({ key, page: 0 });
  return {
    ...pageRows(rows, position.key === key ? position.page : 0),
    setPage: (page) => setPosition({ key, page }),
  };
}

export default function RowPager({ view }) {
  if (view.pageCount <= 1) return null;
  return (
    <nav className="admin-explorer-selection-bar" aria-label="Catalog pages">
      <button type="button" disabled={view.page === 0} onClick={() => view.setPage(view.page - 1)}>Previous</button>
      <span>Page {view.page + 1} of {view.pageCount} · {view.total} items</span>
      <button type="button" disabled={view.page + 1 === view.pageCount} onClick={() => view.setPage(view.page + 1)}>Next</button>
    </nav>
  );
}
