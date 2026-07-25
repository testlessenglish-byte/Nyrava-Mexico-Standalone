import { supabase } from "@/integrations/supabase/client";

export type Org = {
  id: string;
  name: string;
  slug: string;
  edition: string;
  plan: string;
  status: string;
};

export type Membership = {
  org_id: string;
  role_in_org: "owner" | "admin" | "lawyer" | "paralegal" | "viewer";
  organizations: Org;
};

export async function fetchMyMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("org_memberships")
    .select("org_id, role_in_org, organizations!inner(id,name,slug,edition,plan,status)")
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []) as unknown as Membership[];
}

export async function createOrganization(input: { name: string; slug: string }) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("No autenticado");
  const { data, error } = await supabase
    .from("organizations")
    .insert({ name: input.name, slug: input.slug, created_by: uid })
    .select("*")
    .single();
  if (error) throw error;
  return data as Org;
}

export const CURRENT_ORG_KEY = "nyrava:current_org";
export function getCurrentOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CURRENT_ORG_KEY);
}
export function setCurrentOrgId(id: string) {
  localStorage.setItem(CURRENT_ORG_KEY, id);
}
