import { Router } from "express";
import usersRouter from "./users/index.js";
import equipmentsRouter from "./equipments/index.js";
import bookingsRouter from "./bookings/index.js";

/**
 * All API routes live under /
 *
 *   /users
 *   /equipments
 *   /bookings
 *
 * Add new resources here by importing their router.
 */
const routes = Router();

routes.use("/users", usersRouter);
routes.use("/equipments", equipmentsRouter);
routes.use("/bookings", bookingsRouter);

export default routes;
