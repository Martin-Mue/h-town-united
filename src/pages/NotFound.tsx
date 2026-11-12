import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { MapPinOff } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import EntryIconTile from "@/components/entry/EntryIconTile";

const NotFound = () => {
  const location = useLocation();
  const { t } = useLanguage();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="container flex min-h-[60vh] max-w-sm flex-col justify-center gap-4 py-8 animate-slide-up">
      <header className="flex items-center gap-3">
        <EntryIconTile icon={MapPinOff} />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">404</p>
          <h1 className="font-display text-[28px] font-bold leading-tight">{t("notFound.pageNotFound")}</h1>
        </div>
      </header>
      <Link
        to="/"
        className="flex h-[52px] items-center justify-center rounded-[14px] bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        {t("notFound.returnHome")}
      </Link>
    </div>
  );
};

export default NotFound;
