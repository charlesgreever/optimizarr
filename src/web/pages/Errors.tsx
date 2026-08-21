import { api, type FileError } from "../api";
import { PagedListControls } from "../components/PagedListControls";
import { Help, PageHead } from "../components/Shell";
import { usePagedList } from "../use-paged-list";

export function ErrorsPage() {
  const list = usePagedList({ loadPage: api.errors, keyOf: (row: FileError) => row.path });
  const items = list.items;
  return (
    <section>
      <PageHead title="Errors" />
      <Help>Each row is one file Polisharr could not read or probe. The count is distinct files, not retry attempts.</Help>
      {items.length === 0 && list.loading && <div className="empty">Loading errors…</div>}
      {items.length === 0 && !list.loading && !list.error && <div className="empty">No unread files. Nothing needs attention here.</div>}
      {items.length > 0 && (
        <div className="glass mt-5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>File</th>
                <th>Path</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.path}>
                  <td>{row.displayTitle}</td>
                  <td>{row.fileName}</td>
                  <td className="text-xs text-slate-400">{row.path}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PagedListControls loading={list.loading} error={list.error} nextOffset={list.nextOffset} noun="errors" onLoadMore={list.loadMore} onRetry={list.reload} />
    </section>
  );
}
