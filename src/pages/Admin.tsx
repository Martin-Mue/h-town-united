import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Shield, ShieldOff, Trash2, UserCog } from "lucide-react";
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

interface AdminUser {
  user_id: string;
  email: string;
  created_at: string;
  roles: ("admin" | "member")[];
}

/** Admin-only page: manage member roles and accounts. */
const AdminPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const setRole = async (u: AdminUser, role: "admin", grant: boolean) => {
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_set_role", {
      _user_id: u.user_id,
      _role: role,
      _grant: grant,
    });
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      toast({ title: grant ? "Admin-Rolle vergeben" : "Admin-Rolle entzogen" });
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
      <div className="container py-12 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
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
        <h1 className="text-2xl font-display uppercase">Mitgliederverwaltung</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Hier kannst du Rollen vergeben und Accounts entfernen. Du selbst kannst dir die Admin-Rolle nicht entziehen.
      </p>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2">E-Mail</th>
              <th className="px-4 py-2">Rollen</th>
              <th className="px-4 py-2">Beitritt</th>
              <th className="px-4 py-2 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.user_id === user?.id;
              const isAdminUser = u.roles?.includes("admin");
              return (
                <tr key={u.user_id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs">
                    {u.email}
                    {isSelf && <span className="ml-2 text-[10px] text-primary uppercase">(Du)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {u.roles?.length ? (
                      u.roles.map((r) => (
                        <span
                          key={r}
                          className={`text-[10px] uppercase px-1.5 py-0.5 rounded mr-1 ${
                            r === "admin"
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">–</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("de-DE")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      {isAdminUser ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSelf || busyId === u.user_id}
                          onClick={() => setRole(u, "admin", false)}
                          title={isSelf ? "Du kannst dir die Admin-Rolle nicht selbst entziehen" : "Admin entziehen"}
                        >
                          <ShieldOff className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === u.user_id}
                          onClick={() => setRole(u, "admin", true)}
                          title="Zum Admin machen"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10"
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
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteUser(u)}>Entfernen</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminPage;