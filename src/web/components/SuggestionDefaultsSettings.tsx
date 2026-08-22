import type { SettingsPayload } from "../api";

type SuggestionDefaults = SettingsPayload["suggestionDefaults"];

export function SuggestionDefaultsSettings({
  value,
  onChange,
  onSave,
}: {
  value: SuggestionDefaults;
  onChange: (value: SuggestionDefaults) => void;
  onSave: () => void;
}) {
  const checkbox = (field: keyof SuggestionDefaults, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value[field]}
        onChange={(event) => onChange({ ...value, [field]: event.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-2 border-t border-white/10 pt-3">
      <h3 className="font-semibold">Default suggestion operations</h3>
      {checkbox("removeNonPreferredSubtitles", "Remove non-preferred subtitles")}
      {checkbox("removeNonPreferredAudio", "Remove non-preferred audio tracks")}
      {checkbox("addStereo", "Add stereo from surround audio")}
      {checkbox("transcodeToSizeCap", "Transcode files over their size cap")}
      {checkbox("convertMp4ToMkv", "Convert MP4 to MKV")}
      <p className="help">These choices control automatic Suggestions. Force, Add stereo, and custom title plans stay available.</p>
      <button className="btn" type="button" onClick={onSave}>Save suggestion defaults</button>
    </div>
  );
}
