import { ObjectId } from "mongodb";

import { getCollection, withTransaction } from "../config/db.js";

const PAYMENT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
]);

export async function ensureBookingIndexes() {
  await Promise.all([
    getCollection("bookings").createIndex({
      equipmentId: 1,
      startDate: 1,
      endDate: 1,
      paymentStatus: 1,
      reservationStatus: 1,
    }),
    getCollection("payments").createIndex(
      { stripeCheckoutSessionId: 1 },
      { unique: true, sparse: true }
    ),
    getCollection("stripeEvents").createIndex(
      { eventId: 1 },
      { unique: true }
    ),
  ]);
}

export async function releaseExpiredUnsubmittedBookings() {
  const now = new Date();
  const expired = await getCollection("bookings")
    .find({
      paymentStatus: "pending",
      reservationStatus: "active",
      stripeCheckoutSessionId: { $exists: false },
      reservationExpiresAt: { $lte: now },
    })
    .project({ _id: 1 })
    .toArray();

  for (const booking of expired) {
    await releaseBookingReservation(booking._id, "expired");
  }
}

export async function releaseBookingReservation(bookingId, finalStatus) {
  if (!["failed", "expired"].includes(finalStatus)) {
    throw new Error("Invalid reservation release status.");
  }

  return withTransaction(async (session) => {
    const bookings = getCollection("bookings");
    const booking = await bookings.findOne(
      { _id: bookingId },
      { session }
    );

    if (
      !booking ||
      booking.reservationStatus !== "active" ||
      booking.paymentStatus === "paid"
    ) {
      return false;
    }

    await bookings.updateOne(
      { _id: bookingId, reservationStatus: "active" },
      {
        $set: {
          paymentStatus: finalStatus,
          bookingStatus: "cancelled",
          reservationStatus: "released",
          updatedAt: new Date().toISOString(),
        },
      },
      { session }
    );

    if (booking.stripeCheckoutSessionId) {
      await getCollection("payments").updateOne(
        { stripeCheckoutSessionId: booking.stripeCheckoutSessionId },
        {
          $set: {
            bookingId: booking._id.toString(),
            customerId: booking.customerId,
            equipmentId: booking.equipmentId.toString(),
            status: finalStatus,
            updatedAt: new Date().toISOString(),
          },
          $setOnInsert: {
            stripeCheckoutSessionId: booking.stripeCheckoutSessionId,
            amount: booking.amountInCents,
            currency: booking.currency,
            createdAt: new Date().toISOString(),
          },
        },
        { upsert: true, session }
      );
    }

    return true;
  });
}

export async function processStripeCheckoutEvent(event) {
  if (!PAYMENT_EVENTS.has(event.type)) {
    return { handled: false, duplicate: false };
  }

  const stripeObject = event.data.object;
  const bookingId = stripeObject.metadata?.bookingId;
  if (!ObjectId.isValid(bookingId)) {
    throw new Error("Stripe event has invalid booking metadata.");
  }

  return withTransaction(async (session) => {
    const stripeEvents = getCollection("stripeEvents");
    const priorEvent = await stripeEvents.findOne(
      { eventId: event.id },
      { session }
    );
    if (priorEvent) {
      return { handled: true, duplicate: true };
    }

    await stripeEvents.insertOne(
      {
        eventId: event.id,
        type: event.type,
        createdAt: new Date().toISOString(),
      },
      { session }
    );

    const bookings = getCollection("bookings");
    const booking = await bookings.findOne(
      { _id: new ObjectId(bookingId) },
      { session }
    );
    if (!booking) {
      throw new Error("Booking for Stripe event was not found.");
    }

    if (event.type === "payment_intent.payment_failed") {
      const now = new Date().toISOString();
      if (["pending", "processing"].includes(booking.paymentStatus)) {
        await bookings.updateOne(
          { _id: booking._id, paymentStatus: booking.paymentStatus },
          { $set: { lastPaymentAttemptStatus: "failed", updatedAt: now } },
          { session }
        );

        if (booking.stripeCheckoutSessionId) {
          await getCollection("payments").updateOne(
            { stripeCheckoutSessionId: booking.stripeCheckoutSessionId },
            {
              $set: {
                bookingId: booking._id.toString(),
                customerId: booking.customerId,
                equipmentId: booking.equipmentId.toString(),
                stripePaymentIntentId: stripeObject.id,
                amount: stripeObject.amount,
                currency: stripeObject.currency,
                status: "failed",
                updatedAt: now,
              },
              $setOnInsert: {
                stripeCheckoutSessionId: booking.stripeCheckoutSessionId,
                createdAt: now,
              },
            },
            { upsert: true, session }
          );
        }
      }

      return { handled: true, duplicate: false };
    }

    if (
      booking.stripeCheckoutSessionId &&
      booking.stripeCheckoutSessionId !== stripeObject.id
    ) {
      throw new Error("Stripe Checkout session does not match the booking.");
    }

    const checkoutSession = stripeObject;
    let nextPaymentStatus = booking.paymentStatus;
    let nextBookingStatus = booking.bookingStatus;
    let nextReservationStatus = booking.reservationStatus;

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      if (checkoutSession.payment_status === "paid") {
        if (
          booking.paymentStatus !== "paid" &&
          booking.reservationStatus !== "active"
        ) {
          throw new Error("Cannot confirm a booking after its reservation ended.");
        }
        nextPaymentStatus = "paid";
        nextBookingStatus = "confirmed";
        nextReservationStatus = "confirmed";
      } else if (booking.paymentStatus !== "paid") {
        nextPaymentStatus = "processing";
      }
    } else if (booking.paymentStatus !== "paid") {
      nextPaymentStatus =
        event.type === "checkout.session.expired" ? "expired" : "failed";
      nextBookingStatus = "cancelled";
      nextReservationStatus = "released";
    }

    const now = new Date().toISOString();
    const bookingUpdate = {
      paymentStatus: nextPaymentStatus,
      bookingStatus: nextBookingStatus,
      reservationStatus: nextReservationStatus,
      stripeCheckoutSessionId: checkoutSession.id,
      updatedAt: now,
    };
    if (nextPaymentStatus === "paid") bookingUpdate.paidAt = now;

    await bookings.updateOne(
      { _id: booking._id },
      { $set: bookingUpdate },
      { session }
    );

    const paymentStatus =
      nextPaymentStatus === "paid" ? "succeeded" : nextPaymentStatus;
    const paymentIntentId =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id ?? null;

    await getCollection("payments").updateOne(
      { stripeCheckoutSessionId: checkoutSession.id },
      {
        $set: {
          bookingId: booking._id.toString(),
          customerId: booking.customerId,
          equipmentId: booking.equipmentId.toString(),
          stripePaymentIntentId: paymentIntentId,
          amount: checkoutSession.amount_total,
          currency: checkoutSession.currency,
          status: paymentStatus,
          updatedAt: now,
        },
        $setOnInsert: {
          stripeCheckoutSessionId: checkoutSession.id,
          createdAt: now,
        },
      },
      { upsert: true, session }
    );

    return { handled: true, duplicate: false };
  });
}
