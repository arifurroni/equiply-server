import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../../config/db.js";
import requireAdmin from "../../middleware/requireAdmin.js";
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
const APPROVAL_STATUSES = ["pending", "approved", "rejected"];
const RENTAL_TYPES = ["daily", "weekly", "monthly"];
const EQUIPMENT_CONDITIONS = ["new", "like-new", "good", "fair", "poor"];
const EQUIPMENT_STATUSES = ["active", "inactive"];
const ADMIN_EDITABLE_FIELDS = [
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
    approvalStatus: "pending",
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

equipmentsRouter.get("/admin", requireAdmin, async (req, res) => {
  const equipments = await getCollection("equipments")
    .find({})
    .sort({ createdAt: -1, _id: -1 })
    .toArray();

  const data = equipments.map((equipment) => ({
    ...equipment,
    _id: String(equipment._id),
    approvalStatus: APPROVAL_STATUSES.includes(equipment.approvalStatus)
      ? equipment.approvalStatus
      : "pending",
  }));

  return sendSuccess(res, {
    message: "Equipment listings retrieved successfully.",
    data,
  });
});

equipmentsRouter.patch(
  "/admin/:id/approval",
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { approvalStatus } = req.body ?? {};

    if (!ObjectId.isValid(id)) {
      return sendError(res, {
        statusCode: 400,
        message: "Invalid equipment ID.",
      });
    }

    if (
      Object.keys(req.body ?? {}).length !== 1 ||
      !APPROVAL_STATUSES.includes(approvalStatus)
    ) {
      return sendError(res, {
        statusCode: 400,
        message: "Select a valid approval status.",
      });
    }

    const result = await getCollection("equipments").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          approvalStatus,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return sendError(res, {
        statusCode: 404,
        message: "Equipment listing was not found.",
      });
    }

    return sendSuccess(res, {
      message: `Equipment ${approvalStatus}.`,
      data: { id, approvalStatus },
    });
  }
);

equipmentsRouter.patch("/admin/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!ObjectId.isValid(id)) {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid equipment ID.",
    });
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return sendError(res, {
      statusCode: 400,
      message: "Equipment updates must be an object.",
    });
  }

  const fields = Object.keys(updates);
  if (
    fields.length === 0 ||
    fields.some((field) => !ADMIN_EDITABLE_FIELDS.includes(field))
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Only equipment listing fields can be updated.",
    });
  }

  const requiredTextFields = [
    "name",
    "description",
    "category",
    "location",
    "condition",
    "brand",
    "model",
    "image",
    "rentalTerms",
  ];

  for (const field of requiredTextFields) {
    if (
      Object.hasOwn(updates, field) &&
      (typeof updates[field] !== "string" ||
        !updates[field].trim() ||
        updates[field].length > 5000)
    ) {
      return sendError(res, {
        statusCode: 400,
        message: `${field} must be a non-empty string of at most 5000 characters.`,
      });
    }
  }

  for (const field of ["category", "location", "brand", "model"]) {
    if (typeof updates[field] === "string" && updates[field].length > 120) {
      return sendError(res, {
        statusCode: 400,
        message: `${field} must be 120 characters or fewer.`,
      });
    }
  }

  if (
    typeof updates.name === "string" &&
    (updates.name.trim().length < 2 || updates.name.length > 120)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Equipment name must be between 2 and 120 characters.",
    });
  }

  if (
    typeof updates.description === "string" &&
    (updates.description.trim().length < 10 ||
      updates.description.length > 5000)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Description must be between 10 and 5000 characters.",
    });
  }

  if (
    Object.hasOwn(updates, "rentalPrice") &&
    (typeof updates.rentalPrice !== "number" ||
      !Number.isFinite(updates.rentalPrice) ||
      updates.rentalPrice < 1)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Rental price must be at least 1.",
    });
  }

  if (
    Object.hasOwn(updates, "availableQuantity") &&
    (!Number.isInteger(updates.availableQuantity) ||
      updates.availableQuantity < 1)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Available quantity must be a whole number of at least 1.",
    });
  }

  if (
    Object.hasOwn(updates, "rentalType") &&
    !RENTAL_TYPES.includes(updates.rentalType)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Select a valid rental type.",
    });
  }

  if (
    Object.hasOwn(updates, "condition") &&
    !EQUIPMENT_CONDITIONS.includes(updates.condition)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Select a valid equipment condition.",
    });
  }

  if (
    Object.hasOwn(updates, "status") &&
    !EQUIPMENT_STATUSES.includes(updates.status)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Select a valid availability status.",
    });
  }

  if (Object.hasOwn(updates, "image")) {
    try {
      const imageUrl = new URL(updates.image);
      if (!["http:", "https:"].includes(imageUrl.protocol)) {
        throw new Error("Unsupported image URL protocol.");
      }
    } catch {
      return sendError(res, {
        statusCode: 400,
        message: "Image must be a valid HTTP or HTTPS URL.",
      });
    }
  }

  const result = await getCollection("equipments").updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...updates,
        updatedAt: new Date().toISOString(),
      },
    }
  );

  if (result.matchedCount === 0) {
    return sendError(res, {
      statusCode: 404,
      message: "Equipment listing was not found.",
    });
  }

  return sendSuccess(res, {
    message: "Equipment listing updated successfully.",
    data: { id, ...updates },
  });
});

equipmentsRouter.delete("/admin/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid equipment ID.",
    });
  }

  const result = await getCollection("equipments").deleteOne({
    _id: new ObjectId(id),
  });

  if (result.deletedCount === 0) {
    return sendError(res, {
      statusCode: 404,
      message: "Equipment listing was not found.",
    });
  }

  await getCollection("favorites").deleteMany({
    equipmentId: new ObjectId(id),
  });

  return sendSuccess(res, {
    message: "Equipment listing deleted successfully.",
    data: { id },
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

  let owner = null;
  const ownerId = String(equipment.ownerId ?? "");
  if (ownerId) {
    const ownerFilter = ObjectId.isValid(ownerId)
      ? { $or: [{ _id: ownerId }, { _id: new ObjectId(ownerId) }] }
      : { _id: ownerId };
    const ownerDocument = await getCollection("user").findOne(ownerFilter, {
      projection: { name: 1, image: 1, location: 1 },
    });

    if (ownerDocument) {
      owner = {
        name:
          typeof ownerDocument.name === "string"
            ? ownerDocument.name
            : "Equipment owner",
        image:
          typeof ownerDocument.image === "string" ? ownerDocument.image : null,
        location:
          typeof ownerDocument.location === "string"
            ? ownerDocument.location
            : null,
      };
    }
  }

  return sendSuccess(res, {
    message: "Equipment fetched successfully",
    data: { ...equipment, owner },
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
