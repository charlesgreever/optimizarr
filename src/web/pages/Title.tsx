import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatSize, type ExecutablePlan, type InspectionReport, type LibraryRow } from "../api";
import { Help, PageHead } from "../components/Shell";
import { TitleFacts } from "../components/TitleFacts";
import { Pill } from "../components/ui";
import { audioActionSelectClass, audioChannelSelectClass, canQueueCustomPlan, titleOptimizeLocked } from "../title-plan";
import { channelLabel, fileNameFromPath, usefulTrackTitle } from "../title-display";

type AudioAction = "keep" | "remove" | "replace_aac" | "replace_downmix" | "add_downmix";

export function TitlePage() {
  const { id = "" } = useParams();
  const [item, setItem] = useState<LibraryRow | null>(null);
  const [av1, setAv1] = useState(false);
  const [writeDefault, setWriteDefault] = useState("sidecar");
  const [preferredLanguage, setPreferredLanguage] = useState("eng");
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<ExecutablePlan | null>(null);
  const [videoMode, setVideoMode] = useState<"copy" | "size" | "quality">("copy");
  const [targetGb, setTargetGb] = useState(4);
  const [quality, setQuality] = useState(22);
  const [codec, setCodec] = useState<"hevc" | "av1">("hevc");
  const [downscale, setDownscale] = useState(false);
  const [writeMode, setWriteMode] = useState<"default" | "sidecar" | "direct">("default");
  const [audio, setAudio] = useState<Record<number, { action: AudioAction; channels?: number }>>({});
  const [subs, setSubs] = useState<Record<number, "keep" | "remove">>({});

  const report = item?.report as InspectionReport | null | undefined;
  const is4k = (item?.resolution === "2160") || (report?.height ?? 0) >= 2160 || (report?.width ?? 0) >= 3840;
  const iso = (item?.path ?? "").toLowerCase().endsWith(".iso");
  const listed = report?.listingState === "complete";
  const fileName = fileNameFromPath(item?.path ?? "");

  useEffect(() => {
    void api.title(id).then((r) => {
      setItem(r.item);
      setAv1(r.hardware.av1);
      setWriteDefault(r.settings.writeMode);
      if (r.settings.preferredLanguage) setPreferredLanguage(r.settings.preferredLanguage);
      const nextAudio: Record<number, { action: AudioAction; channels?: number }> = {};
      const nextSubs: Record<number, "keep" | "remove"> = {};
      for (const t of r.item.report?.audio ?? []) nextAudio[t.index] = { action: "keep" };
      for (const t of r.item.report?.subtitles ?? []) nextSubs[t.index] = "keep";
      setAudio(nextAudio);
      setSubs(nextSubs);
    }).catch((e: Error) => setMsg(e.message));
  }, [id]);

  const draft = useMemo(() => ({
    remuxToMkv: iso,
    video: videoMode === "copy"
      ? { mode: "copy" }
      : videoMode === "size"
        ? { mode: "size", targetBytes: Math.round(targetGb * 1024 ** 3), codec, downscale1080p: downscale }
        : { mode: "quality", quality, codec, downscale1080p: downscale },
    audio: Object.entries(audio).map(([index, choice]) => ({ index: Number(index), ...choice })),
    subtitles: Object.entries(subs).map(([index, action]) => ({ index: Number(index), action })),
    writeMode,
  }), [iso, videoMode, targetGb, quality, codec, downscale, audio, subs, writeMode]);

  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => {
      void api.previewPlan(id, draft).then((r) => {
        setPlan(r.plan ?? null);
        setErrors((r.errors ?? []).map((e) => e.message).concat(r.error ? [r.error] : []));
      });
    }, 200);
    return () => clearTimeout(t);
  }, [draft, id, item]);

  if (!item) return <p className="help">{msg || "Loading title…"}</p>;

  const locked = titleOptimizeLocked(item);
  const queueReady = canQueueCustomPlan(plan, errors, locked);
  const usableAudio = (report?.audio ?? []).filter((track) => track.channels > 0);
  const onlyWrongLanguage = usableAudio.length === 1
    && (usableAudio[0]?.language ?? "und") !== "und"
    && (usableAudio[0]?.language ?? "und") !== preferredLanguage
    && !locked;
  const arrName = item.type === "episode" ? "Sonarr" : "Radarr";

  return (
    <section className="space-y-5">
      <PageHead title={item.displayTitle}>
        <Link className="btn-secondary" to={item.type === "movie" ? "/movies" : "/series"}>Back</Link>
      </PageHead>
      <Help>
        Custom work is optional. Bulk suggestions still exist. Queue stays off until the plan differs from the source.
        A sidecar is the new file waiting in Review until you Keep it. Direct write replaces the library file after an integrity check.
        Codec replace turns one soundtrack into AAC at the same layout. Downmix makes a smaller layout such as stereo.
        Size mode aims at a file size you type. Quality mode aims at an encoder quality number (lower is larger).
      </Help>
      {(locked || item.error) && (
        <p className="help">{item.error || "This title is still uninspected or unreadable. Optimize stays off until inspect finishes."}</p>
      )}
      {iso && !listed && !item.error && (
        <p className="help">Streams could not be listed yet. You can still remux this disc image to Matroska, or pick a size or quality encode.</p>
      )}
      <TitleFacts item={item} />

      {item.suggestion && (
        <Section title="Automatic suggestion">
          <ul className="space-y-1 text-sm leading-5 text-slate-300">
            {item.suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <button
            className="btn mt-1"
            type="button"
            disabled={locked}
            onClick={() => void api.queue({ itemId: item.id }).then(() => setMsg("Bulk plan queued.")).catch((e: Error) => setMsg(e.message))}
          >
            Queue suggested work
          </button>
        </Section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Video">
          <fieldset disabled={locked} className="space-y-3 border-0 p-0">
          <div className="grid gap-2 sm:grid-cols-3">
            <ModeChoice name="video-mode" checked={videoMode === "copy"} onChange={() => setVideoMode("copy")} label="Copy / remux" />
            <ModeChoice name="video-mode" checked={videoMode === "size"} onChange={() => setVideoMode("size")} label="Target file size" />
            <ModeChoice name="video-mode" checked={videoMode === "quality"} onChange={() => setVideoMode("quality")} label="Encoder quality" />
          </div>
          {videoMode === "size" && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-300">Target GB</span>
              <input className="w-28" type="number" min={0.1} step={0.1} value={targetGb} onChange={(e) => setTargetGb(Number(e.target.value))} />
            </label>
          )}
          {videoMode === "quality" && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-300">Quality 1–51</span>
              <input className="w-28" type="number" min={1} max={51} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            </label>
          )}
          {videoMode !== "copy" && (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-300">Codec</span>
                <select value={av1 ? codec : "hevc"} onChange={(e) => {
                  const value = e.target.value;
                  if (value === "hevc" || (value === "av1" && av1)) setCodec(value);
                }}>
                  <option value="hevc">HEVC</option>
                  {av1 && <option value="av1">AV1</option>}
                </select>
              </label>
              {is4k && (
                <label className="flex items-center gap-2 text-sm">
                  <input className="accent-accent" type="checkbox" checked={downscale} onChange={(e) => setDownscale(e.target.checked)} />
                  Downscale 4K to 1080p
                </label>
              )}
            </div>
          )}
          </fieldset>
        </Section>
        <Section title="Write mode" help={`House default is ${writeDefault}. Direct write replaces the library file after an integrity check.`}>
          <select value={writeMode} disabled={locked} onChange={(e) => {
            const value = e.target.value;
            if (value === "default" || value === "sidecar" || value === "direct") setWriteMode(value);
          }}>
            <option value="default">Use house default</option>
            <option value="sidecar">Sidecar for Review</option>
            <option value="direct">Direct write</option>
          </select>
        </Section>
      </div>
      <Section title="Audio">
        <fieldset disabled={locked} className="space-y-2 border-0 p-0">
        {!listed && <p className="help m-0">Track edits stay hidden until streams can be listed.</p>}
        {listed && (
          <div className="space-y-2">
            {report?.audio.map((track) => {
              const title = usefulTrackTitle(track.title, fileName);
              return (
                <div key={track.index} className="flex flex-col gap-3 rounded-lg bg-white/[0.04] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Pill>{track.language || "und"}</Pill>
                    <Pill>{track.codec}</Pill>
                    <Pill>{channelLabel(track.channels)}</Pill>
                    {title && <span className="max-w-64 truncate text-xs text-muted">{title}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      className={audioActionSelectClass}
                      value={audio[track.index]?.action ?? "keep"}
                      onChange={(e) => setAudio({
                        ...audio,
                        [track.index]: { action: parseAudioAction(e.target.value), channels: audio[track.index]?.channels ?? 2 },
                      })}
                    >
                      <option value="keep">Keep</option>
                      <option value="remove">Remove</option>
                      <option value="replace_aac">Replace with AAC</option>
                      {track.channels > 2 && <option value="replace_downmix">Replace with downmix</option>}
                      {track.channels > 2 && <option value="add_downmix">Add downmix</option>}
                    </select>
                    {(audio[track.index]?.action === "replace_downmix" || audio[track.index]?.action === "add_downmix") && (
                      <select
                        className={audioChannelSelectClass}
                        value={audio[track.index]?.channels ?? 2}
                        onChange={(e) => setAudio({
                          ...audio,
                          [track.index]: { ...audio[track.index], action: audio[track.index]?.action ?? "add_downmix", channels: Number(e.target.value) },
                        })}
                      >
                        {track.channels > 6 && <option value={6}>5.1</option>}
                        <option value={2}>stereo</option>
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </fieldset>
      </Section>
      <Section title="Subtitles">
        {listed && report?.subtitles.length ? (
          <div className="space-y-2">
            {report.subtitles.map((track) => {
              const title = usefulTrackTitle(track.title, fileName);
              const kept = (subs[track.index] ?? "keep") === "keep";
              return (
                <label key={track.index} className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
                  <input
                    className="accent-accent"
                    type="checkbox"
                    checked={kept}
                    onChange={(e) => setSubs({ ...subs, [track.index]: e.target.checked ? "keep" : "remove" })}
                  />
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Pill>{track.language || "und"}</Pill>
                    <Pill>{track.codec}</Pill>
                    {track.sdh && <Pill tone="accent">SDH</Pill>}
                    {track.forced && <Pill>forced</Pill>}
                    {title && <span className="max-w-64 truncate text-xs text-muted">{title}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        ) : listed ? (
          <p className="help m-0">No subtitle tracks.</p>
        ) : (
          <p className="help m-0">Track edits stay hidden until streams can be listed.</p>
        )}
      </Section>
      <Section title="Plan details">
        {plan?.estimatedOutputBytes != null && (
          <p className="text-sm">Estimated output: <span className="font-medium tabular-nums">{formatSize(plan.estimatedOutputBytes)}</span></p>
        )}
        {plan?.warning && <p className="text-sm text-warn">{plan.warning}</p>}
        {(plan?.reasons ?? []).length > 0 && (
          <ul className="space-y-1 text-sm leading-5 text-slate-300">
            {(plan?.reasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {errors.map((error) => (
          <p key={error} className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
        ))}
        <button
          className="btn"
          type="button"
          disabled={!queueReady}
          onClick={() => void api.queueCustom(id, draft).then(() => setMsg("Custom plan queued.")).catch((e: Error) => setMsg(e.message))}
        >
          Queue this plan
        </button>
        {onlyWrongLanguage && (
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              if (!window.confirm(`This removes the current file from the library and asks ${arrName} to search again.`)) return;
              void api.searchPreferred(id)
                .then(() => setMsg(`${arrName} will search for a preferred-language copy.`))
                .catch((e: Error) => setMsg(e.message));
            }}
          >
            {`Ask ${arrName} to search for a preferred-language copy`}
          </button>
        )}
      </Section>
      {msg && <p className="ok text-sm">{msg}</p>}
    </section>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="glass space-y-3 p-5">
      <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
      {help && <p className="help m-0">{help}</p>}
      {children}
    </section>
  );
}

function parseAudioAction(value: string): AudioAction {
  if (value === "keep" || value === "remove" || value === "replace_aac" || value === "replace_downmix" || value === "add_downmix") {
    return value;
  }
  return "keep";
}

function ModeChoice({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
      checked ? "border-accent/40 bg-accent/10 text-accent" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5"
    }`}>
      <input className="accent-accent" type="radio" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
