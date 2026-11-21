import { Router } from "express";
import { ObjectId } from "mongodb";
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
  const equipment = {
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  const result = await getCollection("equipments").insertOne(equipment);

  return sendSuccess(res, {
    statusCode: 201,
    message: "Equipment added successfully",
    data: { ...equipment, _id: result.insertedId },
  });
});

equipmentsRouter.get("/featured", async (req, res) => {
  const equipments = await getCollection("equipments")
    .find({})
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();

  return sendSuccess(res, {
    message: "Featured equipment fetched successfully",
    data: equipments,
  });
});

equipmentsRouter.get("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid equipment ID.",
    });
  }

  const equipment = await getCollection("equipments").findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!equipment) {
    return sendError(res, {
      statusCode: 404,
      message: "Equipment not found.",
    });
  }

  return sendSuccess(res, {
    message: "Equipment fetched successfully",
    data: equipment,
  });
});

equipmentsRouter.get("/", async (req, res) => {
  const query = req.query ?? {};
  const queryFields = [
    "search",
    "category",
    "rentalType",
    "minPrice",
    "maxPrice",
    "availability",
    "sortBy",
  ];

  if (
    queryFields.some(
      (field) => query[field] !== undefined && typeof query[field] !== "string"
    )
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Equipment filters must be single values.",
    });
  }

  const search = (query.search ?? "").trim();
  const category = (query.category ?? "").trim();
  const rentalType = (query.rentalType ?? "").trim();
  const minPriceText = (query.minPrice ?? "").trim();
  const maxPriceText = (query.maxPrice ?? "").trim();
  const availability = (query.availability ?? "").trim();
  const sortBy = (query.sortBy ?? "").trim();

  if (search.length > 100) {
    return sendError(res, {
      statusCode: 400,
      message: "Search text must be 100 characters or fewer.",
    });
  }

  if (rentalType && !["daily", "weekly", "monthly"].includes(rentalType)) {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid rental type.",
    });
  }

  if (availability && !["available", "unavailable"].includes(availability)) {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid availability filter.",
    });
  }

  const minPrice = minPriceText ? Number(minPriceText) : null;
  const maxPrice = maxPriceText ? Number(maxPriceText) : null;

  if (
    (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) ||
    (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0))
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Price filters must be non-negative numbers.",
    });
  }

  if (
    minPrice !== null &&
    maxPrice !== null &&
    minPrice > maxPrice
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Minimum price cannot exceed maximum price.",
    });
  }

  const sortOptions = {
    recent: { createdAt: -1, _id: -1 },
    "price-asc": { rentalPrice: 1, _id: 1 },
    "price-desc": { rentalPrice: -1, _id: 1 },
  };
  const selectedSort = sortBy || "recent";

  if (!Object.hasOwn(sortOptions, selectedSort)) {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid sort option.",
    });
  }

  const filter = {};

  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { location: { $regex: escapedSearch, $options: "i" } },
    ];
  }

  if (category) {
    filter.category = category;
  }

  if (rentalType) {
    filter.rentalType = rentalType;
  }

  if (minPrice !== null || maxPrice !== null) {
    filter.rentalPrice = {};
    if (minPrice !== null) filter.rentalPrice.$gte = minPrice;
    if (maxPrice !== null) filter.rentalPrice.$lte = maxPrice;
  }

  if (availability) {
    filter.status = availability === "available" ? "active" : "inactive";
  }

  const equipmentsQuery = getCollection("equipments").find(filter);
  const equipments = Object.keys(query).length
    ? await equipmentsQuery.sort(sortOptions[selectedSort]).toArray()
    : await equipmentsQuery.toArray();

  return sendSuccess(res, {
    message: "Equipments fetched successfully",
    data: equipments,
  });
});

export default equipmentsRouter;
