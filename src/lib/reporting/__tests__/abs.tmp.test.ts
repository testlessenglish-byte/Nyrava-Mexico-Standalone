import { describe, it, expect } from "vitest";
import { transformReportContent, contentRestriction } from "@/lib/reporting/report-content-policy";
const cap:any={mode:"LIMITED",strategic_recommendations_allowed:false,probabilities_allowed:false,scores_allowed:false,motions_allowed:false};
const gov:any={strategy_output_allowed:false,governance_mode:"concluded_decision_audit"};
describe("absence", () => {
  it("sanitizes nested", () => {
    const p:any={report:{summary:"El acta no existe en autos.",missing_evidence_struct:[{item:"falta de acta", how_to_obtain:"pedirla"}]},
      findings:[{description:"El documento no obra en el expediente.",quote:"no existe"}]};
    const out:any=transformReportContent(p,cap,gov);
    console.log(JSON.stringify(out,null,1));
    const hits:string[]=[];
    const visit=(v:any,k="",parent:any={})=>{const r=contentRestriction(v,k,parent,cap,gov); if(r)hits.push(k+":"+r);
      if(Array.isArray(v))v.forEach(x=>visit(x,k,parent)); else if(v&&typeof v==="object")Object.entries(v).forEach(([kk,x])=>visit(x,kk,v));};
    visit(out);
    console.log(hits);
    expect(hits.filter(h=>h.includes("unverifiedAbsence"))).toEqual([]);
  });
});
