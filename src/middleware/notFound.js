import { sendError } from "../utils/response.js";

/**
 * Catches every request that did not match any route.
 * Must be registered AFTER all routes.
 */
export default function notFound(req, res) {
  sendError(res, {
    statusCode: 404,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}
