import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, X } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type ReviewStatus = "pending" | "confirmed" | "needs_review" | "rejected";

interface SampleLabel {
  x: number;
  y: number;
  baseValue: number;
  multiplier: number;
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
