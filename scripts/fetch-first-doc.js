import { clientPromise } from "../lib/db.js";

const client = await clientPromise;
const db = client.db(process.env.MONGODB_DB || 'app');
const collection = db.collection(process.env.BACKTEST_COLLECTION || "unibet-backtest");

const firstDoc = await collection.findOne({});
console.log("First document structure:");
console.log(JSON.stringify(firstDoc, null, 2));