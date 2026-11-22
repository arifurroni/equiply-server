import { sendError } from "../utils/response.js";

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const ROLE_LABELS = {
  admin: "admins",
  customer: "customers",
  owner: "owners",
};

export default function requireRole(requiredRole) {
  return async function roleMiddleware(req, res, next) {
    const cookie = req.get("cookie");
    if (!cookie) {
      return sendError(res, {
        statusCode: 401,
        message: "Authentication is required.",
      });
    }

    let authResponse;
    try {
      authResponse = await fetch(`${CLIENT_URL}/api/auth/get-session`, {
        headers: { cookie, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      console.error("Role authorization check failed:", error);
      return sendError(res, {
        statusCode: 503,
        message: "Unable to verify your session. Please try again.",
      });
    }

    if (!authResponse.ok) {
      return sendError(res, {
        statusCode: authResponse.status === 401 ? 401 : 503,
        message:
          authResponse.status === 401
            ? "Your session is invalid or expired."
            : "Unable to verify your session. Please try again.",
      });
    }

    let session;
    try {
      session = await authResponse.json();
    } catch (error) {
      console.error("Role authorization response was invalid:", error);
      return sendError(res, {
        statusCode: 503,
        message: "Unable to verify your session. Please try again.",
      });
    }

    if (!session?.user?.id) {
      return sendError(res, {
        statusCode: 401,
        message: "Authentication is required.",
      });
    }

    if (session.user.role !== requiredRole) {
      return sendError(res, {
        statusCode: 403,
        message: `Only ${ROLE_LABELS[requiredRole] ?? requiredRole} can access this resource.`,
      });
    }

    req.authUser = session.user;
    req.authUserId = session.user.id;
    return next();
  };
}
