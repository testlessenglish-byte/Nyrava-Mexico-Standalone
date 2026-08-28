import * as React from "react";
import { Body, Container, Head, Html, Preview, Text } from "@react-email/components";

export function ResourceContactEmail({subject,message,caseReference,documents=[]}:{subject?:string;message?:string;caseReference?:string;documents?:string[]}){
  return <Html><Head/><Preview>{subject||"Resource contact"}</Preview><Body style={{fontFamily:"Arial, sans-serif",color:"#18181b"}}><Container>
    <Text style={{whiteSpace:"pre-wrap"}}>{message}</Text>
    {caseReference&&<Text>Case reference: {caseReference}</Text>}
    {!!documents.length&&<Text>Documents shared through the approved Nyrava case workflow: {documents.join(", ")}</Text>}
    <Text style={{fontSize:"12px",color:"#71717a"}}>Sent by an authorized Nyrava case worker after consent review.</Text>
  </Container></Body></Html>;
}
