import { formatSize, type LibraryRow } from "../api";
import { libraryRowView } from "../library-row";
import { RowActions } from "./RowActions";
import { Pill, PillList, PlanStatus, VideoLabel } from "./ui";

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
      <td className="whitespace-nowrap">
        {item.quality ? <Pill>{item.quality}</Pill> : <span className="text-muted">—</span>}
      </td>
      <td><VideoLabel label={view.video} /></td>
      <td className="whitespace-nowrap tabular-nums">{formatSize(item.sizeBytes)}</td>
      <td><PillList items={view.audioTracks} empty={view.audio} /></td>
      <td><PillList items={view.subtitleTracks} empty={view.subtitles} /></td>
      <td><PlanStatus lines={view.planLines} /></td>
      <td><RowActions item={item} onDone={onDone} /></td>
    </>
  );
}
