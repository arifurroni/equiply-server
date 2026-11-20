
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

const connectedClient = await connectToMongoDB();

const db = connectedClient.db("equiply-db")

const usersCollection = db.collection("users");
const equipmentsCollection = db.collection("equipments");
const bookingsCollection = db.collection("bookings");


app.get('/', (req, res) => {
    res.send('Equiply server is running successfully');
});

app.get('/equipments', async (req, res) => {
    try {
        const result = await equipmentsCollection.find({}).toArray();
        res.json(result);
    } catch (err) {
        console.dir(err);
        res.status(500).json({ error: 'Failed to fetch equipments' });
    }
});


app.listen(PORT, () => {
    console.log(`Server is running successfully on port: ${PORT}`);
});