import { Router } from "express";
import { getCollection } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";

/**
 * Equipment routes.
 * POST /equipments -> create a new equipment (owner)
 * GET  /equipments -> public list of all equipments
 */
const equipmentsRouter = Router();

const REQUIRED_FIELDS = [
  "name",
  "description",
  "category",
  "location",
  "rentalPrice",
  "rentalType",
  "availableQuantity",
  "condition",
  "brand",
  "model",
  "image",
  "rentalTerms",
  "status",
  "ownerId",
];

equipmentsRouter.post("/", async (req, res) => {
  const data = req.body ?? {};

  // 1. Every required field must be present.
  const missing = REQUIRED_FIELDS.filter(
    (field) => data[field] === undefined || data[field] === null || data[field] === ""
  );

  if (missing.length > 0) {
    return sendError(res, {
      statusCode: 400,
      message: "Missing required fields.",
      errors: missing,
    });
  }

  // 2. Numeric fields must have the right type (never trust the client).
  if (typeof data.rentalPrice !== "number" || data.rentalPrice <= 0) {
    return sendError(res, {
      statusCode: 400,
      message: "rentalPrice must be a positive number.",
    });
  }

  if (!Number.isInteger(data.availableQuantity) || data.availableQuantity < 1) {
    return sendError(res, {
      statusCode: 400,
      message: "availableQuantity must be an integer of at least 1.",
    });
  }

  // 3. Timestamps are ALWAYS written by the server (overridden if sent).
  const now = new Date().toISOString();
  const equipment = { ...data, createdAt: now, updatedAt: now };

  const result = await getCollection("equipments").insertOne(equipment);

  return sendSuccess(res, {
    statusCode: 201,
    message: "Equipment added successfully",
    data: { ...equipment, _id: result.insertedId },
  });
});

equipmentsRouter.get("/", async (req, res) => {
  const equipments = await getCollection("equipments").find({}).toArray();

  return sendSuccess(res, {
    message: "Equipments fetched successfully",
    data: equipments,
  });
});

export default equipmentsRouter;
