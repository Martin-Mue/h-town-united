import { useEffect, useRef, useState } from "react";
import { Target, RefreshCw } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import SettingsSection from "./SettingsSection";
import SettingsRow from "./SettingsRow";
import {
  linkAutodartsAccount,
  loadAutodartsAccount,
  reloadAutodartsBoards,
  setAutodartsDefaultBoard,
  unlinkAutodartsAccount,
  waitForAutodartsAccount,
  type AutodartsAccountState,
} from "@/lib/autodartsClient";

const INPUT_CLASS = "h-11 rounded-xl bg-background border-border text-base";

/**
 * Settings card where every member links their OWN Autodarts account and picks the board it should
 * score on. The password goes straight to Autodarts' login (server-side, via pg_net) and is never
 * stored -- only the refresh token, encrypted. Club boards stay with the admin (Admin > Autodarts).
 */
const AutodartsAccountSection = () => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [state, setState] = useState<AutodartsAccountState | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    waitForAutodartsAccount(() => unmountedRef.current)
      .then((s) => { if (!unmountedRef.current) setState(s); })
      .catch(() => { if (!unmountedRef.current) setState({ status: "disconnected", loading: false, email: null, username: null, boards: [], boardsUpdatedAt: null, defaultBoardId: null, lastError: null }); });
    return () => { unmountedRef.current = true; };
  }, []);

  const settle = async () => {
    const s = await waitForAutodartsAccount(() => unmountedRef.current);
    if (!unmountedRef.current) setState(s);
    return s;
  };

  const connect = async () => {
    setBusy(true);
    try {
      await linkAutodartsAccount(email.trim(), password);
      setPassword("");
      setState((s) => (s ? { ...s, status: "connecting", loading: true } : s));
      const s = await settle();
      if (s.status === "error") toast({ title: t("autodarts.linkFailed"), description: s.lastError ?? undefined, variant: "destructive" });
    } catch (e) {
      toast({ title: t("autodarts.linkFailed"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      await reloadAutodartsBoards();
      await settle();
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const chooseBoard = async (boardId: string) => {
    setState((s) => (s ? { ...s, defaultBoardId: boardId } : s));
    try {
      await setAutodartsDefaultBoard(boardId);
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      setState(await loadAutodartsAccount());
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await unlinkAutodartsAccount();
      setState({ status: "disconnected", loading: false, email: null, username: null, boards: [], boardsUpdatedAt: null, defaultBoardId: null, lastError: null });
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const linked = state?.status === "connected";
  const working = busy || !!state?.loading;

  return (
    <SettingsSection>
      <SettingsRow icon={Target} label={t("autodarts.settingsTitle")} description={t("autodarts.settingsDesc")}>
        {!state ? (
          <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : linked ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              {t("autodarts.connectedAs").replace("{name}", state.username || state.email || "")}
            </p>
            {state.boards.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{working ? t("autodarts.connecting") : t("autodarts.noBoards")}</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium">{t("autodarts.myBoard")}</p>
                <Select value={state.defaultBoardId ?? undefined} onValueChange={chooseBoard}>
                  <SelectTrigger className="h-11 rounded-xl border-border bg-background" aria-label={t("autodarts.myBoard")}>
                    <SelectValue placeholder={t("autodarts.myBoard")} />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card">
                    {state.boards.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} · {b.connected ? t("autodarts.online") : t("autodarts.offline")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1 gap-1.5 rounded-xl hover:shadow-none" disabled={working} onClick={reload}>
                {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("autodarts.reloadBoards")}
              </Button>
              <Button variant="outline" className="h-11 rounded-xl hover:shadow-none" disabled={busy} onClick={unlink}>
                {t("autodarts.unlink")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-2.5"
            onSubmit={(e) => { e.preventDefault(); if (email.trim() && password) void connect(); }}
          >
            {state.status === "error" && state.lastError && (
              <p className="text-[13px] text-destructive">{state.lastError}</p>
            )}
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t("autodarts.email")} aria-label={t("autodarts.email")} className={INPUT_CLASS} />
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={t("autodarts.password")} aria-label={t("autodarts.password")} className={INPUT_CLASS} />
            <p className="text-xs text-muted-foreground">{t("autodarts.passwordNote")}</p>
            <Button type="submit" className="h-11 w-full gap-1.5 rounded-xl font-semibold hover:shadow-none" disabled={working || !email.trim() || !password}>
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {working ? t("autodarts.connecting") : t("autodarts.connect")}
            </Button>
          </form>
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default AutodartsAccountSection;
