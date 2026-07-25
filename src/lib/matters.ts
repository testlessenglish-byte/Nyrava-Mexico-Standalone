import { supabase } from "@/integrations/supabase/client";

export const MATTER_TYPES = [
  "litigation","criminal","civil","commercial","labor","family",
  "constitutional","administrative","corporate","tax","immigration",
  "contract","advisory","compliance","transaction",
] as const;
export type MatterType = (typeof MATTER_TYPES)[number];

export const MATTER_TYPE_LABEL: Record<MatterType, string> = {
  litigation: "Litigio",
  criminal: "Penal",
  civil: "Civil",
  commercial: "Mercantil",
  labor: "Laboral",
  family: "Familiar",
  constitutional: "Constitucional / Amparo",
  administrative: "Administrativo",
  corporate: "Corporativo",
  tax: "Fiscal",
  immigration: "Migratorio",
  contract: "Contratos",
  advisory: "Asesoría",
  compliance: "Cumplimiento",
  transaction: "Transaccional",
};

export const MATTER_STATUS = ["intake","active","on_hold","closed","archived"] as const;
export type MatterStatus = (typeof MATTER_STATUS)[number];
export const MATTER_STATUS_LABEL: Record<MatterStatus, string> = {
  intake: "Recepción",
  active: "Activo",
  on_hold: "En pausa",
  closed: "Cerrado",
  archived: "Archivado",
};

export type Matter = {
  id: string;
  org_id: string;
  title: string;
  reference_code: string | null;
  matter_type: MatterType;
  practice_area: string | null;
  jurisdiction: string | null;
  court: string | null;
  docket_number: string | null;
  status: MatterStatus;
  priority: "low" | "normal" | "high" | "urgent";
  opened_at: string;
  closed_at: string | null;
  client_name: string | null;
  description: string | null;
  tags: string[];
  created_at: string;
};

export async function listMatters(orgId: string): Promise<Matter[]> {
  const { data, error } = await supabase
    .from("matters")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Matter[];
}

export async function getMatter(id: string): Promise<Matter | null> {
  const { data, error } = await supabase.from("matters").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Matter) ?? null;
}

export async function createMatter(input: {
  org_id: string;
  title: string;
  matter_type: MatterType;
  client_name?: string;
  jurisdiction?: string;
  reference_code?: string;
  description?: string;
}): Promise<Matter> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  const { data, error } = await supabase
    .from("matters")
    .insert({ ...input, created_by: uid })
    .select("*")
    .single();
  if (error) throw error;
  return data as Matter;
}
