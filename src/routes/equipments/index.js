import { Router } from "express";
import { getCollection } from "../../config/db.js";
import { sendSuccess } from "../../utils/response.js";

/**
 * Equipment routes.
 * GET /api/v1/equipments -> public list of all equipments
 */
const equipmentsRouter = Router();

equipmentsRouter.get("/", async (req, res) => {
  const equipments = await getCollection("equipments").find({}).toArray();

  sendSuccess(res, {
    message: "Equipments fetched successfully",
    data: equipments,
  });
});

export default equipmentsRouter;
