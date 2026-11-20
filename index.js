
import 'dotenv/config'
import express from "express";
import cors from "cors";
import { MongoClient } from 'mongodb';

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;


const client = new MongoClient(process.env.MONGODB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}



app.listen(PORT, () => {
    console.log(`Server is running successfully on port: ${PORT}`);
});