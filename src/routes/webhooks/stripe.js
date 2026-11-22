import { sendError, sendSuccess } from "../../utils/response.js";
import { getStripeClient } from "../../config/stripe.js";
import { getCollection } from "../../config/db.js";
import { processStripeCheckoutEvent } from "../../services/bookingLifecycle.js";

export default async function stripeWebhook(req, res) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return sendError(res, {
      statusCode: 503,
      message: "Stripe webhook verification is not configured.",
    });
  }

  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) {
    return sendError(res, {
      statusCode: 400,
      message: "A signed Stripe webhook request is required.",
    });
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (error) {
    return sendError(res, {
      statusCode: error.statusCode || 503,
      message: error.message,
    });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.error(
      "Stripe webhook signature verification failed:",
      error.message
    );
    return sendError(res, {
      statusCode: 400,
      message: "Invalid Stripe webhook signature.",
    });
  }

  try {
    const result = await processStripeCheckoutEvent(event);
    return sendSuccess(res, {
      message: result.duplicate
        ? "Stripe event was already processed."
        : "Stripe event received.",
      data: { received: true },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const priorEvent = await getCollection("stripeEvents").findOne({
        eventId: event.id,
      });
      if (priorEvent) {
        return sendSuccess(res, {
          message: "Stripe event was already processed.",
          data: { received: true },
        });
      }
    }

    console.error("Stripe webhook processing failed:", error);
    return sendError(res, {
      statusCode: 500,
      message: "Stripe event could not be processed.",
    });
  }
}
