import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, X, Download, Upload } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";
import AdminDetectionQuality from "@/components/admin/AdminDetectionQuality";

type ReviewStatus = "pending" | "confirmed" | "needs_review" | "rejected";

interface SampleLabel {
  x: number;
  y: number;
  baseValue: number;
  multiplier: number;
  /** Score picked from the correction chips: the position is a field centre, not a measured tip. */
  snapped?: boolean;
}

interface TrainingSample {
  id: string;
  after_path: string;
  labels: SampleLabel[];
  camera_zoom: number | null;
  review_status: ReviewStatus;
  ai_segments: SampleLabel[] | null;
  ai_notes: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  needs_review: "Zu prüfen",
  pending: "Ungeprüft",
  confirmed: "Bestätigt",
  rejected: "Verworfen",
};

const EXPORT_BATCH_SIZE = 40;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

interface AiVerdict {
  id: string;
  status: "confirmed" | "needs_review" | "rejected";
  ai_segments?: { baseValue: number; multiplier: number }[];
  notes?: string;
  /** Corrected dart tips: replaces the sample's labels (a review that moved, added or removed a tip). */
  labels?: SampleLabel[];
}

const dartText = (d: { baseValue: number; multiplier: number }) =>
  d.baseValue === 0 ? "Miss" : d.baseValue === 50 ? "Bull" : `${["", "", "D", "T"][d.multiplier] ?? ""}${d.baseValue}`;

/**
 * Admin queue for the training-data review pipeline: shows how many samples are in each state
 * (and how the confirmed ones spread over camera zoom levels, since coverage matters more than
 * volume), and lets an admin confirm or reject the ones the AI pass flagged. Samples the AI
 * agreed with are confirmed by the batch run itself and never land here.
 */
const AdminTrainingReview = () => {
  const { toast } = useToast();
  const [counts, setCounts] = useState<Record<ReviewStatus, number>>({ needs_review: 0, pending: 0, confirmed: 0, rejected: 0 });
  const [zoomCounts, setZoomCounts] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<TrainingSample[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReviewStatus>("needs_review");

  const load = useCallback(async () => {
    setLoading(true);
    const [overview, queueRes] = await Promise.all([
      supabase.from("training_samples").select("review_status, camera_zoom"),
      supabase
        .from("training_samples")
        .select("id, after_path, labels, camera_zoom, review_status, ai_segments, ai_notes, created_at")
        .eq("review_status", filter)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const nextCounts: Record<ReviewStatus, number> = { needs_review: 0, pending: 0, confirmed: 0, rejected: 0 };
    const nextZooms: Record<string, number> = {};
    (overview.data ?? []).forEach((r) => {
      nextCounts[r.review_status as ReviewStatus] += 1;
      if (r.review_status === "confirmed") {
        const key = r.camera_zoom === null ? "unbekannt" : `${r.camera_zoom}x`;
        nextZooms[key] = (nextZooms[key] ?? 0) + 1;
      }
    });
    setCounts(nextCounts);
    setZoomCounts(nextZooms);
    const rows = (queueRes.data ?? []) as unknown as TrainingSample[];
    setQueue(rows);
    if (rows.length > 0) {
      const { data: urls } = await supabase.storage.from("dart-training").createSignedUrls(rows.map((r) => r.after_path), 3600);
      const map: Record<string, string> = {};
      urls?.forEach((u, i) => { if (u.signedUrl) map[rows[i].id] = u.signedUrl; });
      setImages(map);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const [exporting, setExporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  /** Downloads the next batch of unreviewed samples as ONE json file (images inlined as data URLs)
   *  so an AI session can look at them offline — the bucket is private, so there is no other way
   *  to hand the images over. Pair with importVerdicts below for the way back. */
  const exportBatch = async () => {
    setExporting(true);
    try {
      // Unreviewed samples first; once none are left, the ones still waiting on "Zu prüfen" go out the same way.
      const fetchBatch = (status: ReviewStatus) => supabase
        .from("training_samples")
        .select("id, before_path, after_path, labels, camera_zoom, image_size")
        .eq("review_status", status)
        .order("created_at", { ascending: true })
        .limit(EXPORT_BATCH_SIZE);
      let { data, error } = await fetchBatch("pending");
      if (!error && (!data || data.length === 0)) ({ data, error } = await fetchBatch("needs_review"));
      if (error) throw error;
      if (!data || data.length === 0) {
        toast({ title: "Nichts zu exportieren", description: "Es gibt keine ungeprüften oder zu prüfenden Samples." });
        return;
      }
      const samples = [];
      for (const row of data) {
        const [before, after] = await Promise.all([
          supabase.storage.from("dart-training").download(row.before_path),
          supabase.storage.from("dart-training").download(row.after_path),
        ]);
        if (before.error || after.error || !before.data || !after.data) continue;
        samples.push({
          id: row.id,
          labels: row.labels,
          camera_zoom: row.camera_zoom,
          image_size: row.image_size,
          before: await blobToDataUrl(before.data),
          after: await blobToDataUrl(after.data),
        });
      }
      const file = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), samples })], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = `training-batch-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast({ title: `${samples.length} Samples exportiert` });
    } catch (err) {
      toast({ title: "Export fehlgeschlagen", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const [exportingDataset, setExportingDataset] = useState(false);

  /** Downloads every CONFIRMED sample (final after-image + dart tip positions) as one json file —
   *  the input for scripts/build-yolo-dataset.mjs, which turns it into the folder layout the
   *  Colab fine-tune expects. Only confirmed samples, so unreviewed labels never reach training. */
  const exportDataset = async () => {
    setExportingDataset(true);
    try {
      let result = await supabase
        .from("training_samples")
        .select("id, after_path, labels, camera_zoom, image_size, calibration_meta")
        .eq("review_status", "confirmed")
        .order("created_at", { ascending: true });
      if (result.error && /calibration_meta/.test(result.error.message)) {
        // Database without the calibration_meta column yet — export the rest.
        const fallback = await supabase
          .from("training_samples")
          .select("id, after_path, labels, camera_zoom, image_size")
          .eq("review_status", "confirmed")
          .order("created_at", { ascending: true });
        result = { ...fallback, data: fallback.data?.map((r) => ({ ...r, calibration_meta: null })) ?? null } as typeof result;
      }
      const { data, error } = result;
      if (error) throw error;
      if (!data || data.length === 0) {
        toast({ title: "Nichts zu exportieren", description: "Es gibt noch keine bestätigten Samples." });
        return;
      }
      const samples = [];
      for (const row of data) {
        const after = await supabase.storage.from("dart-training").download(row.after_path);
        if (after.error || !after.data) continue;
        const darts = (row.labels as unknown as SampleLabel[]).filter((d) => typeof d.x === "number" && typeof d.y === "number");
        if (darts.length === 0) continue;
        samples.push({
          id: row.id,
          camera_zoom: row.camera_zoom,
          image_size: row.image_size,
          calibration_meta: row.calibration_meta,
          darts: darts.map((d) => ({ x: d.x, y: d.y, snapped: d.snapped === true })),
          image: await blobToDataUrl(after.data),
        });
      }
      const file = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), samples })], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = `training-dataset-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast({ title: `${samples.length} bestätigte Samples exportiert` });
    } catch (err) {
      toast({ title: "Export fehlgeschlagen", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setExportingDataset(false);
    }
  };

  /** Applies a verdict file produced by the AI review (array of AiVerdict) to the matching rows. */
  const importVerdicts = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AiVerdict[] | { verdicts?: AiVerdict[] };
      const verdicts = Array.isArray(parsed) ? parsed : parsed.verdicts;
      if (!Array.isArray(verdicts)) throw new Error("Die Datei enthält keine Liste von Ergebnissen (erwartet: [{ id, status, ... }]).");
      let applied = 0;
      for (const v of verdicts) {
        if (!["confirmed", "needs_review", "rejected"].includes(v.status)) continue;
        const { error } = await supabase
          .from("training_samples")
          .update({
            review_status: v.status,
            ai_segments: v.ai_segments ?? null,
            ai_notes: v.notes ?? null,
            ...(Array.isArray(v.labels) ? { labels: v.labels as unknown as Json } : {}),
            reviewed_at: new Date().toISOString(),
            reviewed_by: "ai",
          })
          .eq("id", v.id)
          // pending rows, and rows an earlier import left on "needs review" (so they can be corrected and confirmed later)
          .in("review_status", ["pending", "needs_review"]);
        if (!error) applied += 1;
      }
      toast({ title: `${applied} von ${verdicts.length} Ergebnissen übernommen` });
      await load();
    } catch (err) {
      toast({ title: "Import fehlgeschlagen", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const decide = async (id: string, status: "confirmed" | "rejected") => {
    const { error } = await supabase
      .from("training_samples")
      .update({ review_status: status, reviewed_at: new Date().toISOString(), reviewed_by: "admin" })
      .eq("id", id);
    if (error) {
      toast({ title: "Speichern fehlgeschlagen", description: error.message, variant: "destructive" });
      return;
    }
    setQueue((q) => q.filter((s) => s.id !== id));
    setCounts((c) => ({ ...c, [filter]: Math.max(0, c[filter] - 1), [status]: c[status] + 1 }));
  };

  return (
    <div className="space-y-4">
      <AdminDetectionQuality />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(Object.keys(STATUS_LABELS) as ReviewStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={`rounded-xl border p-3 text-left transition-colors ${filter === status ? "border-primary/60 bg-primary/10" : "border-border hover:bg-muted"}`}
          >
            <p className="text-2xl font-display tabular-nums">{counts[status]}</p>
            <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={exportBatch} disabled={exporting}>
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Batch exportieren
        </Button>
        <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => importInputRef.current?.click()}>
          <Upload className="w-4 h-4" /> KI-Ergebnis importieren
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void importVerdicts(file); e.target.value = ""; }}
        />
      </div>

      <Button size="sm" variant="secondary" className="w-full gap-1" onClick={exportDataset} disabled={exportingDataset || counts.confirmed === 0}>
        {exportingDataset ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Trainingsset exportieren ({counts.confirmed} bestätigt)
      </Button>

      <p className="text-xs text-muted-foreground">
        Bestätigt nach Zoomstufe: {Object.keys(zoomCounts).length === 0
          ? "noch nichts"
          : Object.entries(zoomCounts).map(([zoom, n]) => `${zoom}: ${n}`).join(" · ")}.
        Je unterschiedlicher Zoom, Winkel und Licht, desto besser wird das Modell.
      </p>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : queue.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Nichts in „{STATUS_LABELS[filter]}“.</p>
      ) : (
        <div className="space-y-3">
          {queue.map((sample) => (
            <Card key={sample.id} className="p-3 space-y-2">
              <div className="relative">
                {images[sample.id] && <img src={images[sample.id]} alt="" className="w-full rounded-lg" />}
                {sample.labels.map((d, i) => (
                  <span
                    key={i}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground"
                    style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}
                  >
                    {dartText(d)}
                  </span>
                ))}
              </div>
              <p className="text-xs">
                <span className="text-muted-foreground">Gespeichert:</span> {sample.labels.map(dartText).join(", ") || "–"}
                {sample.ai_segments && <> · <span className="text-muted-foreground">KI:</span> {sample.ai_segments.map(dartText).join(", ") || "–"}</>}
              </p>
              {sample.ai_notes && <p className="text-xs text-muted-foreground">{sample.ai_notes}</p>}
              {(filter === "needs_review" || filter === "pending") && (
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => decide(sample.id, "confirmed")}><Check className="w-4 h-4" /> Bestätigen</Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => decide(sample.id, "rejected")}><X className="w-4 h-4" /> Verwerfen</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminTrainingReview;
