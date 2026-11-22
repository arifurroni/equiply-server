import { Router } from "express";
import { ObjectId } from "mongodb";

import { getCollection, withTransaction } from "../../config/db.js";
import { getStripeClient } from "../../config/stripe.js";
import requireRole from "../../middleware/requireRole.js";
import {
  releaseBookingReservation,
  releaseExpiredUnsubmittedBookings,
} from "../../services/bookingLifecycle.js";
import { sendError, sendSuccess } from "../../utils/response.js";

const bookingsRouter = Router();
const requireCustomer = requireRole("customer");
const BILLING_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const CURRENCY = "usd";
const CHECKOUT_WINDOW_SECONDS = 35 * 60;
const MAX_STRIPE_AMOUNT_CENTS = 99_999_999;

function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function dateOnlyToUtc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function todayInDhaka() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function validateBooking(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Booking information must be an object.";
  }

  if (!ObjectId.isValid(data.equipmentId)) {
    return "Select a valid equipment listing.";
  }

  const start = dateOnlyToUtc(data.startDate);
  const end = dateOnlyToUtc(data.endDate);
  if (!start || !end) {
    return "Enter valid rental start and end dates.";
  }
  if (data.startDate < todayInDhaka()) {
    return "The rental start date cannot be in the past.";
  }
  if (data.endDate <= data.startDate) {
    return "The rental end date must be after the start date.";
  }

  if (!Number.isInteger(data.quantity) || data.quantity < 1) {
    return "Quantity must be a whole number of at least one.";
  }

  if (
    typeof data.contactNumber !== "string" ||
    data.contactNumber.trim().length > 32
  ) {
    return "Enter a valid contact number.";
  }
  const phoneDigits = data.contactNumber.replace(/\D/g, "");
  if (
    !/^[+()\d\s.-]+$/.test(data.contactNumber.trim()) ||
    phoneDigits.length < 7 ||
    phoneDigits.length > 15
  ) {
    return "Enter a valid contact number.";
  }

  if (
    typeof data.deliveryAddress !== "string" ||
    data.deliveryAddress.trim().length < 5 ||
    data.deliveryAddress.trim().length > 500
  ) {
    return "Delivery address must be between 5 and 500 characters.";
  }

  if (
    data.additionalNotes !== undefined &&
    (typeof data.additionalNotes !== "string" ||
      data.additionalNotes.trim().length > 2000)
  ) {
    return "Additional notes must be 2000 characters or fewer.";
  }

  return null;
}

function getRentalDays(startDate, endDate) {
  return (
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
    86_400_000
  );
}

async function reserveEquipmentAndCreateBooking(data, customerId, expiresAt) {
  const equipmentId = new ObjectId(data.equipmentId);
  const rentalDays = getRentalDays(data.startDate, data.endDate);

  return withTransaction(async (session) => {
    const equipments = getCollection("equipments");
    const equipment = await equipments.findOne(
      { _id: equipmentId },
      { session }
    );

    if (!equipment) {
      throw requestError(404, "Equipment listing was not found.");
    }
    if (equipment.status !== "active") {
      throw requestError(409, "This equipment is not currently available.");
    }
    if (
      !Number.isInteger(equipment.availableQuantity) ||
      equipment.availableQuantity < 1 ||
      data.quantity > equipment.availableQuantity
    ) {
      throw requestError(409, "Quantity exceeds the available equipment.");
    }
    if (!Object.hasOwn(BILLING_DAYS, equipment.rentalType)) {
      throw requestError(409, "This equipment has an invalid rental type.");
    }

    const lockResult = await equipments.updateOne(
      { _id: equipmentId, status: "active" },
      { $inc: { inventoryRevision: 1 } },
      { session }
    );
    if (lockResult.matchedCount !== 1) {
      throw requestError(409, "This equipment is not currently available.");
    }

    const now = new Date();
    const overlaps = await getCollection("bookings")
      .find(
        {
          equipmentId,
          startDate: { $lt: data.endDate },
          endDate: { $gt: data.startDate },
          $or: [
            {
              paymentStatus: "paid",
              bookingStatus: { $in: ["confirmed", "in_progress"] },
            },
            {
              paymentStatus: { $in: ["pending", "processing"] },
              reservationStatus: "active",
              reservationExpiresAt: { $gt: now },
            },
          ],
        },
        { session }
      )
      .toArray();
    const reservedQuantity = overlaps.reduce(
      (total, booking) => total + booking.quantity,
      0
    );

    if (reservedQuantity + data.quantity > equipment.availableQuantity) {
      throw requestError(
        409,
        "Not enough equipment is available for the selected dates."
      );
    }

    const billingUnits = Math.ceil(
      rentalDays / BILLING_DAYS[equipment.rentalType]
    );
    const unitPriceCents = Math.round(Number(equipment.rentalPrice) * 100);
    const amountInCents = unitPriceCents * billingUnits * data.quantity;
    if (
      !Number.isSafeInteger(amountInCents) ||
      amountInCents < 1 ||
      amountInCents > MAX_STRIPE_AMOUNT_CENTS
    ) {
      throw requestError(400, "The calculated booking amount is out of range.");
    }

    const bookingId = new ObjectId();
    const createdAt = new Date().toISOString();
    const booking = {
      _id: bookingId,
      customerId,
      equipmentId,
      equipmentName: equipment.name,
      ownerId: equipment.ownerId,
      startDate: data.startDate,
      endDate: data.endDate,
      rentalDays,
      rentalType: equipment.rentalType,
      billingUnits,
      quantity: data.quantity,
      contactNumber: data.contactNumber.trim(),
      deliveryAddress: data.deliveryAddress.trim(),
      additionalNotes: data.additionalNotes?.trim() ?? "",
      unitPrice: unitPriceCents / 100,
      amountInCents,
      totalAmount: amountInCents / 100,
      currency: CURRENCY,
      paymentStatus: "pending",
      bookingStatus: "pending_payment",
      reservationStatus: "active",
      reservationExpiresAt: expiresAt,
      createdAt,
      updatedAt: createdAt,
    };

    await getCollection("bookings").insertOne(booking, { session });

    return {
      bookingId: bookingId.toString(),
      equipmentName: equipment.name,
      rentalType: equipment.rentalType,
      rentalDays,
      billingUnits,
      quantity: data.quantity,
      amountInCents,
      currency: CURRENCY,
      startDate: data.startDate,
      endDate: data.endDate,
      description: equipment.description,
    };
  });
}

bookingsRouter.post("/checkout", requireCustomer, async (req, res) => {
  const validationError = validateBooking(req.body);
  if (validationError) {
    return sendError(res, { statusCode: 400, message: validationError });
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

  await releaseExpiredUnsubmittedBookings();

  const expiresAt = new Date(
    (Math.floor(Date.now() / 1000) + CHECKOUT_WINDOW_SECONDS) * 1000
  );

  let booking;
  try {
    booking = await reserveEquipmentAndCreateBooking(
      req.body,
      req.authUserId,
      expiresAt
    );
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, {
        statusCode: error.statusCode,
        message: error.message,
      });
    }
    throw error;
  }

  const clientUrl = (process.env.CLIENT_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: booking.currency,
              unit_amount: booking.amountInCents,
              product_data: {
                name: booking.equipmentName,
                description: `${booking.billingUnits} ${booking.rentalType} period(s), ${booking.quantity} unit(s)`,
              },
            },
            quantity: 1,
          },
        ],
        customer_email:
          typeof req.authUser.email === "string"
            ? req.authUser.email
            : undefined,
        client_reference_id: booking.bookingId,
        metadata: {
          bookingId: booking.bookingId,
          equipmentId: req.body.equipmentId,
          customerId: req.authUserId,
        },
        payment_intent_data: {
          metadata: {
            bookingId: booking.bookingId,
            equipmentId: req.body.equipmentId,
            customerId: req.authUserId,
          },
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel?booking_id=${encodeURIComponent(booking.bookingId)}`,
        expires_at: expiresAtSeconds,
      },
      { idempotencyKey: `equiply-booking-${booking.bookingId}` }
    );
  } catch (error) {
    console.error("Stripe Checkout session creation failed:", error);
    await releaseBookingReservation(new ObjectId(booking.bookingId), "failed");
    return sendError(res, {
      statusCode: 502,
      message: "Could not start Stripe Checkout. The reservation was released.",
    });
  }

  if (!checkoutSession.url) {
    await releaseBookingReservation(new ObjectId(booking.bookingId), "failed");
    return sendError(res, {
      statusCode: 502,
      message: "Stripe did not return a Checkout URL. The reservation was released.",
    });
  }

  try {
    await getCollection("bookings").updateOne(
      { _id: new ObjectId(booking.bookingId) },
      {
        $set: {
          stripeCheckoutSessionId: checkoutSession.id,
          updatedAt: new Date().toISOString(),
        },
      }
    );
  } catch (error) {
    console.error("Could not save Stripe Checkout session:", error);
    try {
      await stripe.checkout.sessions.expire(checkoutSession.id);
    } catch (cleanupError) {
      console.error("Could not expire the unsent Checkout session:", cleanupError);
    }
    try {
      await releaseBookingReservation(
        new ObjectId(booking.bookingId),
        "failed"
      );
    } catch (cleanupError) {
      console.error("Could not release the unsent booking reservation:", cleanupError);
    }
    return sendError(res, {
      statusCode: 503,
      message: "Could not save the Checkout session. Please try again.",
    });
  }

  return sendSuccess(res, {
    statusCode: 201,
    message: "Booking reserved. Continue to Stripe Checkout.",
    data: {
      bookingId: booking.bookingId,
      sessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      estimatedTotal: booking.amountInCents / 100,
      currency: booking.currency,
    },
  });
});

bookingsRouter.get(
  "/mine",
  requireCustomer,
  async (req, res) => {
    const bookings = await getCollection("bookings")
      .find({ customerId: req.authUserId })
      .sort({ createdAt: -1 })
      .project({
        equipmentId: 1,
        equipmentName: 1,
        startDate: 1,
        endDate: 1,
        createdAt: 1,
        totalAmount: 1,
        currency: 1,
        paymentStatus: 1,
        bookingStatus: 1,
      })
      .toArray();

    return sendSuccess(res, {
      message: "Customer bookings retrieved.",
      data: bookings.map((booking) => ({
        ...booking,
        _id: booking._id.toString(),
        equipmentId: booking.equipmentId.toString(),
        currency: booking.currency || CURRENCY,
        bookingStatus: booking.bookingStatus || "pending_payment",
      })),
    });
  }
);

bookingsRouter.get(
  "/session/:sessionId",
  requireCustomer,
  async (req, res) => {
    const sessionId = req.params.sessionId;
    if (
      typeof sessionId !== "string" ||
      !sessionId.startsWith("cs_") ||
      sessionId.length > 255
    ) {
      return sendError(res, {
        statusCode: 400,
        message: "Invalid Checkout session ID.",
      });
    }

    const booking = await getCollection("bookings").findOne(
      {
        stripeCheckoutSessionId: sessionId,
        customerId: req.authUserId,
      },
      { projection: { paymentStatus: 1, equipmentName: 1 } }
    );

    if (!booking) {
      return sendError(res, {
        statusCode: 404,
        message: "Booking was not found for this Checkout session.",
      });
    }

    return sendSuccess(res, {
      message: "Booking payment status retrieved.",
      data: {
        paymentStatus: booking.paymentStatus,
        equipmentName: booking.equipmentName,
      },
    });
  }
);

export default bookingsRouter;
