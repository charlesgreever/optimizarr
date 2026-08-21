import { formatSize, type LibraryRow } from "../api";
import { libraryRowView } from "../library-row";
import { RowActions } from "./RowActions";

export function LibraryMediaHeaders({ onQuality, onSize }: { onQuality?: () => void; onSize?: () => void }) {
  return (
    <>
      <th>{onQuality ? <button type="button" onClick={onQuality}>Quality</button> : "Quality"}</th>
      <th>Codec</th>
      <th>{onSize ? <button type="button" onClick={onSize}>Size</button> : "Size"}</th>
      <th>Audio</th>
      <th>Subtitles</th>
      <th>Plan</th>
      <th>Actions</th>
    </>
  );
}

export function LibraryMediaCells({ item, onDone }: { item: LibraryRow; onDone: () => void }) {
  const view = libraryRowView(item);
  return (
    <>
      <td>{item.quality || "—"}</td>
      <td className="text-sm">{view.video}</td>
      <td>{formatSize(item.sizeBytes)}</td>
      <td className="max-w-40 text-sm">{view.audio}</td>
      <td className="max-w-40 text-sm">{view.subtitles}</td>
      <td className="max-w-xs text-sm text-slate-300">
        {view.planLines.map((line, index) => <div key={`${index}:${line}`}>{line}</div>)}
      </td>
      <td><RowActions item={item} onDone={onDone} /></td>
    </>
  );
}
