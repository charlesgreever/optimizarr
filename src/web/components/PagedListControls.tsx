export function PagedListControls(props: {
  loading: boolean;
  error: string;
  nextOffset: number | null;
  noun: string;
  onLoadMore: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {props.nextOffset !== null && (
        <button className="btn-secondary" type="button" disabled={props.loading} onClick={() => void props.onLoadMore()}>
          {props.loading ? "Loading…" : `Load more ${props.noun}`}
        </button>
      )}
      {props.error && (
        <>
          <span className="text-sm text-rose-400">{props.error}</span>
          <button className="btn-secondary" type="button" disabled={props.loading} onClick={() => void props.onRetry()}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
