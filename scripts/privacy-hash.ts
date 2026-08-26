import { createHash } from "crypto";
import { canonicalPrivacyText } from "../src/lib/legal/privacy-notice";
console.log(createHash("sha256").update(canonicalPrivacyText(), "utf8").digest("hex"));
