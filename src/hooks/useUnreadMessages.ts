// Unread count for the header bell, dedicated to the support/message
// system (Comentarios + Ayuda y soporte) — deliberately NOT the same signal
// as /alerts (case pipeline/finding notifications), which already surface
// inside each case's own Reports/Findings tabs and stay on their own page.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { countMyUnreadSupportThreads, adminCountUnreadSupportThreads } from "@/lib/support.functions";

export function useUnreadMessages(isAdmin: boolean) {
  const fetchMine = useServerFn(countMyUnreadSupportThreads);
  const fetchAdmin = useServerFn(adminCountUnreadSupportThreads);

  const q = useQuery({
    queryKey: ["unread-support-threads", isAdmin],
    queryFn: () => (isAdmin ? fetchAdmin() : fetchMine()),
    refetchInterval: 20000,
  });

  return { unreadCount: q.data?.count ?? 0 };
}
