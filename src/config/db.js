import { MongoClient } from "mongodb";

// The client is created lazily so that importing this file never
// crashes the app before dotenv has loaded the .env file.
let client = null;

/**
 * Connects to MongoDB using MONGODB_URI from the .env file.
 * If the connection fails, the server stops immediately —
 * we never run the API without a working database.
 */
export async function connectToMongoDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("Missing MONGODB_URI. Add it to your .env file.");
    process.exit(1);
  }

  try {
    client = new MongoClient(uri);
    await client.connect();

    const dbName = getDbName();
    console.log(`MongoDB connected successfully (database: ${dbName})`);

    return client;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

/** Returns the database handle. Only call after connectToMongoDB(). */
export function getDb() {
  if (!client) {
    throw new Error("MongoDB is not connected yet. Call connectToMongoDB() first.");
  }

  return client.db(getDbName());
}

/** Returns a single collection (handy for routes). */
export function getCollection(name) {
  return getDb().collection(name);
}

/** Closes the connection cleanly on shutdown. */
export async function closeMongoDB() {
  if (!client) return;

  await client.close();
  client = null;
  console.log("MongoDB connection closed.");
}

function getDbName() {
  return process.env.MONGODB_DB_NAME || "equiply-db";
}
