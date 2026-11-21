import { sendError } from "../utils/response.js";

/**
 * Global error handler.
 * Express automatically forwards errors (including rejected promises
 * from async route handlers in Express 5) to this function.
 *
 * NOTE: it MUST declare 4 parameters, otherwise Express will not
 * treat it as an error handler.
 *
 * Register it AFTER all routes and the 404 handler.
 */
export default function errorHandler(err, req, res, next) {
  // Log the full error for debugging — never send it to the client.
  console.error("Unhandled error:", err);

  // Malformed JSON sent by the client.
  if (err.type === "entity.parse.failed") {
    return sendError(res, {
      statusCode: 400,
      message: "Invalid JSON in request body.",
    });
  }

  // Request body exceeded the limit set by express.json().
  if (err.type === "entity.too.large") {
    return sendError(res, {
      statusCode: 413,
      message: "Request body is too large.",
    });
  }

  const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const message = statusCode === 500 ? "Internal server error." : err.message;

  return sendError(res, { statusCode, message });
}
