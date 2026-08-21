import type { SettingsPayload } from "../api";

type EncodeSettingsData = Pick<
  SettingsPayload,
  "videoTarget" | "concurrency" | "conservativeMode" | "offPeakEnabled" | "offPeakStart" | "offPeakEnd"
>;

export function EncodeSettings({
  data,
  hardwareLabel,
  onChange,
  onSave,
}: {
  data: EncodeSettingsData;
  hardwareLabel: string;
  onChange: (patch: Partial<EncodeSettingsData>) => void;
  onSave: () => void;
}) {
  return (
    <div className="glass space-y-3 p-4">
      <h2 className="font-semibold">Encode</h2>
      <p className="help">Detected hardware: {hardwareLabel}</p>
      <label className="block text-sm">
        Target
        <select className="ml-2" value={data.videoTarget} onChange={(event) => {
          const target = event.target.value;
          if (target === "hevc" || target === "av1") onChange({ videoTarget: target });
        }}>
          <option value="hevc">HEVC</option>
          <option value="av1">AV1</option>
        </select>
      </label>
      <label className="block text-sm">
        Concurrent jobs
        <input
          className="ml-2 w-16"
          type="number"
          min={1}
          value={data.concurrency}
          onChange={(event) => onChange({ concurrency: Number(event.target.value) })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.conservativeMode}
          onChange={(event) => onChange({ conservativeMode: event.target.checked })}
        />
        Conservative performance mode (does not change job count)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.offPeakEnabled}
          onChange={(event) => onChange({ offPeakEnabled: event.target.checked })}
        />
        Hold jobs outside off-peak
      </label>
      <div className="text-sm">
        <input value={data.offPeakStart} onChange={(event) => onChange({ offPeakStart: event.target.value })} />
        <span className="mx-2">to</span>
        <input value={data.offPeakEnd} onChange={(event) => onChange({ offPeakEnd: event.target.value })} />
      </div>
      <button className="btn" type="button" onClick={onSave}>Save encode settings</button>
    </div>
  );
}
