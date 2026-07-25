import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";

export type AppRole = "admin" | "moderator" | "user" | "super_admin" | "platform_admin";

export function useRoles() {
  const { user } = useSession();
  const q = useQuery({
    queryKey: ["user_roles", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
  const roles = q.data ?? [];
  const isSuperAdmin = roles.includes("super_admin") || roles.includes("platform_admin");
  const isAdmin = isSuperAdmin || roles.includes("admin");
  return { roles, isSuperAdmin, isAdmin, loading: q.isLoading };
}
