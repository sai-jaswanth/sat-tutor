import { pingDb, closeDb } from "../db/database.js";
console.log(await pingDb());
await closeDb();
