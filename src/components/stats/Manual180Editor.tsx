import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ManualEntryRow {
  id: string;
  year: number;
  count: number;
}

interface Manual180EditorProps {
  playerId: string;
  entries: ManualEntryRow[];
  onChanged: () => void;
}

const CURRENT_YEAR = new Date().getFullYear();

/** Self-service form for backfilling 180s thrown before this player had (or used) camera/manual
 *  tracking in the app — one editable count per calendar year, upserted by (player_id, year).
 *  Only ever rendered for your OWN profile (see the gate at the call site) — RLS enforces the
 *  same restriction server-side regardless. */
const Manual180Editor = ({ playerId, entries, onChanged }: Manual180EditorProps) => {
  const { toast } = useToast();
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [yearInput, setYearInput] = useState(String(CURRENT_YEAR));
  const [countInput, setCountInput] = useState("");
  const [saving, setSaving] = useState(false);

  const startAdd = () => {
    const usedYears = new Set(entries.map((e) => e.year));
    let year = CURRENT_YEAR;
    while (usedYears.has(year) && year > 1990) year--;
    setYearInput(String(year));
    setCountInput("");
    setEditingYear(-1); // sentinel: "adding new", not editing an existing row
  };

  const startEdit = (e: ManualEntryRow) => {
    setYearInput(String(e.year));
    setCountInput(String(e.count));
    setEditingYear(e.year);
  };

  const cancel = () => setEditingYear(null);

  const save = async () => {
    const year = Number(yearInput);
    const count = Number(countInput);
    if (!Number.isInteger(year) || year < 1990 || year > CURRENT_YEAR) {
      toast({ title: "Ungültiges Jahr", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(count) || count < 0) {
      toast({ title: "Ungültige Anzahl", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("manual_180_entries")
      .upsert({ player_id: playerId, year, count }, { onConflict: "player_id,year" });
    setSaving(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    setEditingYear(null);
    onChanged();
  };

  const remove = async (id: string) => {
    await supabase.from("manual_180_entries").delete().eq("id", id);
    onChanged();
  };

  const isAdding = editingYear === -1;

  return (
    <div className="mt-3 pt-3 border-t border-border/60">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">180er nachtragen (vor Kamera-Erfassung)</p>
      <div className="space-y-1">
        {entries.sort((a, b) => b.year - a.year).map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-xs bg-muted/30 rounded-lg px-2.5 py-1.5">
            {editingYear === e.year ? (
              <>
                <span className="font-mono">{e.year}</span>
                <div className="flex items-center gap-1.5 flex-1 justify-end">
                  <Input type="number" min={0} value={countInput} onChange={(ev) => setCountInput(ev.target.value)}
                    className="h-8 w-20 text-xs bg-background border-border" autoFocus />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={save} disabled={saving} title="Speichern" aria-label="Speichern"><Check className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancel} title="Abbrechen" aria-label="Abbrechen"><X className="w-3.5 h-3.5" /></Button>
                </div>
              </>
            ) : (
              <>
                <span className="font-mono">{e.year}</span>
                <span className="flex-1 text-center font-display">{e.count}× 180</span>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(e)} title="Bearbeiten" aria-label="Bearbeiten"><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(e.id)} title="Löschen" aria-label="Löschen"><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" /></Button>
                </div>
              </>
            )}
          </div>
        ))}

        {isAdding ? (
          <div className="flex items-center gap-1.5 text-xs bg-muted/30 rounded-lg px-2.5 py-1.5">
            <Input type="number" min={1990} max={CURRENT_YEAR} value={yearInput} onChange={(ev) => setYearInput(ev.target.value)}
              placeholder="Jahr" className="h-8 w-20 text-xs bg-background border-border" autoFocus />
            <Input type="number" min={0} value={countInput} onChange={(ev) => setCountInput(ev.target.value)}
              placeholder="Anzahl" className="h-8 w-24 text-xs bg-background border-border" />
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={save} disabled={saving} title="Speichern" aria-label="Speichern"><Check className="w-3.5 h-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancel} title="Abbrechen" aria-label="Abbrechen"><X className="w-3.5 h-3.5" /></Button>
          </div>
        ) : (
          <button onClick={startAdd} className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5">
            <Plus className="w-3.5 h-3.5" /> Jahr hinzufügen
          </button>
        )}
      </div>
    </div>
  );
};

export default Manual180Editor;
