import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getCurrentPushSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";

export function usePushSubscription(userId: string | undefined) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const supported = isPushSupported();

  useEffect(() => {
    if (!supported) return;
    getCurrentPushSubscription().then((sub) => setEnabled(!!sub));
  }, [supported]);

  const toggle = async () => {
    if (!supported || !userId || busy) return;
    setBusy(true);
    try {
      if (enabled) {
        await unsubscribeFromPush();
        setEnabled(false);
        toast({ title: "Benachrichtigungen deaktiviert" });
      } else {
        const ok = await subscribeToPush(userId);
        setEnabled(ok);
        if (ok) {
          toast({ title: "Benachrichtigungen aktiviert", description: "z. B. wenn dein Turnierspiel als Nächstes dran ist." });
        } else if (Notification.permission === "denied") {
          toast({ title: "Berechtigung verweigert", description: "Benachrichtigungen sind in den Browser-Einstellungen blockiert.", variant: "destructive" });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return { supported, enabled, busy, toggle };
}
