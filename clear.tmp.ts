import { supabaseAdmin } from "@/integrations/supabase/client.server";
const db = supabaseAdmin as any;
const caseId = process.argv[2]!;
const { error } = await db.from("pipeline_engine_runs").delete().eq("case_id", caseId).in("engine", ["scoring", "legal_qa", "multi_agent", "report_generator"]);
console.log("cleared", error ?? "ok");
process.exit(0);
