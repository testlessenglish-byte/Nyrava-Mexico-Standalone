// Run with a local @electric-sql/pglite module path; no production dependency.
import {readFileSync} from "node:fs";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve,dirname} from "node:path";
import assert from "node:assert/strict";
const {PGlite}=await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : "@electric-sql/pglite");
const db=new PGlite();
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
await db.exec(`
 create role authenticated; create role service_role;
 create type public.case_status as enum ('processing','released','needs_revision');
 create table cases(id uuid primary key, execution_id uuid, status case_status default 'processing',
   progress integer, completed_at timestamptz,report_at timestamptz,next_stage text,worker_lease_until timestamptz,status_message text,error text);
 create table reports(id uuid primary key,case_id uuid,full_report jsonb,quality_blocked boolean default false,quality_block_reasons jsonb);
`);
await db.exec(readFileSync(resolve(root,"supabase/migrations/20260830070000_authoritative_report_release.sql"),"utf8"));
const id="00000000-0000-0000-0000-000000000001";
const execution="00000000-0000-0000-0000-000000000002";
const good={release_decision:"PASS",release_gate:{ok:true},final_review:{released:true},
  final_report_contract_validation:{ok:true},qa_statuses:[]};
async function reset(){
  await db.exec("truncate reports,cases");
  await db.query("insert into cases(id,execution_id) values($1,$2)",[id,execution]);
  await db.query("insert into reports(id,case_id,full_report) values($1,$1,'{}')",[id]);
}
async function run(full=good,exec=execution,expected={},released=true,errors=[]){
  return db.query("select finalize_report_release($1,$2,$1,$3,$4,$5,$6,'test')",
    [id,exec,JSON.stringify(expected),JSON.stringify(full),released,JSON.stringify(errors)]);
}
const tests=[];
async function test(name,fn){await reset();await fn();tests.push(name);console.log("PASS "+name);}
await test("blocking QA cannot coexist with released=true",async()=>{
  await assert.rejects(run({...good,qa_statuses:[{layer:"legal_qa",status:"FAIL",blocking:true}]}),/BLOCKING_QA_CANNOT_RELEASE/);
  assert.equal((await db.query("select status from cases")).rows[0].status,"processing");
});
await test("nonblocking warning commits both mirrors",async()=>{
  await run({...good,release_decision:"PASS_WITH_WARNINGS",qa_statuses:[{layer:"manifest",status:"WARN_NON_BLOCKING",blocking:false}]});
  assert.equal((await db.query("select status from cases")).rows[0].status,"released");
  assert.equal((await db.query("select quality_blocked from reports")).rows[0].quality_blocked,false);
});
await test("stale execution rejected",async()=>assert.rejects(run(good,id),/RELEASE_EXECUTION_SUPERSEDED/));
await test("changed report rejected",async()=>assert.rejects(run(good,execution,{changed:true}),/RELEASE_REPORT_CHANGED/));
await test("existing quality block rejected",async()=>{
  await db.exec("update reports set quality_blocked=true");
  await assert.rejects(run(),/BLOCKING_QA_CANNOT_RELEASE/);
});
await test("missing contract validation rejected",async()=>{
  await assert.rejects(run({...good,final_report_contract_validation:null}),/BLOCKING_QA_CANNOT_RELEASE/);
});
await test("disagreeing mirrors rejected",async()=>{
  await assert.rejects(run({...good,release_gate:{ok:false}}),/RELEASE_MIRRORS_DISAGREE/);
});
await test("case write failure rolls back report write",async()=>{
  await db.exec(`create function reject_case_update() returns trigger language plpgsql as $$
    begin raise exception 'simulated_case_write_failure'; end; $$;
    create trigger reject_case before update on cases for each row execute function reject_case_update();`);
  await assert.rejects(run(),/simulated_case_write_failure/);
  assert.deepEqual((await db.query("select full_report from reports")).rows[0].full_report,{});
  await db.exec("drop trigger reject_case on cases");
});
await test("blocked decision commits matching report and case",async()=>{
  await run({...good,release_decision:"BLOCKED",release_gate:{ok:false},final_review:{released:false},
    qa_statuses:[{layer:"legal_qa",status:"FAIL",blocking:true}]},execution,{},false,["legal_qa"]);
  assert.equal((await db.query("select status from cases")).rows[0].status,"needs_revision");
  assert.equal((await db.query("select quality_blocked from reports")).rows[0].quality_blocked,true);
});
console.log(JSON.stringify({passed:tests.length,tests},null,2));
await db.close();
