import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatSize, type ExecutablePlan, type InspectionReport, type LibraryRow } from "../api";
import { Help, PageHead } from "../components/Shell";
import { TitleFacts } from "../components/TitleFacts";
import { Pill } from "../components/ui";
import { channelLabel, fileNameFromPath, usefulTrackTitle } from "../title-display";

type AudioAction = "keep" | "remove" | "replace_aac" | "replace_downmix" | "add_downmix";

export function TitlePage() {
  const { id = "" } = useParams();
  const [item, setItem] = useState<LibraryRow | null>(null);
  const [av1, setAv1] = useState(false);
  const [writeDefault, setWriteDefault] = useState("sidecar");
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

  return (
    <section className="space-y-5">
      <PageHead title={item.displayTitle}>
        <Link className="btn-secondary" to={item.type === "movie" ? "/movies" : "/series"}>Back</Link>
      </PageHead>
      <Help>Custom work is optional. Bulk suggestions still exist. A do-nothing plan cannot be queued.</Help>
      <TitleFacts item={item} />
      {!listed && iso && (
        <p className="help">Streams could not be listed. You can still remux this disc image to Matroska.</p>
      )}
      {item.suggestion && (
        <Section title="Automatic suggestion">
          <ul className="space-y-1 text-sm leading-5 text-slate-300">
            {item.suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <button
            className="btn mt-1"
            type="button"
            onClick={() => void api.queue({ itemId: item.id }).then(() => setMsg("Bulk plan queued.")).catch((e: Error) => setMsg(e.message))}
          >
            Queue suggested work
          </button>
        </Section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Video">
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
                <select value={codec} onChange={(e) => setCodec(e.target.value as "hevc" | "av1")}>
                  <option value="hevc">HEVC</option>
                  <option value="av1">AV1</option>
                </select>
              </label>
              {!av1 && codec === "av1" && (
                <p className="help m-0">ffmpeg on this host has not listed an AV1 hardware encoder. Queue will fail until it does.</p>
              )}
              {is4k && (
                <label className="flex items-center gap-2 text-sm">
                  <input className="accent-accent" type="checkbox" checked={downscale} onChange={(e) => setDownscale(e.target.checked)} />
                  Downscale 4K to 1080p
                </label>
              )}
            </div>
          )}
        </Section>
        <Section title="Write mode" help={`House default is ${writeDefault}. Direct write replaces the library file after an integrity check.`}>
          <select value={writeMode} onChange={(e) => setWriteMode(e.target.value as "default" | "sidecar" | "direct")}>
            <option value="default">Use house default</option>
            <option value="sidecar">Sidecar for Review</option>
            <option value="direct">Direct write</option>
          </select>
        </Section>
      </div>
      <Section title="Audio">
        {!listed && <p className="help m-0">Track edits stay hidden until streams can be listed.</p>}
        {listed && (
          <div className="space-y-2">
            {report?.audio.map((track) => {
              const title = usefulTrackTitle(track.title, fileName);
              return (
                <div key={track.index} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Pill>{track.language || "und"}</Pill>
                    <Pill>{track.codec}</Pill>
                    <Pill>{channelLabel(track.channels)}</Pill>
                    {title && <span className="max-w-64 truncate text-xs text-muted">{title}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={audio[track.index]?.action ?? "keep"}
                      onChange={(e) => setAudio({ ...audio, [track.index]: { action: e.target.value as AudioAction, channels: audio[track.index]?.channels ?? 2 } })}
                    >
                      <option value="keep">Keep</option>
                      <option value="remove">Remove</option>
                      <option value="replace_aac">Replace with AAC</option>
                      {track.channels > 2 && <option value="replace_downmix">Replace with downmix</option>}
                      {track.channels > 2 && <option value="add_downmix">Add downmix</option>}
                    </select>
                    {(audio[track.index]?.action === "replace_downmix" || audio[track.index]?.action === "add_downmix") && (
                      <select
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
          disabled={Boolean(errors.length)}
          onClick={() => void api.queueCustom(id, draft).then(() => setMsg("Custom plan queued.")).catch((e: Error) => setMsg(e.message))}
        >
          Queue this plan
        </button>
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
