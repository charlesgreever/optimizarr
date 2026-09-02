import { FIELD_CONTROL } from "../settings-copy";

export function AudioMixSelect({
  value,
  disabled,
  onChange,
}: {
  value: "stereo" | "surround" | null;
  disabled?: boolean;
  onChange: (value: "stereo" | "surround" | null) => void;
}) {
  return (
    <label className="block min-w-[11rem] text-sm">
      <span className="mb-1 block font-medium text-muted">Preferred audio</span>
      <select
        className={FIELD_CONTROL}
        value={value ?? ""}
        disabled={disabled}
        aria-label="Preferred audio"
        onChange={(event) => {
          const next = event.target.value;
          if (next === "stereo" || next === "surround") onChange(next);
          else onChange(null);
        }}
      >
        <option value="">House default</option>
        <option value="stereo">Prefer stereo</option>
        <option value="surround">Keep surround</option>
      </select>
    </label>
  );
}
