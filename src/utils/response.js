/**
 * Every API response in Equiply uses the same JSON shape so the
 * frontend can always check `success` first:
 *
 *   Success -> { success: true,  message, data }
 *   Error   -> { success: false, message, errors }
 */

/** Sends a success response. */
export function sendSuccess(res, { statusCode = 200, message = "Success", data = null }) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/** Sends an error response. */
export function sendError(res, { statusCode = 500, message = "Something went wrong", errors = null }) {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
}
