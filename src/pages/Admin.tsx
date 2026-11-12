import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { Shield } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import AdminTabTrigger from "@/components/admin/AdminTabTrigger";
import AdminMemberCard, { type AdminUser } from "@/components/admin/AdminMemberCard";
import AdminStats from "@/components/admin/AdminStats";
import AdminUsage from "@/components/admin/AdminUsage";
import AdminClubs from "@/components/admin/AdminClubs";
import { useIsPlatformOwner } from "@/hooks/useIsPlatformOwner";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import AdminTrainingReview from "@/components/admin/AdminTrainingReview";
import AdminTournamentForecast from "@/components/admin/AdminTournamentForecast";
import AdminInvites from "@/components/admin/AdminInvites";
import AdminMergePlayers from "@/components/admin/AdminMergePlayers";
import AdminClubBranding from "@/components/admin/AdminClubBranding";
import AdminBilling from "@/components/admin/AdminBilling";
import AdminAutodarts from "@/components/admin/AdminAutodarts";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";

const ACTIVE_TAB_STORAGE_KEY = "admin-active-tab";

const readRememberedTab = (): string => {
  try {
    return sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || "members";
  } catch {
    return "members";
  }
};

/** Admin-only page: manage member roles and accounts. */
const AdminPage = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const pagedUsers = usePagedList(users);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Club admins manage their club; the analysis areas (usage, statistics, AI trainer) are for the
  // operator of the whole app only (public.platform_owners) and stay hidden for everyone else.
  const isOwner = useIsPlatformOwner(user?.id) === true;
  const [activeTab, setActiveTab] = useState(readRememberedTab);
  const OWNER_ONLY_TABS = ["clubs", "usage", "stats", "trainer"];
  // A club with the permanent free plan (free_locked) has nothing to book or pay: the billing tab would
  // only say "free", so it is hidden there and stays for every club that can actually subscribe.
  const { club } = useClubBranding();
  const showBilling = club?.plan_tier !== "free_locked";
  const shownTab = (!isOwner && OWNER_ONLY_TABS.includes(activeTab)) || (!showBilling && activeTab === "billing") ? "members" : activeTab;
  const changeTab = (tab: string) => {
    setActiveTab(tab);
    try {
      sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
    } catch {
      // storage unavailable (private mode) -- the tab just isn't remembered
    }
  };

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
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } else {
      setUsers((data as AdminUser[]) ?? []);
    }
    setLoading(false);
  }, [user, toast, t]);

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
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } else {
      const titleKey = role === "admin"
        ? (grant ? "admin.adminRoleGrantedTitle" : "admin.adminRoleRevokedTitle")
        : (grant ? "admin.editorRoleGrantedTitle" : "admin.editorRoleRevokedTitle");
      toast({ title: t(titleKey) });
      load();
    }
    setBusyId(null);
  };

  const deleteUser = async (u: AdminUser) => {
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_delete_user", { _user_id: u.user_id });
    if (error) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("admin.memberRemovedTitle") });
      load();
    }
    setBusyId(null);
  };

  if (loading) {
    return (
      <div role="status" aria-label={t("common.loading")} className="container py-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container py-12 max-w-sm mx-auto">
        <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-3">
          <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
            <Shield className="w-6 h-6 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold leading-tight">{t("admin.noAccessTitle")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("admin.noAccessDesc")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4 animate-slide-up space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-tight">{t("admin.title")}</h1>

      <Tabs value={shownTab} onValueChange={changeTab}>
        {/* Wraps onto several rows instead of one long inline strip: the strip used to be wider than
            the screen, so the whole page scrolled sideways and the active tab could be out of sight. */}
        <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1 rounded-[14px] border border-border bg-card p-1">
          <AdminTabTrigger value="members">{t("admin.tabMembers")}</AdminTabTrigger>
          <AdminTabTrigger value="invites">{t("admin.tabInvites")}</AdminTabTrigger>
          <AdminTabTrigger value="branding">{t("admin.tabBranding")}</AdminTabTrigger>
          {showBilling && <AdminTabTrigger value="billing">{t("admin.tabBilling")}</AdminTabTrigger>}
          {/* Proper noun (product name), same in every language -- not routed through t() like the
              other tabs, same reasoning AdminAutodarts.tsx itself uses plain German strings rather
              than pulling in translation keys for a Paid-Plan admin feature. */}
          <AdminTabTrigger value="autodarts">Autodarts</AdminTabTrigger>
          <AdminTabTrigger value="forecast">{t("admin.tabForecast")}</AdminTabTrigger>
          {isOwner && (
            <>
              <span className="mt-1 w-full border-t border-border px-2 pt-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Plattform · nur für dich sichtbar
              </span>
              <AdminTabTrigger value="clubs">Vereine</AdminTabTrigger>
              <AdminTabTrigger value="usage">Nutzung</AdminTabTrigger>
              <AdminTabTrigger value="stats">{t("admin.tabStats")}</AdminTabTrigger>
              <AdminTabTrigger value="trainer">KI-Trainer</AdminTabTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="members">
          <p className="text-sm text-muted-foreground mb-4">
            {t("admin.membersIntro")}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pagedUsers.visible.map((u) => (
              <AdminMemberCard
                key={u.user_id}
                member={u}
                isSelf={u.user_id === user?.id}
                busy={busyId === u.user_id}
                confirmDeleteOpen={confirmDeleteId === u.user_id}
                onConfirmDeleteOpenChange={(open) => setConfirmDeleteId(open ? u.user_id : null)}
                onSetRole={(role, grant) => setRole(u, role, grant)}
                onDelete={() => deleteUser(u)}
              />
            ))}
          </div>
          <ListPaginationFooter list={pagedUsers} />
          <AdminMergePlayers />
        </TabsContent>

        <TabsContent value="invites">
          <AdminInvites />
        </TabsContent>

        <TabsContent value="branding">
          <AdminClubBranding />
        </TabsContent>

        {showBilling && (
          <TabsContent value="billing">
            <AdminBilling />
          </TabsContent>
        )}

        <TabsContent value="autodarts">
          <AdminAutodarts />
        </TabsContent>

        {isOwner && (
          <>
            <TabsContent value="clubs">
              <AdminClubs />
            </TabsContent>

            <TabsContent value="usage">
              <AdminUsage />
            </TabsContent>

            <TabsContent value="stats">
              <AdminStats />
            </TabsContent>

            <TabsContent value="trainer">
              <AdminTrainingReview />
            </TabsContent>
          </>
        )}

        <TabsContent value="forecast">
          <AdminTournamentForecast />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPage;
