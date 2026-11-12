import { Shield, ShieldOff, Trash2, Pencil, PencilOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";

export interface AdminUser {
  user_id: string;
  email: string;
  created_at: string;
  roles: ("admin" | "member" | "editor")[];
}

interface AdminMemberCardProps {
  member: AdminUser;
  isSelf: boolean;
  busy: boolean;
  confirmDeleteOpen: boolean;
  onConfirmDeleteOpenChange: (open: boolean) => void;
  onSetRole: (role: "admin" | "editor", grant: boolean) => void;
  onDelete: () => Promise<void>;
}

const ACTION_BUTTON_CLASS = "h-11 rounded-xl text-[13px] gap-1.5 hover:shadow-none";

/** One account on the admin "Mitglieder" tab: e-mail, roles, member since, and the role / remove
 *  actions. Pure presentation — the page owns every RPC call and the busy/confirm state. */
const AdminMemberCard = ({
  member,
  isSelf,
  busy,
  confirmDeleteOpen,
  onConfirmDeleteOpenChange,
  onSetRole,
  onDelete,
}: AdminMemberCardProps) => {
  const { t, language } = useLanguage();
  const isAdminUser = member.roles?.includes("admin");
  const isEditorUser = member.roles?.includes("editor");
  const initial = member.email.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-display font-bold text-base ${isAdminUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">
          {member.email}
          {isSelf && <span className="ml-1.5 text-[11px] font-medium text-muted-foreground uppercase">({t("admin.selfBadge")})</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {member.roles?.length ? (
            member.roles.map((r) => (
              <Badge
                key={r}
                variant="outline"
                className={`text-[11px] uppercase px-1.5 py-0.5 ${
                  r === "admin" ? "border-primary/40 text-foreground" : r === "editor" ? "border-secondary/40 text-secondary" : "border-border text-muted-foreground"
                }`}
              >
                {r}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">–</span>
          )}
          <span className="text-xs text-muted-foreground">· {t("admin.memberSinceLabel")} {new Date(member.created_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language])}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {isAdminUser ? (
            <Button
              variant="outline"
              className={ACTION_BUTTON_CLASS}
              disabled={isSelf || busy}
              onClick={() => onSetRole("admin", false)}
              title={isSelf ? t("admin.cantRevokeOwnAdminTitle") : t("admin.revokeAdminBtn")}
            >
              <ShieldOff className="w-4 h-4" /> {t("admin.revokeAdminBtn")}
            </Button>
          ) : (
            <Button
              variant="outline"
              className={ACTION_BUTTON_CLASS}
              disabled={busy}
              onClick={() => onSetRole("admin", true)}
              title={t("admin.makeAdminBtn")}
            >
              <Shield className="w-4 h-4" /> {t("admin.makeAdminBtn")}
            </Button>
          )}
          {/* Vereinsweite Turnier-/Saison-Bearbeitungsrechte ohne volle Admin-Rolle —
              ersetzt den früher hartkodierten TRUSTED_RESULT_EDITOR_ID-Sonderfall. */}
          {isEditorUser ? (
            <Button
              variant="outline"
              className={ACTION_BUTTON_CLASS}
              disabled={busy}
              onClick={() => onSetRole("editor", false)}
              title={t("admin.revokeEditorTitle")}
            >
              <PencilOff className="w-4 h-4" /> {t("admin.revokeEditorBtn")}
            </Button>
          ) : (
            <Button
              variant="outline"
              className={ACTION_BUTTON_CLASS}
              disabled={busy}
              onClick={() => onSetRole("editor", true)}
              title={t("admin.grantEditorTitle")}
            >
              <Pencil className="w-4 h-4" /> {t("admin.grantEditorBtn")}
            </Button>
          )}
          <AlertDialog open={confirmDeleteOpen} onOpenChange={onConfirmDeleteOpenChange}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="h-11 w-11 rounded-xl p-0 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:shadow-none"
                disabled={isSelf || busy}
                title={isSelf ? t("admin.cantDeleteSelfTitle") : t("admin.removeMemberBtnTitle")}
                aria-label={isSelf ? t("admin.cantDeleteSelfTitle") : t("admin.removeMemberBtnTitle")}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("admin.removeMemberDialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {member.email} {t("admin.removeMemberDescSuffix")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async (e) => {
                    e.preventDefault();
                    await onDelete();
                    onConfirmDeleteOpenChange(false);
                  }}
                  disabled={busy}
                >
                  {busy ? t("admin.removingBtn") : t("admin.removeBtn")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
};

export default AdminMemberCard;
