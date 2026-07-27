import { parseIndex } from "./src/lib/legal-connectors/congreso.connector";
const html = await (await fetch("https://www.diputados.gob.mx/LeyesBiblio/index.htm")).text().catch(()=> "");
console.log("net", html.length);
