import { useEffect, useState } from "react";
import { Download, Copy, Loader2, QrCode as QrCodeIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { generateQrDataUrl } from "@/lib/qrcode";
import { useToast } from "@/hooks/use-toast";

interface QrCodeDialogProps {
  url: string;
  title: string;
  description?: string;
  trigger: React.ReactNode;
  /** Filename for the downloaded PNG, without extension. */
  downloadName?: string;
}

/** Reusable "scan to open" dialog — generates the code on demand (no third-party image
 *  API) so the destination URL never has to leave the device just to render a code for it. */
const QrCodeDialog = ({ url, title, description, trigger, downloadName = "qr-code" }: QrCodeDialogProps) => {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setDataUrl(null);
    generateQrDataUrl(url).then(setDataUrl).catch(() => setDataUrl(null));
  }, [open, url]);

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link kopiert", description: url }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display uppercase flex items-center gap-2">
            <QrCodeIcon className="w-4 h-4 text-primary" /> {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl border border-border bg-white p-3 w-full max-w-[280px] aspect-square flex items-center justify-center">
            {dataUrl ? (
              <img src={dataUrl} alt="QR-Code" className="w-full h-full" />
            ) : (
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center break-all">{url}</p>
          <div className="flex gap-2 w-full">
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={copyLink}>
              <Copy className="w-3.5 h-3.5" /> Link kopieren
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              disabled={!dataUrl}
              onClick={() => {
                if (!dataUrl) return;
                const a = document.createElement("a");
                a.href = dataUrl;
                a.download = `${downloadName}.png`;
                a.click();
              }}
            >
              <Download className="w-3.5 h-3.5" /> PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QrCodeDialog;
