import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { Plus, Search, Target, Camera, Sparkles, ArrowLeft, Upload, Users, Quote, Info, Trash2, KeyRound } from "lucide-react";
import { DartLoaderIcon as Loader2, DartGameIcon } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { experienceScore } from "@/utils/dartStats";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useOnlineUserIds } from "@/lib/clubPresence";
import { compressImage } from "@/utils/imageCompression";
import { generatePinSalt, hashPin, isValidPinFormat } from "@/lib/playerPin";
import { formatPlayerAverage, playerWinRate, type PlayerProfile } from "@/components/players/playerProfile";
import ClubRosterHeader from "@/components/players/ClubRosterHeader";
import PlayerRosterRow from "@/components/players/PlayerRosterRow";
import PlayerProfileHeader from "@/components/players/PlayerProfileHeader";
import PlayerProfileFacts from "@/components/players/PlayerProfileFacts";
import { PlayerNumberTile, PlayersCard, PlayersSectionLabel } from "@/components/players/PlayersPagePrimitives";

// recharts (~390KB) is only needed once a player's detail view is open, not for browsing
// the roster list — split into its own chunk instead of loading it for every /players visit.
const PlayerStatsCharts = lazy(() => import("@/components/players/PlayerStatsCharts"));

const EMOJI_AVATARS = ["🎯", "🏆", "⭐", "🔥", "💎", "🦅", "🐉", "🎪"];
const PHOTO_COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;

const EMPTY_PLAYER_FORM = {
  name: "",
  nickname: "",
  emoji: "🎯",
  bio: "",
  hand: "",
  weight: "",
  favDouble: "",
  hometown: "",
  joinedYear: "",
  motto: "",
  birthday: "",
};

/**
 * Club member management page with persistent player profiles.
 * Supports photo upload and AI-generated dart jersey portraits.
 */
const PlayersPage = () => {
  const { t } = useLanguage();
  const onlineNow = useOnlineUserIds();
  const { name: clubName, clubId } = useClubBranding();
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [profileHintDismissed, setProfileHintDismissed] = useState(false);

  // New player form state
  const [newName, setNewName] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [newEmoji, setNewEmoji] = useState("🎯");
  const [uploadedPhoto, setUploadedPhoto] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  // The player-being-edited's CURRENT photo (already-signed URL, straight from the fetched
  // `players` row) — shown as a preview instead of always defaulting to the empty dropzone
  // prompt. Separate from uploadedPhoto (a NEW pick this session, which takes priority once set).
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);
  const [generatingPortrait, setGeneratingPortrait] = useState(false);
  const [compressingPhoto, setCompressingPhoto] = useState(false);
  // Bumped whenever an in-flight AI-portrait request should no longer be trusted (a different
  // photo was picked, or the dialog closed/reopened for a different player) — generateAiPortrait
  // checks this is still its own value before applying anything it fetched, so a slow request
  // that's since been superseded can't overwrite a newer pick or attach to the wrong player.
  const portraitRequestIdRef = useRef(0);
  const [generatedPortrait, setGeneratedPortrait] = useState<string | null>(null);
  // Optional profile fields
  const [newBio, setNewBio] = useState("");
  const [newHand, setNewHand] = useState<string>("");
  const [newWeight, setNewWeight] = useState<string>("");
  const [newFavDouble, setNewFavDouble] = useState("");
  const [newHometown, setNewHometown] = useState("");
  const [newJoinedYear, setNewJoinedYear] = useState<string>("");
  const [newMotto, setNewMotto] = useState("");
  const [newBirthday, setNewBirthday] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  /** Admin-Modus: Profil für jemanden anlegen, der (noch) keinen Account hat — der Insert
   *  lässt dann user_id auf null statt der eigenen Session-ID (RLS-Policy
   *  "Admins can insert walk-in players"). Verhält sich danach wie jedes andere Walk-in-Profil. */
  const [createWithoutAccount, setCreateWithoutAccount] = useState(false);

  const { toast } = useToast();
  const { session, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = useIsAdmin(user?.id);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /** Admin-only "Konto verknüpfen": club members who've signed up but have no player profile of
   *  their own yet — i.e. exactly who a walk-in (no-account) profile's real account might now
   *  belong to (tournament-day ask, 2026-09-12: keep a walk-in's stats/history under the SAME
   *  row instead of that member starting over with a fresh, empty self-service profile). Reuses
   *  admin_user_activity (already club-scoped, admin-only, and already LEFT JOINs players by
   *  user_id) rather than adding a new RPC just to enumerate this. */
  const [linkableAccounts, setLinkableAccounts] = useState<{ user_id: string; email: string }[]>([]);
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});
  const [linkingId, setLinkingId] = useState<string | null>(null);

  // "PIN pro Spieler" (@/lib/playerPin): set/change here covers both self-service (own linked
  // profile) and admin-for-walk-in (no account) — same permission shape as canEditPlayer below,
  // enforced again server-side by the set_player_pin RPC. Reset-to-null is separately allowed
  // for an admin on ANY player (e.g. someone forgot theirs), via admin_reset_player_pin.
  const [pinNew, setPinNew] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinResetting, setPinResetting] = useState(false);

  /** Your own linked profile, always — plus, for an admin, any UNLINKED (walk-in, no account)
   *  profile. Without this, a walk-in player's name/photo could never be fixed at all (user_id
   *  is null, so it can never equal anyone's auth.uid()) — the only "fix" was delete + recreate,
   *  which silently nulls that player out of every historical game via ON DELETE SET NULL. The
   *  DB trigger (restrict_player_profile_edits_to_owner) has the matching exception — this is
   *  just the UI-side mirror of it, not the actual enforcement. */
  const canEditPlayer = (player: PlayerProfile) => player.user_id === user?.id || (isAdmin && !player.user_id);

  const ownPlayerProfile = useMemo(
    () => players.find((player) => player.user_id === user?.id),
    [players, user?.id]
  );
  const shouldShowProfileHint = !!user && !ownPlayerProfile && !profileHintDismissed;

  // Auto-open the create dialog right after signup. Keyed on the URL param only —
  // openCreateProfile is a plain (non-memoized) function whose identity changes every render,
  // and re-running this on every such change would fight the setSearchParams cleanup below.
  useEffect(() => {
    if (searchParams.get("createProfile") === "1") {
      openCreateProfile();
      const params = new URLSearchParams(searchParams);
      params.delete("createProfile");
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  /** Generates signed URLs for player avatar/portrait storage paths */
  const resolveSignedUrls = async (players: PlayerProfile[]): Promise<PlayerProfile[]> => {
    const resolved = await Promise.all(
      players.map(async (p) => {
        const copy = { ...p };
        for (const field of ["avatar_url", "ai_portrait_url"] as const) {
          const val = p[field];
          if (val && !val.startsWith("data:")) {
            let path = val;
            const publicPrefix = "/object/public/player-avatars/";
            const idx = val.indexOf(publicPrefix);
            if (idx !== -1) path = val.substring(idx + publicPrefix.length);
            const signedPrefix = "/object/sign/player-avatars/";
            const idx2 = val.indexOf(signedPrefix);
            if (idx2 !== -1) path = val.substring(idx2 + signedPrefix.length).split("?")[0];

            const { data } = await supabase.storage
              .from("player-avatars")
              .createSignedUrl(path, 3600);
            if (data?.signedUrl) copy[field] = data.signedUrl;
          }
        }
        return copy;
      })
    );
    return resolved;
  };

  /** Fetches all players from the database */
  const fetchPlayers = useCallback(async () => {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch players:", error);
      toast({ title: t("players.errorTitle"), description: t("players.loadFailed"), variant: "destructive" });
    } else {
      const withSignedUrls = await resolveSignedUrls(data || []);
      setPlayers(withSignedUrls);
    }
    setLoading(false);
  }, [toast, t]);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  useEffect(() => {
    if (!isAdmin) { setLinkableAccounts([]); return; }
    supabase.rpc("admin_user_activity").then(({ data, error }) => {
      if (error) return; // non-fatal — the "Konto verknüpfen" picker just stays empty
      setLinkableAccounts(
        ((data ?? []) as { user_id: string; email: string; player_name: string | null }[])
          .filter((row) => !row.player_name)
          .map((row) => ({ user_id: row.user_id, email: row.email }))
      );
    });
  }, [isAdmin]);

  /** Admin-only: removes a player profile outright — the only way to get rid of ones created
   *  directly here without a linked account (user_id is NULL, so the self-service delete policy
   *  can never match them). Games/stats referencing this player_id are untouched. */
  const deletePlayer = async (player: PlayerProfile) => {
    setDeletingId(player.id);
    // .select() so a row-count of 0 is distinguishable from an actual success — a DELETE that RLS
    // silently blocks (e.g. admin role was revoked from this session moments ago, cache still says
    // isAdmin) returns error: null with nothing deleted, not an error, so `error` alone can't tell
    // "removed" apart from "no-op that's about to reappear on the next fetch."
    const { data: deletedRows, error } = await supabase.from("players").delete().eq("id", player.id).select("id");
    if (error) {
      toast({ title: t("players.errorTitle"), description: error.message, variant: "destructive" });
    } else if (!deletedRows || deletedRows.length === 0) {
      toast({ title: t("players.errorTitle"), description: t("players.deleteNotPermitted"), variant: "destructive" });
    } else {
      toast({ title: t("players.memberRemoved"), description: `${player.name} ${t("players.memberRemovedDesc")}` });
      setPlayers((prev) => prev.filter((p) => p.id !== player.id));
      // Avatar/AI-portrait uploads live under their own playerId-prefixed folder, unrelated to
      // the row itself — list rather than guess exact filenames (extension varies jpg/png).
      const { data: files } = await supabase.storage.from("player-avatars").list(player.id);
      if (files && files.length > 0) {
        await supabase.storage.from("player-avatars").remove(files.map((f) => `${player.id}/${f.name}`));
      }
    }
    setDeletingId(null);
  };

  /** Admin-only: attaches an existing walk-in profile (no account, `user_id` NULL) to a club
   *  member who has since signed up with email, instead of that member creating a brand-new
   *  profile and losing the walk-in's accumulated stats/history. No new migration/RPC needed —
   *  the players UPDATE RLS policy is already club-scoped ("true" within the club) and
   *  restrict_player_profile_edits_to_owner already special-cases exactly this (admin +
   *  OLD.user_id IS NULL, same club) to allow changing user_id; this is a plain update through
   *  those existing rules, same shape as deletePlayer's own "0 rows back = RLS silently said no"
   *  check above. */
  const linkPlayerAccount = async (player: PlayerProfile) => {
    const targetUserId = linkTarget[player.id];
    if (!targetUserId) return;
    setLinkingId(player.id);
    const { data: updatedRows, error } = await supabase
      .from("players")
      .update({ user_id: targetUserId })
      .eq("id", player.id)
      .is("user_id", null)
      .select("id");
    if (error) {
      toast({ title: t("players.errorTitle"), description: error.message, variant: "destructive" });
    } else if (!updatedRows || updatedRows.length === 0) {
      toast({ title: t("players.errorTitle"), description: t("players.linkAccountConflict"), variant: "destructive" });
    } else {
      const linkedEmail = linkableAccounts.find((a) => a.user_id === targetUserId)?.email;
      setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, user_id: targetUserId } : p)));
      setLinkableAccounts((prev) => prev.filter((a) => a.user_id !== targetUserId));
      setLinkTarget((prev) => {
        const next = { ...prev };
        delete next[player.id];
        return next;
      });
      toast({ title: `${player.name} ${t("players.linkAccountSuccessSuffix")}`, description: linkedEmail });
    }
    setLinkingId(null);
  };

  // Reset the PIN form whenever a different profile is opened — otherwise a half-typed PIN for
  // one player could get submitted against whichever profile happens to be open next.
  useEffect(() => {
    setPinNew(""); setPinConfirm("");
  }, [selectedPlayer?.id]);

  /** Sets/changes `player`'s PIN — permission (self, or admin-for-walk-in) is re-checked
   *  server-side by the set_player_pin RPC regardless of what canEditPlayer already gated. */
  const savePlayerPin = async (player: PlayerProfile) => {
    if (!isValidPinFormat(pinNew)) {
      toast({ title: t("players.pinInvalidFormat"), variant: "destructive" });
      return;
    }
    if (pinNew !== pinConfirm) {
      toast({ title: t("players.pinMismatch"), variant: "destructive" });
      return;
    }
    setPinSaving(true);
    const salt = generatePinSalt();
    const hash = await hashPin(pinNew, salt);
    const { error } = await supabase.rpc("set_player_pin", { p_player_id: player.id, p_pin_hash: hash, p_pin_salt: salt });
    setPinSaving(false);
    if (error) {
      toast({ title: t("players.pinSaveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setPinNew(""); setPinConfirm("");
    setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, pin_hash: hash, pin_salt: salt } : p)));
    setSelectedPlayer((prev) => (prev && prev.id === player.id ? { ...prev, pin_hash: hash, pin_salt: salt } : prev));
    toast({ title: t("players.pinSaved") });
  };

  /** Admin-only: clears ANY player's PIN (e.g. they forgot it) via admin_reset_player_pin — a
   *  separate RPC from set_player_pin since this is allowed regardless of who owns the profile,
   *  not just self/walk-in. */
  const adminResetPlayerPin = async (player: PlayerProfile) => {
    setPinResetting(true);
    const { error } = await supabase.rpc("admin_reset_player_pin", { p_player_id: player.id });
    setPinResetting(false);
    if (error) {
      toast({ title: t("players.pinSaveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, pin_hash: null, pin_salt: null } : p)));
    setSelectedPlayer((prev) => (prev && prev.id === player.id ? { ...prev, pin_hash: null, pin_salt: null } : prev));
    toast({ title: t("players.pinRemoved") });
  };

  useEffect(() => {
    const stored = window.localStorage.getItem("players-profile-hint-dismissed");
    setProfileHintDismissed(stored === "1");
  }, []);

  const dismissProfileHint = () => {
    setProfileHintDismissed(true);
    window.localStorage.setItem("players-profile-hint-dismissed", "1");
  };

  const resetForm = () => {
    portraitRequestIdRef.current++;
    setNewName(EMPTY_PLAYER_FORM.name);
    setNewNickname(EMPTY_PLAYER_FORM.nickname);
    setNewEmoji(EMPTY_PLAYER_FORM.emoji);
    setUploadedPhoto(null);
    setUploadedFile(null);
    setExistingPhotoUrl(null);
    setRemoveExistingPhoto(false);
    setGeneratedPortrait(null);
    setNewBio(EMPTY_PLAYER_FORM.bio);
    setNewHand(EMPTY_PLAYER_FORM.hand);
    setNewWeight(EMPTY_PLAYER_FORM.weight);
    setNewFavDouble(EMPTY_PLAYER_FORM.favDouble);
    setNewHometown(EMPTY_PLAYER_FORM.hometown);
    setNewJoinedYear(EMPTY_PLAYER_FORM.joinedYear);
    setNewMotto(EMPTY_PLAYER_FORM.motto);
    setNewBirthday(EMPTY_PLAYER_FORM.birthday);
    setEditingPlayerId(null);
    setIsEditMode(false);
    setCreateWithoutAccount(false);
  };

  /** Admin-Weg: Profil für jemanden anlegen, der keinen eigenen Account hat (z. B. Kinder von
   *  Mitgliedern). Umgeht bewusst den ownPlayerProfile-Guard von openCreateProfile — hier wird
   *  ja gerade KEIN eigenes Profil erstellt. */
  const openCreateWalkInProfile = () => {
    resetForm();
    setCreateWithoutAccount(true);
    setDialogOpen(true);
  };

  const openCreateProfile = () => {
    // The create form always links the new row to whoever is signed in (players.user_id, RLS-
    // enforced as auth.uid() = user_id — there's no "create it for someone else" path here).
    // Without this guard, clicking it a second time creates a second profile owned by the same
    // account instead of editing the first.
    if (ownPlayerProfile) {
      toast({ title: t("players.alreadyHaveProfile"), description: `${t("players.editExistingProfileInstead")} "${ownPlayerProfile.name}" ${t("players.instead")}` });
      openEditProfile(ownPlayerProfile);
      return;
    }
    resetForm();
    if (user?.email) {
      const suggestedName = user.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
      setNewName(suggestedName);
    }
    setDialogOpen(true);
  };

  const openEditProfile = (player: PlayerProfile) => {
    setIsEditMode(true);
    setEditingPlayerId(player.id);
    setNewName(player.name ?? "");
    setNewNickname(player.nickname ?? "");
    setNewEmoji(player.emoji ?? "🎯");
    setNewBio(player.bio ?? "");
    setNewHand(player.throwing_hand ?? "");
    setNewWeight(player.dart_weight_g ? String(player.dart_weight_g) : "");
    setNewFavDouble(player.favorite_double ?? "");
    setNewHometown(player.hometown ?? "");
    setNewJoinedYear(player.joined_year ? String(player.joined_year) : "");
    setNewMotto(player.motto ?? "");
    setNewBirthday(player.birthday ?? "");
    setUploadedPhoto(null);
    setUploadedFile(null);
    setGeneratedPortrait(null);
    // Same priority order the roster card/detail view use elsewhere (ai_portrait_url wins over
    // avatar_url) — already a signed URL at this point, resolved once when `players` was fetched.
    setExistingPhotoUrl(player.ai_portrait_url || player.avatar_url || null);
    setRemoveExistingPhoto(false);
    setDialogOpen(true);
  };

  const toggleCard = (playerId: string) => {
    setExpandedCards((prev) => ({ ...prev, [playerId]: !prev[playerId] }));
  };

  /** Handles photo file selection and creates preview. Compresses first when the raw file is
   *  large (a phone camera routinely produces 8-12MB originals) -- there was never a size limit
   *  here to trip on, but uploading the raw file straight through was still needlessly slow for
   *  the uploader and everyone who later loads the roster. */
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Any AI-portrait request already in flight was generated from the PREVIOUS photo — picking
    // a new one invalidates it, otherwise a slow response could resurrect the old photo's result
    // right after the user deliberately moved on from it.
    portraitRequestIdRef.current++;
    setCompressingPhoto(true);
    const upload = file.size > PHOTO_COMPRESS_THRESHOLD_BYTES ? await compressImage(file) : file;
    setCompressingPhoto(false);
    setUploadedFile(upload);
    const reader = new FileReader();
    reader.onload = (ev) => setUploadedPhoto(ev.target?.result as string);
    reader.readAsDataURL(upload);
    setGeneratedPortrait(null);
    setRemoveExistingPhoto(false); // a fresh pick supersedes an earlier "remove" click
  };

  /** Clears whatever photo is currently shown in the dropzone — a NEW pick this session just
   *  reverts to blank, while removing an untouched EXISTING photo instead flags it for deletion
   *  on save (see addPlayer's photoPayload). */
  const clearPhoto = () => {
    if (uploadedPhoto || generatedPortrait) {
      portraitRequestIdRef.current++;
      setUploadedPhoto(null);
      setUploadedFile(null);
      setGeneratedPortrait(null);
    } else if (existingPhotoUrl) {
      setRemoveExistingPhoto(true);
    }
  };

  /** Calls AI edge function to generate dart jersey portrait */
  const generateAiPortrait = async () => {
    const requestId = ++portraitRequestIdRef.current;
    const isStale = () => portraitRequestIdRef.current !== requestId;
    setGeneratingPortrait(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-player-portrait`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            playerName: newName || "Player",
            sourceImageBase64: uploadedPhoto || undefined,
          }),
        }
      );

      if (!response.ok) {
        // A gateway timeout/502/504 (this call can genuinely take a while) returns an HTML/plain
        // error page, not JSON — .json() on that throws its own opaque SyntaxError, which used to
        // surface to the user verbatim instead of the friendly message below.
        let message: string | undefined;
        try {
          message = (await response.json())?.error;
        } catch {
          /* non-JSON error body — fall through to the generic message */
        }
        throw new Error(message || "AI generation failed");
      }

      const data = await response.json();
      // A slow response arriving after the user picked a different photo, or closed/reopened the
      // dialog for a different player, must not resurrect stale content or (worse) get attached
      // to the wrong player's profile once "Save" is hit with a since-changed editingPlayerId.
      if (isStale()) return;
      if (data.imageBase64) {
        setGeneratedPortrait(data.imageBase64);
        toast({ title: t("players.portraitGenerated"), description: t("players.aiPortraitReady") });
      } else {
        // A 200 with no image (content filtered, empty provider result) used to leave the button
        // silently reverting to normal with zero feedback — no way to tell "still working",
        // "failed", or "misclicked" apart.
        toast({ title: t("players.aiErrorTitle"), description: t("players.portraitGenerationFailed"), variant: "destructive" });
      }
    } catch (err) {
      if (isStale()) return;
      console.error("AI portrait error:", err);
      toast({ title: t("players.aiErrorTitle"), description: err instanceof Error ? err.message : t("players.portraitGenerationFailed"), variant: "destructive" });
    } finally {
      if (!isStale()) setGeneratingPortrait(false);
    }
  };

  /** Uploads an image to storage and returns a signed URL */
  const uploadImageToStorage = async (dataUrl: string, playerId: string, suffix: string): Promise<string | null> => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const path = `${playerId}/${suffix}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("player-avatars")
        .upload(path, blob, { upsert: true, contentType: blob.type });

      if (uploadError) throw uploadError;

      const { data: urlData, error: signError } = await supabase.storage
        .from("player-avatars")
        .createSignedUrl(path, 3600);

      if (signError) throw signError;
      return urlData?.signedUrl ?? null;
    } catch (err) {
      console.error("Upload failed:", err);
      return null;
    }
  };

  /** Creates a new player with optional photos */
  const addPlayer = async () => {
    if (!newName.trim() || savingPlayer) return;
    // Letzte Sicherung: ein Profil MIT Account-Verknüpfung darf pro Login nur einmal entstehen.
    // Wer schon eins hat und hier jemand anderen anlegt, hätte sonst einen Fremden auf den
    // eigenen Account verlinkt (Fall "Korti" beim Dienstagsturnier).
    if (!isEditMode && !createWithoutAccount && ownPlayerProfile) {
      toast({ title: t("players.alreadyHaveProfile"), description: t("players.useWalkInForOthers"), variant: "destructive" });
      return;
    }
    setSavingPlayer(true);
    try {

    if (isEditMode && editingPlayerId) {
      const updatePayload = {
        name: newName.trim(),
        nickname: newNickname.trim() || null,
        emoji: newEmoji,
        bio: newBio.trim() || null,
        throwing_hand: newHand || null,
        dart_weight_g: newWeight ? parseInt(newWeight) : null,
        favorite_double: newFavDouble.trim() || null,
        hometown: newHometown.trim() || null,
        joined_year: newJoinedYear ? parseInt(newJoinedYear) : null,
        motto: newMotto.trim() || null,
        birthday: newBirthday || null,
      };

      const { error } = await supabase.from("players").update(updatePayload).eq("id", editingPlayerId);
      if (error) {
        toast({ title: t("players.errorTitle"), description: t("players.profileUpdateFailed"), variant: "destructive" });
        return;
      }

      let avatarUrl: string | null = null;
      let aiPortraitUrl: string | null = null;
      // uploadImageToStorage swallows its own errors (returns null) and the URL-attach update
      // below wasn't checked either — a failed upload used to still show the plain success toast,
      // with only a console.error nobody sees hinting anything went wrong.
      let photoFailed = false;

      if (uploadedPhoto) {
        avatarUrl = await uploadImageToStorage(uploadedPhoto, editingPlayerId, "avatar");
        if (!avatarUrl) photoFailed = true;
      }
      if (generatedPortrait) {
        aiPortraitUrl = await uploadImageToStorage(generatedPortrait, editingPlayerId, "ai-portrait");
        if (!aiPortraitUrl) photoFailed = true;
      }

      // A fresh upload for a slot wins; otherwise an explicit "remove" clears that slot; a slot
      // touched by neither is left alone (omitted, not overwritten with null).
      const photoPayload: Record<string, string | null> = {};
      if (avatarUrl) photoPayload.avatar_url = avatarUrl;
      else if (removeExistingPhoto) photoPayload.avatar_url = null;
      if (aiPortraitUrl) photoPayload.ai_portrait_url = aiPortraitUrl;
      else if (removeExistingPhoto) photoPayload.ai_portrait_url = null;

      if (Object.keys(photoPayload).length > 0) {
        const { error: linkError } = await supabase.from("players").update(photoPayload).eq("id", editingPlayerId);
        if (linkError) photoFailed = true;
      }

      resetForm();
      setDialogOpen(false);
      fetchPlayers();
      if (photoFailed) {
        toast({ title: t("players.profileUpdated"), description: t("players.photoUploadFailedDesc"), variant: "destructive" });
      } else {
        toast({ title: t("players.profileUpdated"), description: t("players.playerCardUpdated") });
      }
      return;
    }

    // Insert player first to get ID
    const { data: inserted, error } = await supabase
      .from("players")
      .insert({
        name: newName.trim(),
        nickname: newNickname.trim() || null,
        emoji: newEmoji,
        // Walk-in-Profil (Admin legt für jemanden ohne Account an): user_id bleibt null,
        // erlaubt durch die RLS-Policy "Admins can insert walk-in players".
        user_id: createWithoutAccount ? null : session?.user?.id,
        club_id: clubId,
        bio: newBio.trim() || null,
        throwing_hand: newHand || null,
        dart_weight_g: newWeight ? parseInt(newWeight) : null,
        favorite_double: newFavDouble.trim() || null,
        hometown: newHometown.trim() || null,
        joined_year: newJoinedYear ? parseInt(newJoinedYear) : null,
        motto: newMotto.trim() || null,
        birthday: newBirthday || null,
      })
      .select()
      .single();

    if (error || !inserted) {
      toast({ title: t("players.errorTitle"), description: t("players.createFailed"), variant: "destructive" });
      return;
    }

    // Upload photos if available
    let avatarUrl: string | null = null;
    let aiPortraitUrl: string | null = null;
    let photoFailed = false;

    if (uploadedPhoto) {
      avatarUrl = await uploadImageToStorage(uploadedPhoto, inserted.id, "avatar");
      if (!avatarUrl) photoFailed = true;
    }
    if (generatedPortrait) {
      aiPortraitUrl = await uploadImageToStorage(generatedPortrait, inserted.id, "ai-portrait");
      if (!aiPortraitUrl) photoFailed = true;
    }

    // Update player with image URLs
    if (avatarUrl || aiPortraitUrl) {
      const { error: linkError } = await supabase.from("players").update({
        avatar_url: avatarUrl,
        ai_portrait_url: aiPortraitUrl,
      }).eq("id", inserted.id);
      if (linkError) photoFailed = true;
    }

    // Reset form
    resetForm();
    setDialogOpen(false);
    fetchPlayers();
    if (photoFailed) {
      toast({ title: t("players.memberAdded"), description: t("players.photoUploadFailedDesc"), variant: "destructive" });
    } else {
      toast({ title: t("players.memberAdded"), description: `${newName} ${t("players.nowInClub")}` });
    }
    } finally {
      setSavingPlayer(false);
    }
  };

  const filteredPlayers = players.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.nickname?.toLowerCase().includes(search.toLowerCase())
  );
  const pagedPlayers = usePagedList(filteredPlayers);

  const isOnline = (player: PlayerProfile) => !!player.user_id && onlineNow.has(player.user_id);

  // ─── PLAYER DETAIL VIEW ────────────────────────────
  if (selectedPlayer) {
    const winRate = playerWinRate(selectedPlayer);

    const skillRadarData = [
      { skill: "Average", value: Math.min(Number(selectedPlayer.average), 100) },
      { skill: "Highscore", value: (selectedPlayer.high_score / 180) * 100 },
      { skill: t("players.winRateLabel"), value: winRate },
      { skill: t("players.experienceLabel"), value: experienceScore(selectedPlayer.games_played) },
      { skill: t("players.doubleRateLabel"), value: Number(selectedPlayer.double_rate) },
    ];

    const winLossData = [
      { label: t("game.winsLabel"), value: selectedPlayer.games_won, fill: "hsl(var(--secondary))" },
      { label: t("players.losses"), value: selectedPlayer.games_played - selectedPlayer.games_won, fill: "hsl(0 72% 51%)" },
    ];

    return (
      <div className="container py-5 space-y-4 animate-slide-up">
        <Button variant="ghost" onClick={() => setSelectedPlayer(null)} className="-ml-2 h-11 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
        </Button>

        <PlayerProfileHeader
          player={selectedPlayer}
          online={isOnline(selectedPlayer)}
          canEdit={canEditPlayer(selectedPlayer)}
          onEdit={() => openEditProfile(selectedPlayer)}
        />

        <section aria-label={t("players.profileStatsHeading")} className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <PlayerNumberTile label={t("stats.games")} value={selectedPlayer.games_played} />
          <PlayerNumberTile label={t("game.winsLabel")} value={selectedPlayer.games_won} sub={`${winRate} %`} />
          <PlayerNumberTile label="Highscore" value={selectedPlayer.high_score} />
          <PlayerNumberTile label={t("stats.average")} value={formatPlayerAverage(selectedPlayer)} />
        </section>

        {selectedPlayer.motto && (
          <PlayersCard className="flex items-start gap-3">
            <Quote className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
            <p className="font-display italic text-lg leading-snug">{selectedPlayer.motto}</p>
          </PlayersCard>
        )}

        <PlayerProfileFacts player={selectedPlayer} />

        {selectedPlayer.bio && (
          <section className="space-y-2">
            <PlayersSectionLabel>{t("players.bioHeading")}</PlayersSectionLabel>
            <PlayersCard>
              <p className="text-sm whitespace-pre-line text-foreground/90">{selectedPlayer.bio}</p>
            </PlayersCard>
          </section>
        )}

        {/* Charts — at 0 games every value in both datasets is 0, which renders as a collapsed
            radar (a single invisible point) and two zero-width bars: just axis labels over blank
            space, reading as broken rather than "no data yet". Instead a card that sends you to
            start a game, since that's the one action that actually produces the missing data. */}
        {selectedPlayer.games_played === 0 ? (
          <Link
            to="/game"
            className="block rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground hover:bg-muted active:scale-[0.98] transition-transform"
            style={{ transitionTimingFunction: "var(--ease-press)" }}
          >
            <DartGameIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
            {t("players.noStatsYetForCharts")}
          </Link>
        ) : (
          <Suspense fallback={<div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">{t("players.loadingCharts")}</div>}>
            <PlayerStatsCharts skillRadarData={skillRadarData} winLossData={winLossData} />
          </Suspense>
        )}

        {/* "PIN pro Spieler" (@/lib/playerPin): a set/change form for your own profile or, as
            admin, a walk-in (no-account) member's — same reach as the Edit button above. For a
            player WITH an account that isn't you, an admin still gets a bare reset-to-null
            (they forgot it), but can't choose a new one on that member's behalf. */}
        {(canEditPlayer(selectedPlayer) || (isAdmin && selectedPlayer.pin_hash)) && (
          <section className="space-y-2">
            <PlayersSectionLabel>{t("players.pinSectionTitle")}</PlayersSectionLabel>
            <PlayersCard className="space-y-3">
              <div className="flex items-start gap-3">
                <KeyRound className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm text-muted-foreground">
                    {canEditPlayer(selectedPlayer)
                      ? (selectedPlayer.user_id === user?.id ? t("players.pinSectionDescSelf") : t("players.pinSectionDescAdmin"))
                      : (selectedPlayer.pin_hash ? t("players.pinCurrentSet") : t("players.pinNotSet"))}
                  </p>
                  {canEditPlayer(selectedPlayer) && (
                    <p className="text-sm font-semibold">
                      {selectedPlayer.pin_hash ? t("players.pinCurrentSet") : t("players.pinNotSet")}
                    </p>
                  )}
                </div>
              </div>

              {canEditPlayer(selectedPlayer) ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4}
                      value={pinNew} onChange={(e) => setPinNew(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder={t("players.pinNewPlaceholder")}
                      aria-label={t("players.pinNewPlaceholder")}
                      className="h-11 min-w-0 rounded-xl bg-muted border border-border px-3 text-base text-foreground text-center tracking-widest" />
                    <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4}
                      value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder={t("players.pinConfirmPlaceholder")}
                      aria-label={t("players.pinConfirmPlaceholder")}
                      className="h-11 min-w-0 rounded-xl bg-muted border border-border px-3 text-base text-foreground text-center tracking-widest" />
                  </div>
                  <div className="flex gap-2">
                    <Button className="h-11 flex-1 gap-1.5 rounded-xl" disabled={pinSaving || pinNew.length !== 4} onClick={() => savePlayerPin(selectedPlayer)}>
                      {pinSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {selectedPlayer.pin_hash ? t("players.pinChangeButton") : t("players.pinSetButton")}
                    </Button>
                    {selectedPlayer.pin_hash && (
                      <Button variant="outline" className="h-11 rounded-xl" disabled={pinResetting} onClick={() => adminResetPlayerPin(selectedPlayer)}>
                        {pinResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("players.pinRemoveButton")}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <Button variant="outline" className="h-11 rounded-xl" disabled={pinResetting} onClick={() => adminResetPlayerPin(selectedPlayer)}>
                  {pinResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("players.pinResetAdminButton")}
                </Button>
              )}
            </PlayersCard>
          </section>
        )}
      </div>
    );
  }

  // ─── PLAYER LIST VIEW ──────────────────────────────
  return (
    <div className="container pt-5 pb-24 md:pb-5 space-y-4 animate-slide-up">
      <ClubRosterHeader clubName={clubName} players={players} />

      {shouldShowProfileHint && (
        <PlayersCard className="space-y-3">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold">{t("players.newProfileUpdateTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("players.profileUpdateDesc")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="h-11 flex-1 rounded-xl" onClick={openCreateProfile}>{t("players.createProfileBtn")}</Button>
            <Button variant="ghost" className="h-11 rounded-xl" onClick={dismissProfileHint}>{t("players.later")}</Button>
          </div>
        </PlayersCard>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <PlayersSectionLabel>{t("stats.members")}</PlayersSectionLabel>
        <div className="flex items-center gap-2">
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}>
          {/* Header add button only from md up — on phones the thumb-zone button below is the
              same action, so each screen width shows exactly one primary "add" button. */}
          <DialogTrigger asChild>
            <Button className="hidden md:inline-flex h-11 gap-1 rounded-xl" onClick={openCreateProfile}><Plus className="w-4 h-4" /> {t("players.memberButton")}</Button>
          </DialogTrigger>
          {/* Admin-only: Profil ohne Account (Walk-in) — nutzt denselben Dialog. */}
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className={`h-11 gap-1 rounded-xl ${isAdmin ? "" : "hidden"}`}
              onClick={openCreateWalkInProfile}
              title={t("players.walkInHint")}
            >
              <Plus className="w-4 h-4" /> {t("players.walkInButton")}
            </Button>
          </DialogTrigger>

          {/* "Daumenzone": the same openCreateProfile trigger (same shared `dialogOpen` Dialog,
              no second dialog instance) as a fixed bottom-right button, mobile only — the top of
              a long, scrolled list is outside a thumb's reach. Sits above Layout.tsx's bottom nav
              (fixed, z-50) at a lower z-index so it never competes with the nav for taps. */}
          <Button
            size="icon"
            onClick={openCreateProfile}
            aria-label={t("players.addMemberFab")}
            title={t("players.addMemberFab")}
            className="md:hidden fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full shadow-lg"
          >
            <Plus className="w-6 h-6" />
          </Button>
          <DialogContent className="bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display font-bold text-2xl">{isEditMode ? t("players.editPlayerProfileTitle") : createWithoutAccount ? t("players.walkInTitle") : t("players.newMemberTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Admin-Umschalter: eigenes Profil vs. Profil ohne Account. Existiert bereits ein
                  eigenes Profil, bleibt nur der Walk-in-Weg (ein zweites eigenes Profil wäre
                  ein Duplikat). */}
              {isAdmin && !isEditMode && (
                <label className="flex items-start gap-2.5 rounded-[14px] border border-border bg-muted px-3.5 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createWithoutAccount}
                    disabled={!!ownPlayerProfile}
                    onChange={(e) => setCreateWithoutAccount(e.target.checked)}
                    className="mt-0.5 accent-primary w-4 h-4"
                  />
                  <span>
                    <span className="text-sm font-medium block">{t("players.walkInToggleLabel")}</span>
                    <span className="text-xs text-muted-foreground">{t("players.walkInHint")}</span>
                  </span>
                </label>
              )}
              {!isEditMode && !createWithoutAccount && (
                <div className="rounded-[14px] border border-amber-500/50 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                  {t("players.ownAccountWarning")}
                </div>
              )}
              <div>
                <Label>{t("players.nameRequired")}</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("players.firstLastNamePlaceholder")} className="bg-muted border-border" />
              </div>
              <div>
                <Label>{t("players.nickname")}</Label>
                <Input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder={t("common.optional")} className="bg-muted border-border" />
              </div>

              {/* Emoji avatar picker */}
              <div>
                <Label>{t("players.emojiAvatar")}</Label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {EMOJI_AVATARS.map((a) => (
                    <button key={a} type="button" onClick={() => setNewEmoji(a)} aria-pressed={newEmoji === a}
                      className={`w-11 h-11 rounded-full border flex items-center justify-center text-xl transition-colors ${newEmoji === a ? "border-primary bg-primary/15 text-primary" : "border-border bg-muted hover:bg-muted/80"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo upload */}
              <div>
                <Label className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5" /> {t("players.uploadPhoto")}
                </Label>
                <p className="text-xs text-muted-foreground mb-2">{t("players.uploadPhotoDesc")}</p>
                <label className="flex items-center justify-center gap-2 w-full h-24 border-2 border-dashed border-border rounded-2xl cursor-pointer hover:border-primary/50 transition-colors bg-muted">
                  <input type="file" accept="image/*" onChange={handlePhotoSelect} disabled={compressingPhoto} className="hidden" />
                  {compressingPhoto ? (
                    <div className="text-center">
                      <Loader2 className="w-6 h-6 text-muted-foreground mx-auto mb-1 animate-spin" />
                      <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
                    </div>
                  ) : uploadedPhoto ? (
                    <img src={uploadedPhoto} alt="Preview" className="h-20 w-20 object-cover rounded-lg" />
                  ) : existingPhotoUrl && !removeExistingPhoto ? (
                    <img src={existingPhotoUrl} alt={t("players.currentPhoto")} className="h-20 w-20 object-cover rounded-lg" />
                  ) : (
                    <div className="text-center">
                      <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                      <span className="text-xs text-muted-foreground">{t("players.choosePhoto")}</span>
                    </div>
                  )}
                </label>
                {(uploadedPhoto || (existingPhotoUrl && !removeExistingPhoto)) && (
                  <button type="button" onClick={clearPhoto} className="min-h-11 text-sm text-destructive hover:underline">
                    {t("players.removePhoto")}
                  </button>
                )}
              </div>

              {/* AI Portrait Generation */}
              {(uploadedPhoto || newName.trim()) && (
                <div>
                  <Button
                    variant="outline"
                    onClick={generateAiPortrait}
                    disabled={generatingPortrait}
                    className="h-11 w-full gap-2 rounded-xl"
                  >
                    {generatingPortrait ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> {t("players.aiGeneratingPortrait")}</>
                    ) : (
                      <><Sparkles className="w-4 h-4 text-accent" /> {t("players.generateAiPortraitBtn")}</>
                    )}
                  </Button>

                  {generatedPortrait && (
                    <div className="mt-3 text-center">
                      <p className="text-xs text-muted-foreground mb-2">{t("players.aiGeneratedPortraitLabel")}</p>
                      <img
                        src={generatedPortrait}
                        alt="AI Generated Portrait"
                        className="w-32 h-32 rounded-full object-cover mx-auto bg-muted border border-border"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Optional details — collapsible-feel */}
              <details className="rounded-[14px] border border-border bg-muted px-3.5 py-1">
                <summary className="min-h-11 text-sm font-medium cursor-pointer select-none flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  {t("players.moreAboutMe")} <span className="text-xs text-muted-foreground">{t("players.allOptional")}</span>
                </summary>
                <div className="mt-1 mb-3 space-y-3">
                  <div>
                    <Label>{t("players.bioLabel")}</Label>
                    <Textarea
                      value={newBio}
                      onChange={(e) => setNewBio(e.target.value)}
                      placeholder={t("players.bioPlaceholder")}
                      className="bg-card border-border min-h-[70px]"
                    />
                  </div>
                  <div>
                    <Label>{t("players.motto")}</Label>
                    <Input
                      value={newMotto}
                      onChange={(e) => setNewMotto(e.target.value)}
                      placeholder={t("players.mottoPlaceholder")}
                      className="bg-card border-border"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t("players.throwingHand")}</Label>
                      <Select value={newHand} onValueChange={setNewHand}>
                        <SelectTrigger className="bg-card border-border"><SelectValue placeholder={t("players.choosePlaceholder")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="right">{t("players.right")}</SelectItem>
                          <SelectItem value="left">{t("players.left")}</SelectItem>
                          <SelectItem value="ambi">{t("players.ambidextrous")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t("players.dartWeightLabel")}</Label>
                      <Input
                        type="number" min={10} max={50}
                        value={newWeight}
                        onChange={(e) => setNewWeight(e.target.value)}
                        placeholder={t("players.egWeight")}
                        className="bg-card border-border"
                      />
                    </div>
                    <div>
                      <Label>{t("players.favoriteDouble")}</Label>
                      <Input
                        value={newFavDouble}
                        onChange={(e) => setNewFavDouble(e.target.value)}
                        placeholder={t("players.egDouble")}
                        className="bg-card border-border"
                      />
                    </div>
                    <div>
                      <Label>{t("players.hometown")}</Label>
                      <Input
                        value={newHometown}
                        onChange={(e) => setNewHometown(e.target.value)}
                        placeholder={t("players.egHometown")}
                        className="bg-card border-border"
                      />
                    </div>
                    <div>
                      <Label>{t("players.memberSince")}</Label>
                      <Input
                        type="number" min={1900} max={2100}
                        value={newJoinedYear}
                        onChange={(e) => setNewJoinedYear(e.target.value)}
                        placeholder={t("players.egYear")}
                        className="bg-card border-border"
                      />
                    </div>
                    <div>
                      <Label>{t("players.birthday")}</Label>
                      <Input
                        type="date"
                        value={newBirthday}
                        onChange={(e) => setNewBirthday(e.target.value)}
                        className="bg-card border-border"
                      />
                    </div>
                  </div>
                </div>
              </details>

              <Button onClick={addPlayer} className="h-12 w-full rounded-[14px] text-base font-semibold" disabled={!newName.trim() || savingPlayer}>
                {savingPlayer ? t("players.saving") : isEditMode ? t("players.saveProfile") : t("players.addMemberBtn")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("players.searchMemberPlaceholder")} aria-label={t("players.searchMemberPlaceholder")} className="h-11 rounded-[14px] pl-10 bg-card border-border text-base md:text-sm" />
      </div>

      {loading ? (
        <div role="status" aria-label={t("common.loading")} className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filteredPlayers.length === 0 ? (
        <PlayersCard className="py-10 text-center text-muted-foreground">
          <Target className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden />
          <p className="text-sm">{search.trim() ? t("players.noSearchMatches") : t("players.noMembersYet")}</p>
        </PlayersCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 items-start">
          {pagedPlayers.visible.map((player) => (
            <PlayerRosterRow
              key={player.id}
              player={player}
              online={isOnline(player)}
              expanded={!!expandedCards[player.id]}
              onExpandedChange={() => toggleCard(player.id)}
              onOpenProfile={() => setSelectedPlayer(player)}
              canEdit={canEditPlayer(player)}
              onEdit={() => openEditProfile(player)}
            >
              {isAdmin && !player.user_id && (
                <div className="rounded-xl bg-muted px-3 py-2.5 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-1.5"><Users className="w-4 h-4 text-muted-foreground" aria-hidden /> {t("players.linkAccountLabel")}</p>
                  <p className="text-xs text-muted-foreground">{t("players.linkAccountDesc")}</p>
                  {linkableAccounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">{t("players.linkAccountEmpty")}</p>
                  ) : (
                    <div className="flex gap-2">
                      <Select
                        value={linkTarget[player.id] ?? ""}
                        onValueChange={(v) => setLinkTarget((prev) => ({ ...prev, [player.id]: v }))}
                      >
                        <SelectTrigger className="h-11 min-w-0 rounded-xl bg-card text-sm flex-1">
                          <SelectValue placeholder={t("players.linkAccountPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {linkableAccounts.map((a) => (
                            <SelectItem key={a.user_id} value={a.user_id} className="text-xs">{a.email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        className="h-11 rounded-xl shrink-0"
                        disabled={!linkTarget[player.id] || linkingId === player.id}
                        onClick={() => linkPlayerAccount(player)}
                      >
                        {linkingId === player.id ? t("players.linkAccountLinking") : t("players.linkAccountBtn")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {isAdmin && !player.user_id && (
                <AlertDialog open={confirmDeleteId === player.id} onOpenChange={(open) => setConfirmDeleteId(open ? player.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-11 w-full justify-center gap-1.5 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={deletingId === player.id}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> {t("players.removeProfile")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{player.name} {t("players.removeConfirmSuffix")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("players.removeWarning")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deletingId === player.id}>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async (e) => {
                          // Radix closes the dialog synchronously on click by default — without
                          // preventDefault the "Entfernt…" disabled state never gets a chance to
                          // render, and a failed delete's error toast appears after the
                          // confirmation dialog has already vanished.
                          e.preventDefault();
                          await deletePlayer(player);
                          setConfirmDeleteId(null);
                        }}
                        disabled={deletingId === player.id}
                      >
                        {deletingId === player.id ? t("players.removing") : t("players.remove")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {isAdmin && player.user_id && (
                <p className="text-xs text-muted-foreground text-center">
                  {t("players.linkedAccountNotePrefix")} <Link to="/admin" className="text-primary underline">{t("players.memberManagement")}</Link> {t("players.linkedAccountNoteSuffix")}
                </p>
              )}
            </PlayerRosterRow>
          ))}
        </div>
      )}
      {!loading && filteredPlayers.length > 0 && <ListPaginationFooter list={pagedPlayers} />}
    </div>
  );
};

export default PlayersPage;
