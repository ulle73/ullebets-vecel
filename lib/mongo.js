import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Missing MONGODB_URI");

let client;
let clientPromise;

if (process.env.NODE_ENV === "development") {
  // cache i dev så att inte HMR öppnar nya connections varje gång
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // i prod behövs bara en promise
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;
