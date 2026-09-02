import { useState } from "react";
import { useTheme } from "next-themes";
import { Palette, Pencil, Check, X, Loader2, Upload } from "lucide-react";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLUB_THEME_PRESETS, resolveClubTheme, DEFAULT_CLUB_THEME_PRESET_ID } from "@/lib/clubThemePresets";
import { compressImage } from "@/utils/imageCompression";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Admin-only club branding editor (name, tagline, logo, color scheme) — moved out of the
 *  general Settings page (member-facing) into Admin (admin-only), since every member already
 *  gets their own personal accent-color picker there and this section was the one admin-only
 *  exception living on an otherwise member-facing page. Admin.tsx's own page-level gate is the
 *  only access check -- same as every other Admin* component, nothing re-checked here.
 *  German-only, deliberately, matching the rest of Admin.tsx. */
const AdminClubBranding = () => {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const { club, name: clubName, tagline: clubTagline, logoUrl, refetch: refetchBranding } = useClubBranding();

  const [editingBranding, setEditingBranding] = useState(false);
  const [brandingForm, setBrandingForm] = useState({ name: "", tagline: "", theme_preset: DEFAULT_CLUB_THEME_PRESET_ID });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [compressingLogo, setCompressingLogo] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);

  const startEditBranding = () => {
    if (!club) return;
    setBrandingForm({ name: club.name, tagline: club.tagline ?? "", theme_preset: club.theme_preset });
    setLogoFile(null);
    setLogoPreview(null);
    setLogoError(null);
    setEditingBranding(true);
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoError("Bitte ein PNG-, JPG- oder WebP-Bild wählen.");
      return;
    }
    setLogoError(null);
    setCompressingLogo(true);
    try {
      // A phone photo routinely runs well past this on its own -- compress client-side instead
      // of rejecting it outright, so picking "the photo I have" always just works.
      const upload = file.size > MAX_LOGO_BYTES ? await compressImage(file) : file;
      setLogoFile(upload);
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(upload);
    } catch {
      setLogoError("Bild konnte nicht verarbeitet werden. Bitte ein anderes Foto probieren.");
    } finally {
      setCompressingLogo(false);
    }
  };

  const saveBranding = async () => {
    if (!club || !brandingForm.name.trim() || savingBranding) return;
    setSavingBranding(true);

    let logoPath = club.logo_path;
    if (logoFile) {
      const ext = logoFile.type === "image/png" ? "png" : logoFile.type === "image/webp" ? "webp" : "jpg";
      const path = `${club.id}/logo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(path, logoFile, { upsert: true, contentType: logoFile.type });
      if (uploadError) {
        toast({ title: "Fehler", description: uploadError.message, variant: "destructive" });
        setSavingBranding(false);
        return;
      }
      logoPath = path;
    }

    const { error } = await supabase.from("clubs").update({
      name: brandingForm.name.trim(),
      tagline: brandingForm.tagline.trim() || null,
      theme_preset: brandingForm.theme_preset,
      logo_path: logoPath,
    }).eq("id", club.id);
    setSavingBranding(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    await refetchBranding();
    setLogoFile(null);
    setLogoPreview(null);
    setEditingBranding(false);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
          <Palette className="w-4 h-4" /> Vereinsdesign
        </h3>
        {club && !editingBranding && (
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={startEditBranding}>
            <Pencil className="w-3.5 h-3.5" /> Bearbeiten
          </Button>
        )}
      </div>

      {!club ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : editingBranding ? (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Vereinsname</Label>
            <Input
              value={brandingForm.name}
              onChange={(e) => setBrandingForm((f) => ({ ...f, name: e.target.value }))}
              className="bg-background border-border mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Leitspruch (optional)</Label>
            <Input
              value={brandingForm.tagline}
              onChange={(e) => setBrandingForm((f) => ({ ...f, tagline: e.target.value }))}
              className="bg-background border-border mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Vereinslogo</Label>
            <p className="text-xs text-muted-foreground mb-1.5">PNG, JPG oder WebP, max. 2 MB</p>
            <label className="flex items-center gap-3 w-full h-16 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-colors bg-muted/30 px-3">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoSelect} disabled={compressingLogo} className="hidden" />
              <img src={logoPreview ?? logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                {compressingLogo ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Lädt …</> : <><Upload className="w-3.5 h-3.5" /> Foto auswählen</>}
              </span>
            </label>
            {logoError && <p className="text-xs text-destructive mt-1">{logoError}</p>}
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Farbschema</Label>
            <div className="grid grid-cols-2 gap-2">
              {CLUB_THEME_PRESETS.map((preset) => {
                const vars = resolveClubTheme(preset.id, resolvedTheme === "light" ? "light" : "dark");
                const selected = brandingForm.theme_preset === preset.id;
                return (
                  <button
                    type="button"
                    key={preset.id}
                    onClick={() => setBrandingForm((f) => ({ ...f, theme_preset: preset.id }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-colors ${
                      selected ? "border-primary ring-2 ring-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <span className="flex gap-1 shrink-0">
                      <span className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars["--primary"]})` }} />
                      <span className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars["--secondary"]})` }} />
                      <span className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars["--accent"]})` }} />
                    </span>
                    <span className="truncate">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="ghost" onClick={() => setEditingBranding(false)} disabled={savingBranding}><X className="w-3.5 h-3.5" /></Button>
            <Button size="sm" onClick={saveBranding} disabled={savingBranding || !brandingForm.name.trim()} className="gap-1.5">
              {savingBranding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Speichern
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt={clubName} className="h-12 w-12 rounded-lg object-cover border border-border shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{clubName}</p>
            {clubTagline && <p className="text-xs text-muted-foreground truncate">{clubTagline}</p>}
          </div>
          <span className="flex gap-1 shrink-0">
            {(["--primary", "--secondary", "--accent"] as const).map((key) => {
              const vars = resolveClubTheme(club.theme_preset, resolvedTheme === "light" ? "light" : "dark");
              return <span key={key} className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars[key]})` }} />;
            })}
          </span>
        </div>
      )}
    </div>
  );
};

export default AdminClubBranding;
