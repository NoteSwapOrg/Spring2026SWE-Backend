import Stripe from "stripe";
import db from "../db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const toDollars = (amountInCents) => Number((amountInCents / 100).toFixed(2));

export const createCheckoutSession = async (req, res) => {
  let createdOrderId = null;

  try {
    const userId = req.user.userId;
    const cartItems = req.body.cartItems || [];

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({
        error: "Cart is empty",
      });
    }

    const normalizedCart = cartItems
      .map((item) => ({
        id: Number(item.id),
        quantity: Number(item.quantity),
      }))
      .filter(
        (item) =>
          Number.isInteger(item.id) &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0
      );

    if (normalizedCart.length === 0) {
      return res.status(400).json({
        error: "Cart items are invalid",
      });
    }

    const productIds = normalizedCart.map((item) => item.id);

    const products = await db.any(
      `
        SELECT
          p.product_id,
          p.product_name,
          p.product_description,
          p.brand,
          p.price::float8 AS price,
          p.quantity,
          p.availability_status::text AS availability_status
        FROM products p
        WHERE p.product_id = ANY($1)
      `,
      [productIds]
    );

    if (products.length !== normalizedCart.length) {
      return res.status(400).json({
        error: "One or more products no longer exist",
      });
    }

    const productMap = new Map(products.map((product) => [product.product_id, product]));

    const validatedItems = [];
    let subtotal = 0;

    for (const cartItem of normalizedCart) {
      const product = productMap.get(cartItem.id);

      if (!product) {
        return res.status(400).json({
          error: `Product ${cartItem.id} was not found`,
        });
      }

      if (product.availability_status !== "available") {
        return res.status(400).json({
          error: `${product.product_name} is no longer available`,
        });
      }

      if (cartItem.quantity > Number(product.quantity)) {
        return res.status(400).json({
          error: `Only ${product.quantity} unit(s) left for ${product.product_name}`,
        });
      }

      const unitPrice = Number(product.price);
      const lineTotal = unitPrice * cartItem.quantity;

      subtotal += lineTotal;

      validatedItems.push({
        productId: product.product_id,
        name: product.product_name,
        description: product.product_description || "",
        brand: product.brand || "",
        unitPrice,
        quantity: cartItem.quantity,
        lineTotal,
      });
    }

    // 1) Create the order header first
    const createdOrder = await db.one(
      `
        INSERT INTO orders (
          buyer_id,
          order_date,
          subtotal_amount,
          tax_amount,
          discount_amount,
          total_amount,
          order_status,
          payment_status
        )
        VALUES ($1, CURRENT_TIMESTAMP, $2, 0.00, 0.00, $2, 'pending', 'unpaid')
        RETURNING order_id
      `,
      [userId, subtotal]
    );

    createdOrderId = createdOrder.order_id;

    // 2) Insert each order item
    for (const item of validatedItems) {
      await db.none(
        `
          INSERT INTO order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            line_total
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          createdOrderId,
          item.productId,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
        ]
      );
    }

    // 3) Build Stripe Checkout line items from validated DB data
    const lineItems = validatedItems.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          description: item.description || undefined,
        },
        unit_amount: Math.round(item.unitPrice * 100),
      },
      quantity: item.quantity,
      tax_rates: [process.env.STRIPE_TAX_RATE_ID],
    }));

    // 4) Create the hosted Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      allow_promotion_codes: true,
      success_url: process.env.CHECKOUT_SUCCESS_URL,
      cancel_url: process.env.CHECKOUT_CANCEL_URL,
      client_reference_id: String(createdOrderId),
      metadata: {
        orderId: String(createdOrderId),
        userId: String(userId),
      },
    });

    // 5) Store the Stripe session ID on the order
    await db.none(
      `
        UPDATE orders
        SET stripe_checkout_session_id = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $2
      `,
      [session.id, createdOrderId]
    );

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
      orderId: createdOrderId,
    });
  } catch (error) {
    console.log("CREATE CHECKOUT SESSION ERROR:", error);

    // Roll back the order if session creation failed before checkout started
    if (createdOrderId) {
      try {
        await db.none(`DELETE FROM orders WHERE order_id = $1`, [createdOrderId]);
      } catch (cleanupError) {
        console.log("ORDER CLEANUP ERROR:", cleanupError);
      }
    }

    return res.status(500).json({
      error: "Failed to start checkout",
    });
  }
};

export const finalizeOrder = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "Missing sessionId",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).json({
        error: "Checkout session is not paid",
      });
    }

    const orderId = Number(session.client_reference_id);

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({
        error: "Invalid order reference",
      });
    }

    const existingOrder = await db.oneOrNone(
      `
        SELECT order_id, buyer_id, payment_status
        FROM orders
        WHERE order_id = $1
          AND buyer_id = $2
          AND stripe_checkout_session_id = $3
      `,
      [orderId, userId, session.id]
    );

    if (!existingOrder) {
      return res.status(404).json({
        error: "Order not found for this user/session",
      });
    }

    // Prevent double-finalization
    if (existingOrder.payment_status === "paid") {
      return res.status(200).json({
        message: "Order already finalized",
        orderId,
        alreadyFinalized: true,
      });
    }

    const subtotalAmount = toDollars(session.amount_subtotal || 0);
    const totalAmount = toDollars(session.amount_total || 0);
    const taxAmount = toDollars(session.total_details?.amount_tax || 0);
    const discountAmount = toDollars(session.total_details?.amount_discount || 0);

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

    await db.tx(async (t) => {
      await t.none(
        `
          UPDATE orders
          SET subtotal_amount = $1,
              tax_amount = $2,
              discount_amount = $3,
              total_amount = $4,
              payment_status = 'paid',
              stripe_payment_intent_id = $5,
              updated_at = CURRENT_TIMESTAMP
          WHERE order_id = $6
        `,
        [
          subtotalAmount,
          taxAmount,
          discountAmount,
          totalAmount,
          paymentIntentId,
          orderId,
        ]
      );

      await t.none(
        `
          UPDATE products p
          SET quantity = GREATEST(p.quantity - oi.quantity, 0)
          FROM order_items oi
          WHERE oi.order_id = $1
            AND oi.product_id = p.product_id
        `,
        [orderId]
      );

      await t.none(
        `
          UPDATE products
          SET availability_status = 'sold'
          WHERE quantity <= 0
        `
      );
    });

    return res.status(200).json({
      message: "Order finalized successfully",
      orderId,
      amounts: {
        subtotalAmount,
        taxAmount,
        discountAmount,
        totalAmount,
      },
    });
  } catch (error) {
    console.log("FINALIZE ORDER ERROR:", error);
    return res.status(500).json({
      error: "Failed to finalize order",
    });
  }
};