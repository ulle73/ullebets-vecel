// lib/db.js
// Gör filen säker i Next, men körbar direkt med `node` (utan server-only installerat)
if (process.env.NEXT_RUNTIME) {
  await import("server-only");
}

import clientPromise from "./mongo.js";
export { clientPromise };
