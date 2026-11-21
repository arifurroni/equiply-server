import { Router } from "express";

/**
 * User routes (signup, profile, role management, ...)
 * will be added here in a later phase.
 */
const usersRouter = Router();

usersRouter.get("/", (req, res) => {
    res.send({Message: "Users retrieved successfully!"});
});

export default usersRouter;
