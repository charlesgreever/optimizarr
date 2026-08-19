import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatSize, type ExecutablePlan, type InspectionReport, type LibraryRow } from "../api";
import { Help, PageHead } from "../components/Shell";

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
      {item.hasPoster && <img src={`/api/library/${item.id}/poster`} alt="" className="h-40 rounded-md object-cover" />}
      <p className="help">{item.instanceName} · {item.quality || "unknown quality"} · {formatSize(item.sizeBytes)} · {item.videoLabel || "not inspected"}</p>
      {!listed && iso && <p className="help">Streams could not be listed. You can still remux this disc image to Matroska.</p>}
      {item.suggestion && (
        <div className="glass p-4">
          <h2 className="font-semibold">Automatic suggestion</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">{item.suggestion.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <button className="btn mt-3" type="button" onClick={() => void api.queue({ itemId: item.id }).then(() => setMsg("Bulk plan queued.")).catch((e: Error) => setMsg(e.message))}>Queue suggested work</button>
        </div>
      )}
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Video</h2>
        <label className="mr-4 text-sm"><input type="radio" checked={videoMode === "copy"} onChange={() => setVideoMode("copy")} /> Copy / remux</label>
        <label className="mr-4 text-sm"><input type="radio" checked={videoMode === "size"} onChange={() => setVideoMode("size")} /> Target file size</label>
        <label className="text-sm"><input type="radio" checked={videoMode === "quality"} onChange={() => setVideoMode("quality")} /> Encoder quality</label>
        {videoMode === "size" && <label className="block text-sm">Target GB <input className="ml-2 w-24" type="number" min={0.1} step={0.1} value={targetGb} onChange={(e) => setTargetGb(Number(e.target.value))} /></label>}
        {videoMode === "quality" && <label className="block text-sm">Quality 1–51 <input className="ml-2 w-24" type="number" min={1} max={51} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /></label>}
        {videoMode !== "copy" && (
          <>
            <label className="block text-sm">Codec
              <select className="ml-2" value={codec} onChange={(e) => setCodec(e.target.value as "hevc" | "av1")}>
                <option value="hevc">HEVC</option>
                {av1 && <option value="av1">AV1</option>}
              </select>
            </label>
            {is4k && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={downscale} onChange={(e) => setDownscale(e.target.checked)} /> Downscale 4K to 1080p</label>}
          </>
        )}
      </div>
      <div className="glass space-y-2 p-4">
        <h2 className="font-semibold">Audio</h2>
        {!listed && <p className="help">Track edits stay hidden until streams can be listed.</p>}
        {listed && report?.audio.map((t) => (
          <div key={t.index} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-48">{t.language} · {t.codec} · {t.channels}ch {t.title}</span>
            <select value={audio[t.index]?.action ?? "keep"} onChange={(e) => setAudio({ ...audio, [t.index]: { action: e.target.value as AudioAction, channels: audio[t.index]?.channels ?? 2 } })}>
              <option value="keep">Keep</option>
              <option value="remove">Remove</option>
              <option value="replace_aac">Replace with AAC</option>
              {t.channels > 2 && <option value="replace_downmix">Replace with downmix</option>}
              {t.channels > 2 && <option value="add_downmix">Add downmix</option>}
            </select>
            {(audio[t.index]?.action === "replace_downmix" || audio[t.index]?.action === "add_downmix") && (
              <select value={audio[t.index]?.channels ?? 2} onChange={(e) => setAudio({ ...audio, [t.index]: { ...audio[t.index], action: audio[t.index]?.action ?? "add_downmix", channels: Number(e.target.value) } })}>
                {t.channels > 6 && <option value={6}>5.1</option>}
                <option value={2}>stereo</option>
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="glass space-y-2 p-4">
        <h2 className="font-semibold">Subtitles</h2>
        {listed && report?.subtitles.map((t) => (
          <label key={t.index} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={(subs[t.index] ?? "keep") === "keep"} onChange={(e) => setSubs({ ...subs, [t.index]: e.target.checked ? "keep" : "remove" })} />
            Keep {t.language} {t.codec} {t.title}
          </label>
        ))}
        {listed && !report?.subtitles.length && <p className="help">No subtitle tracks.</p>}
      </div>
      <div className="glass space-y-2 p-4">
        <h2 className="font-semibold">Write mode</h2>
        <p className="help">House default is {writeDefault}. Direct write replaces the library file after an integrity check.</p>
        <select value={writeMode} onChange={(e) => setWriteMode(e.target.value as "default" | "sidecar" | "direct")}>
          <option value="default">Use house default</option>
          <option value="sidecar">Sidecar for Review</option>
          <option value="direct">Direct write</option>
        </select>
      </div>
      <div className="glass space-y-2 p-4">
        <h2 className="font-semibold">Plan details</h2>
        {plan?.estimatedOutputBytes != null && <p className="text-sm">Estimated output: {formatSize(plan.estimatedOutputBytes)}</p>}
        {plan?.warning && <p className="text-sm text-amber-300">{plan.warning}</p>}
        <ul className="list-disc pl-5 text-sm">{(plan?.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
        {errors.map((e) => <p key={e} className="text-sm text-rose-400">{e}</p>)}
        <button
          className="btn"
          type="button"
          disabled={Boolean(errors.length)}
          onClick={() => void api.queueCustom(id, draft).then(() => setMsg("Custom plan queued.")).catch((e: Error) => setMsg(e.message))}
        >
          Queue this plan
        </button>
      </div>
      {msg && <p className="ok text-sm">{msg}</p>}
    </section>
  );
}
