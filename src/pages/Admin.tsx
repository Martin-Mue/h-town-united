import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, ShieldOff, Trash2, UserCog, Pencil, PencilOff } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminStats from "@/components/admin/AdminStats";
import AdminTournamentForecast from "@/components/admin/AdminTournamentForecast";
import AdminInvites from "@/components/admin/AdminInvites";
import AdminClubBranding from "@/components/admin/AdminClubBranding";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";

interface AdminUser {
  user_id: string;
  email: string;
  created_at: string;
  roles: ("admin" | "member" | "editor")[];
}

/** Admin-only page: manage member roles and accounts. */
const AdminPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const pagedUsers = usePagedList(users);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const admin = !!roleRows?.some((r) => r.role === "admin");
    setIsAdmin(admin);
    if (!admin) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc("admin_list_users");
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      setUsers((data as AdminUser[]) ?? []);
    }
    setLoading(false);
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setRole = async (u: AdminUser, role: "admin" | "editor", grant: boolean) => {
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_set_role", {
      _user_id: u.user_id,
      _role: role,
      _grant: grant,
    });
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      const roleLabel = role === "admin" ? "Admin-Rolle" : "Turnier-Bearbeitung";
      toast({ title: grant ? `${roleLabel} vergeben` : `${roleLabel} entzogen` });
      load();
    }
    setBusyId(null);
  };

  const deleteUser = async (u: AdminUser) => {
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_delete_user", { _user_id: u.user_id });
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Mitglied entfernt" });
      load();
    }
    setBusyId(null);
  };

  if (loading) {
    return (
      <div role="status" aria-label="Lädt …" className="container py-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container py-12 text-center">
        <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-xl font-display uppercase">Kein Zugriff</h2>
        <p className="text-sm text-muted-foreground mt-1">Nur Admins können Mitglieder verwalten.</p>
      </div>
    );
  }

  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center gap-2 mb-6">
        <UserCog className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-display uppercase">Administration</h1>
      </div>

      <Tabs defaultValue="members">
        <TabsList className="mb-4">
          <TabsTrigger value="members">Mitglieder</TabsTrigger>
          <TabsTrigger value="invites">Einladungen</TabsTrigger>
          <TabsTrigger value="branding">Design</TabsTrigger>
          <TabsTrigger value="stats">Statistiken</TabsTrigger>
          <TabsTrigger value="forecast">Turnier-Prognose</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
      <p className="text-sm text-muted-foreground mb-4">
        Hier kannst du Rollen vergeben und Accounts entfernen. Du selbst kannst dir die Admin-Rolle nicht entziehen.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pagedUsers.visible.map((u) => {
          const isSelf = u.user_id === user?.id;
          const isAdminUser = u.roles?.includes("admin");
          const isEditorUser = u.roles?.includes("editor");
          const initial = u.email.trim().charAt(0).toUpperCase() || "?";
          return (
            <div key={u.user_id} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3 hover:border-primary/40 transition-colors">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-display text-sm ${isAdminUser ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono truncate">
                  {u.email}
                  {isSelf && <span className="ml-1.5 text-[10px] text-primary uppercase">(Du)</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {u.roles?.length ? (
                    u.roles.map((r) => (
                      <Badge
                        key={r}
                        variant="outline"
                        className={`text-[10px] uppercase px-1.5 py-0.5 border-transparent ${
                          r === "admin" ? "bg-primary/15 text-primary" : r === "editor" ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground">–</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">· seit {new Date(u.created_at).toLocaleDateString("de-DE")}</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {isAdminUser ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      disabled={isSelf || busyId === u.user_id}
                      onClick={() => setRole(u, "admin", false)}
                      title={isSelf ? "Du kannst dir die Admin-Rolle nicht selbst entziehen" : "Admin entziehen"}
                    >
                      <ShieldOff className="w-3.5 h-3.5" /> Admin entziehen
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      disabled={busyId === u.user_id}
                      onClick={() => setRole(u, "admin", true)}
                      title="Zum Admin machen"
                    >
                      <Shield className="w-3.5 h-3.5" /> Zum Admin machen
                    </Button>
                  )}
                  {/* Vereinsweite Turnier-/Saison-Bearbeitungsrechte ohne volle Admin-Rolle —
                      ersetzt den früher hartkodierten TRUSTED_RESULT_EDITOR_ID-Sonderfall. */}
                  {isEditorUser ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      disabled={busyId === u.user_id}
                      onClick={() => setRole(u, "editor", false)}
                      title="Turnier-Bearbeitung entziehen"
                    >
                      <PencilOff className="w-3.5 h-3.5" /> Bearbeitung entziehen
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      disabled={busyId === u.user_id}
                      onClick={() => setRole(u, "editor", true)}
                      title="Turnier-/Saison-Bearbeitung erlauben"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Bearbeitung erlauben
                    </Button>
                  )}
                  <AlertDialog open={confirmDeleteId === u.user_id} onOpenChange={(open) => setConfirmDeleteId(open ? u.user_id : null)}>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        disabled={isSelf || busyId === u.user_id}
                        title={isSelf ? "Du kannst dich nicht selbst löschen" : "Mitglied entfernen"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Mitglied entfernen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {u.email} wird unwiderruflich aus dem Verein entfernt. Spiele und Statistiken bleiben erhalten.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={busyId === u.user_id}>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async (e) => {
                            e.preventDefault();
                            await deleteUser(u);
                            setConfirmDeleteId(null);
                          }}
                          disabled={busyId === u.user_id}
                        >
                          {busyId === u.user_id ? "Entfernt…" : "Entfernen"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <ListPaginationFooter list={pagedUsers} />
        </TabsContent>

        <TabsContent value="invites">
          <AdminInvites />
        </TabsContent>

        <TabsContent value="branding">
          <AdminClubBranding />
        </TabsContent>

        <TabsContent value="stats">
          <AdminStats />
        </TabsContent>

        <TabsContent value="forecast">
          <AdminTournamentForecast />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPage;