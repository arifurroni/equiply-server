import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../../config/db.js";
import requireRole from "../../middleware/requireRole.js";
import { sendSuccess, sendError } from "../../utils/response.js";

const favoritesRouter = Router();
const requireCustomer = requireRole("customer");
let favoriteIndexPromise;

async function ensureFavoriteIndex() {
  if (!favoriteIndexPromise) {
    favoriteIndexPromise = getCollection("favorites").createIndex(
      { userId: 1, equipmentId: 1 },
      { unique: true }
    );
  }

  await favoriteIndexPromise;
}

function parseEquipmentId(id, res) {
  if (!ObjectId.isValid(id)) {
    sendError(res, {
      statusCode: 400,
      message: "Invalid equipment ID.",
    });
    return null;
  }

  return new ObjectId(id);
}

favoritesRouter.get("/status/:equipmentId", requireCustomer, async (req, res) => {
  const equipmentId = parseEquipmentId(req.params.equipmentId, res);
  if (!equipmentId) return;

  const favorite = await getCollection("favorites").findOne({
    userId: req.authUserId,
    equipmentId,
  });

  return sendSuccess(res, {
    message: "Favorite status retrieved successfully.",
    data: { isFavorite: Boolean(favorite) },
  });
});

favoritesRouter.get("/", requireCustomer, async (req, res) => {
  const favorites = await getCollection("favorites")
    .aggregate([
      { $match: { userId: req.authUserId } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "equipments",
          localField: "equipmentId",
          foreignField: "_id",
          as: "equipment",
        },
      },
      { $unwind: "$equipment" },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ["$equipment", { favoritedAt: "$createdAt" }],
          },
        },
      },
    ])
    .toArray();

  return sendSuccess(res, {
    message: "Customer favorites retrieved successfully.",
    data: favorites,
  });
});

favoritesRouter.post("/:equipmentId", requireCustomer, async (req, res) => {
  const equipmentId = parseEquipmentId(req.params.equipmentId, res);
  if (!equipmentId) return;

  const equipment = await getCollection("equipments").findOne(
    { _id: equipmentId },
    { projection: { _id: 1 } }
  );

  if (!equipment) {
    return sendError(res, {
      statusCode: 404,
      message: "Equipment listing was not found.",
    });
  }

  await ensureFavoriteIndex();
  await getCollection("favorites").updateOne(
    { userId: req.authUserId, equipmentId },
    {
      $setOnInsert: {
        userId: req.authUserId,
        equipmentId,
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );

  return sendSuccess(res, {
    message: "Equipment added to favorites.",
    data: { equipmentId: equipmentId.toString(), isFavorite: true },
  });
});

favoritesRouter.delete("/:equipmentId", requireCustomer, async (req, res) => {
  const equipmentId = parseEquipmentId(req.params.equipmentId, res);
  if (!equipmentId) return;

  await getCollection("favorites").deleteOne({
    userId: req.authUserId,
    equipmentId,
  });

  return sendSuccess(res, {
    message: "Equipment removed from favorites.",
    data: { equipmentId: equipmentId.toString(), isFavorite: false },
  });
});

export default favoritesRouter;
