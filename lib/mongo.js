// lib/mongo.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true }); // laddar lokalt; no-op på Vercel

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Missing MONGODB_URI");

const client = new MongoClient(uri);

// Exportera EN enda promise som alla kan vänta på
export default client.connect();
