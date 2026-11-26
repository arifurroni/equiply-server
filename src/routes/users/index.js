import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../../config/db.js";
import requireAdmin from "../../middleware/requireAdmin.js";
import { sendSuccess, sendError } from "../../utils/response.js";

const usersRouter = Router();

const ROLES = ["customer", "owner", "admin"];
const LOCATIONS = ["Dhaka", "Chittagong", "Khulna", "Sylhet"];

function toIsoDate(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

usersRouter.get("/", requireAdmin, async (req, res) => {
  const users = await getCollection("user")
    .find(
      {},
      { projection: { name: 1, email: 1, role: 1, location: 1, createdAt: 1 } }
    )
    .sort({ name: 1, _id: 1 })
    .toArray();

  const data = users.map((user) => ({
    id: String(user._id),
    name: typeof user.name === "string" ? user.name : "Equiply user",
    email: typeof user.email === "string" ? user.email : "",
    role: ROLES.includes(user.role) ? user.role : "customer",
    location: LOCATIONS.includes(user.location) ? user.location : null,
    createdAt: toIsoDate(user.createdAt),
  }));

  return sendSuccess(res, {
    message: "Users retrieved successfully.",
    data,
  });
});

usersRouter.patch("/:id", requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const updates = req.body;

  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    userId.length > 128 ||
    !updates ||
    typeof updates !== "object" ||
    Array.isArray(updates)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "A valid user and update are required.",
    });
  }

  const fields = Object.keys(updates);
  if (
    fields.length === 0 ||
    fields.some((field) => field !== "role" && field !== "location")
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Only role and location can be updated.",
    });
  }

  if (Object.hasOwn(updates, "role") && !ROLES.includes(updates.role)) {
    return sendError(res, {
      statusCode: 400,
      message: "Select a valid role.",
    });
  }

  if (
    Object.hasOwn(updates, "location") &&
    !LOCATIONS.includes(updates.location)
  ) {
    return sendError(res, {
      statusCode: 400,
      message: "Select a valid location.",
    });
  }

  // Better Auth stores user _id as an ObjectId, but the id arrives here as a
  // string from the URL. Match both forms so the update always finds the account.
  const idFilter = ObjectId.isValid(userId)
    ? { $in: [userId, new ObjectId(userId)] }
    : userId;

  const result = await getCollection("user").updateOne(
    { _id: idFilter },
    { $set: updates }
  );

  if (result.matchedCount === 0) {
    return sendError(res, {
      statusCode: 404,
      message: "User account was not found.",
    });
  }

  return sendSuccess(res, {
    message: "User updated successfully.",
    data: { id: userId, ...updates },
  });
});

export default usersRouter;
