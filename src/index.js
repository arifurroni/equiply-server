import "dotenv/config";
import express from "express";
import cors from "cors";

import { connectToMongoDB, closeMongoDB } from "./config/db.js";
import routes from "./routes/index.js";
import notFound from "./middleware/notFound.js";
import errorHandler from "./middleware/errorHandler.js";
import { sendSuccess } from "./utils/response.js";
import stripeWebhook from "./routes/webhooks/stripe.js";
import { ensureBookingIndexes } from "./services/bookingLifecycle.js";

const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// ---------- Global middleware ----------
app.use(
  cors({
    origin: CLIENT_URL, // only the frontend may call this API
    credentials: true,
  })
);
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook
);
app.use(express.json()); // parse JSON request bodies

// ---------- Health check ----------
app.get("/", (req, res) => {
  sendSuccess(res, {
    message: "Equiply server is running successfully",
    data: { port: PORT },
  });
});

// ---------- API routes ----------
app.use("/", routes);

// ---------- 404 + error handling (always last) ----------
app.use(notFound);
app.use(errorHandler);

// ---------- Start server ----------
async function startServer() {
  await connectToMongoDB();
  await ensureBookingIndexes();

  const server = app.listen(PORT, () => {
    console.log(`Server is running successfully on port: ${PORT}`);
    console.log(`CORS origin: ${CLIENT_URL}`);
  });

  // Close the server + database cleanly on Ctrl+C / shutdown.
  const shutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down...`);
    server.close(async () => {
      await closeMongoDB();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
