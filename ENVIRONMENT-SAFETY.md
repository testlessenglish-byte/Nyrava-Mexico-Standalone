# ENVIRONMENT SAFETY & ISOLATION RULES

> [!IMPORTANT]
> **TARGET STANDALONE PROJECT**: `Nyrava-Mexico-Standalone`  
> **PROJECT REF / ID**: `plyqpmrucbsyxybmkoeg`  
> **PROJECT URL**: `https://plyqpmrucbsyxybmkoeg.supabase.co`  
> **DASHBOARD URL**: `https://supabase.com/dashboard/project/plyqpmrucbsyxybmkoeg`  

---

## 🛑 STRICT PROJECT ISOLATION RULES

1. **READ-ONLY PROD / LOVABLE ENVIRONMENT**
   - The original Lovable Supabase project and all other pre-existing Supabase projects are **100% READ-ONLY**.
   - NEVER run any of the following against any project other than `plyqpmrucbsyxybmkoeg`:
     - `supabase db push`
     - `supabase db reset`
     - `supabase migration`
     - `supabase functions deploy`
     - `supabase secrets set`
     - RLS policy changes, schema alterations, `INSERT`, `UPDATE`, `DELETE`, `DROP`

2. **BEFORE RUNNING ANY SUPABASE CLI COMMAND**
   - Verify that the CLI is linked explicitly to `Nyrava-Mexico-Standalone` (`plyqpmrucbsyxybmkoeg`).
   - If there is any ambiguity about which project is linked, **STOP IMMEDIATELY**.

3. **SECRETS & SECURITY**
   - NEVER commit `.env`, service-role keys, or secrets to Git.

