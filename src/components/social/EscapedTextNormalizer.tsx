import { useEffect } from "react";

const ESCAPED_BREAKS=/\\r\\n|\\n|\\r|\\t/g;
const SKIP=new Set(["CODE","PRE","SCRIPT","STYLE","TEXTAREA","INPUT"]);

function normalizeNode(node:Node){
  if(node.nodeType===Node.TEXT_NODE){
    const parent=node.parentElement;
    if(!parent||SKIP.has(parent.tagName))return;
    const value=node.nodeValue??"";
    if(!ESCAPED_BREAKS.test(value))return;
    ESCAPED_BREAKS.lastIndex=0;
    const normalized=value.replace(/\\r\\n|\\n|\\r/g,"\n").replace(/\\t/g,"\t");
    node.nodeValue=normalized.trim()?normalized:"";
    return;
  }
  if(node.nodeType===Node.ELEMENT_NODE&&!SKIP.has((node as Element).tagName)){
    for(const child of Array.from(node.childNodes))normalizeNode(child);
  }
}

export function EscapedTextNormalizer(){
  useEffect(()=>{
    const root=document.querySelector("[data-social-care-root]");
    if(!root)return;
    normalizeNode(root);
    const observer=new MutationObserver(records=>{
      for(const record of records){
        for(const node of Array.from(record.addedNodes))normalizeNode(node);
        if(record.type==="characterData")normalizeNode(record.target);
      }
    });
    observer.observe(root,{subtree:true,childList:true,characterData:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}
