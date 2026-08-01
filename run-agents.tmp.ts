import { createClient } from "@supabase/supabase-js";
import { runAgents } from "@/lib/pipeline.server";

const url = process.env["SUPABASE_URL"]!;
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const caseId = process.argv[2]!;
const userId = process.argv[3]!;

const db = createClient(url, key, { auth: { persistSession: false } }) as any;

const res = await runAgents({ db, caseId, userId, apiKey: process.env["GROQ_API_KEY"] ?? "" });
console.log("RESULT", JSON.stringify(res).slice(0, 500));
