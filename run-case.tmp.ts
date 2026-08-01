import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runPipelineForCase } from "@/lib/pipeline-runner.server";

const caseId = process.argv[2]!;
const startFrom = process.argv[3];
const db = supabaseAdmin as any;
const { data: c } = await db.from("cases").select("id,user_id,name,scored_at,report_at").eq("id", caseId).single();
console.log("[before]", JSON.stringify(c));
const res = await runPipelineForCase(db, c.user_id, { caseId, startFrom });
console.log("[run]", JSON.stringify(res));
const { data: after } = await db.from("cases").select("status,scored_at,report_at").eq("id", caseId).single();
console.log("[after]", JSON.stringify(after));
const { data: rows } = await db.from("pipeline_engine_runs").select("engine,status,meta,error").eq("case_id", caseId).in("engine", ["scoring", "multi_agent", "report_generator"]);
console.log("[engines]", JSON.stringify(rows, null, 1).slice(0, 3000));
const { data: rep } = await db.from("reports").select("scores_suppressed,motions_suppressed,case_strength_score,risk_score").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1);
console.log("[report]", JSON.stringify(rep));
process.exit(0);
