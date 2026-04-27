import Stripe from "stripe";
import db from "../db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const toDollars = (amountInCents) => Number((amountInCents / 100).toFixed(2));

const toCents = (amountInDollars) =>
  Math.round(Number(amountInDollars || 0) * 100);

const normalizeDiscountCode = (code = "") => {
  return String(code).trim().toUpperCase();
};

const calculateDiscountedPrice = ({ basePrice, discountType, discountValue }) => {
  const price = Number(basePrice) || 0;
  const value = Number(discountValue) || 0;

  if (price <= 0 || value <= 0) {
    return price;
  }

  if (discountType === "percentage") {
    return Number((price * (1 - value / 100)).toFixed(2));
  }

  if (discountType === "fixed_amount") {
    return Number(Math.max(price - value, 0).toFixed(2));
  }

  return price;
};

const getBestSalePriceForProduct = (product, activeSales = []) => {
  const basePrice = Number(product.price) || 0;
  let bestPrice = basePrice;
  let appliedSale = null;

  if (
    product.is_on_sale === true &&
    product.sale_price !== null &&
    product.sale_price !== undefined
  ) {
    const directSalePrice = Number(product.sale_price);

    if (
      Number.isFinite(directSalePrice) &&
      directSalePrice >= 0 &&
      directSalePrice < bestPrice
    ) {
      bestPrice = directSalePrice;
      appliedSale = {
        source: "product_sale_price",
        saleId: null,
        saleName: "Product Sale",
      };
    }
  }

  for (const sale of activeSales) {
    const appliesToProduct =
      sale.sale_scope === "site_wide" ||
      (sale.sale_scope === "product" &&
        Number(sale.product_id) === Number(product.product_id)) ||
      (sale.sale_scope === "category" &&
        Number(sale.category_id) === Number(product.category_id));

    if (!appliesToProduct) {
      continue;
    }

    const candidatePrice = calculateDiscountedPrice({
      basePrice,
      discountType: sale.discount_type,
      discountValue: sale.discount_value,
    });

    if (candidatePrice < bestPrice) {
      bestPrice = candidatePrice;
      appliedSale = {
        source: "sales_table",
        saleId: sale.sale_id,
        saleName: sale.sale_name,
        discountType: sale.discount_type,
        discountValue: Number(sale.discount_value),
      };
    }
  }

  return {
    effectiveUnitPrice: Number(bestPrice.toFixed(2)),
    originalUnitPrice: Number(basePrice.toFixed(2)),
    saleApplied: appliedSale,
  };
};

const getActiveSalesForProducts = async ({ productIds, categoryIds }) => {
  if (!productIds.length) {
    return [];
  }

  return db.any(
    `
      SELECT
        s.sale_id,
        s.sale_name,
        s.sale_scope::text AS sale_scope,
        s.discount_type::text AS discount_type,
        s.discount_value::float8 AS discount_value,
        sp.product_id,
        sc.category_id
      FROM sales s
      LEFT JOIN sale_products sp
        ON s.sale_id = sp.sale_id
      LEFT JOIN sale_categories sc
        ON s.sale_id = sc.sale_id
      WHERE s.is_active = true
        AND (s.starts_at IS NULL OR s.starts_at <= CURRENT_TIMESTAMP)
        AND (s.ends_at IS NULL OR s.ends_at > CURRENT_TIMESTAMP)
        AND (
          s.sale_scope = 'site_wide'
          OR (
            s.sale_scope = 'product'
            AND sp.product_id = ANY($1::int[])
          )
          OR (
            s.sale_scope = 'category'
            AND sc.category_id = ANY($2::int[])
          )
        )
    `,
    [productIds, categoryIds]
  );
};

const validateDiscountCode = async ({ discountCode, subtotal }) => {
  const normalizedCode = normalizeDiscountCode(discountCode);

  if (!normalizedCode) {
    return null;
  }

  const discount = await db.oneOrNone(
    `
      SELECT
        discount_code_id,
        code,
        description,
        discount_type::text AS discount_type,
        discount_value::float8 AS discount_value,
        minimum_order_amount::float8 AS minimum_order_amount,
        max_uses,
        uses_count,
        starts_at,
        expires_at,
        is_active
      FROM discount_codes
      WHERE UPPER(code) = $1
      LIMIT 1
    `,
    [normalizedCode]
  );

  if (!discount) {
    const error = new Error("Discount code was not found");
    error.statusCode = 400;
    throw error;
  }

  if (!discount.is_active) {
    const error = new Error("Discount code is not active");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();

  if (discount.starts_at && new Date(discount.starts_at) > now) {
    const error = new Error("Discount code is not active yet");
    error.statusCode = 400;
    throw error;
  }

  if (discount.expires_at && new Date(discount.expires_at) <= now) {
    const error = new Error("Discount code has expired");
    error.statusCode = 400;
    throw error;
  }

  if (
    discount.max_uses !== null &&
    discount.max_uses !== undefined &&
    Number(discount.uses_count) >= Number(discount.max_uses)
  ) {
    const error = new Error("Discount code has reached its usage limit");
    error.statusCode = 400;
    throw error;
  }

  if (Number(subtotal) < Number(discount.minimum_order_amount || 0)) {
    const error = new Error(
      `Discount code requires a minimum order amount of $${Number(
        discount.minimum_order_amount || 0
      ).toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  return discount;
};

const calculateExpectedDiscountAmount = ({ discount, subtotal }) => {
  if (!discount) {
    return 0;
  }

  const subtotalAmount = Number(subtotal) || 0;
  const discountValue = Number(discount.discount_value) || 0;

  if (discount.discount_type === "percentage") {
    return Number((subtotalAmount * (discountValue / 100)).toFixed(2));
  }

  if (discount.discount_type === "fixed_amount") {
    return Number(Math.min(discountValue, subtotalAmount).toFixed(2));
  }

  return 0;
};

const createStripeCouponForDiscount = async ({ discount, subtotal, orderId }) => {
  if (!discount) {
    return null;
  }

  const subtotalCents = toCents(subtotal);

  if (subtotalCents <= 0) {
    return null;
  }

  const couponPayload = {
    duration: "once",
    name: `NoteSwap ${discount.code}`,
    metadata: {
      orderId: String(orderId),
      discountCodeId: String(discount.discount_code_id),
      discountCode: discount.code,
    },
  };

  if (discount.discount_type === "percentage") {
    couponPayload.percent_off = Number(discount.discount_value);
  }

  if (discount.discount_type === "fixed_amount") {
    const amountOffCents = Math.min(
      toCents(discount.discount_value),
      subtotalCents
    );

    couponPayload.amount_off = amountOffCents;
    couponPayload.currency = "usd";
  }

  return stripe.coupons.create(couponPayload);
};

const validateAndPriceCart = async ({ cartItems, requestedDiscountCode }) => {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    const error = new Error("Cart is empty");
    error.statusCode = 400;
    throw error;
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
    const error = new Error("Cart items are invalid");
    error.statusCode = 400;
    throw error;
  }

  const productIds = normalizedCart.map((item) => item.id);

  const products = await db.any(
    `
      SELECT
        p.product_id,
        p.seller_id,
        p.category_id,
        p.product_name,
        p.product_description,
        p.brand,
        p.price::float8 AS price,
        p.sale_price::float8 AS sale_price,
        p.is_on_sale,
        p.quantity,
        p.availability_status::text AS availability_status
      FROM products p
      WHERE p.product_id = ANY($1::int[])
    `,
    [productIds]
  );

  if (products.length !== normalizedCart.length) {
    const error = new Error("One or more products no longer exist");
    error.statusCode = 400;
    throw error;
  }

  const categoryIds = [
    ...new Set(products.map((product) => Number(product.category_id))),
  ];

  const activeSales = await getActiveSalesForProducts({
    productIds,
    categoryIds,
  });

  const productMap = new Map(
    products.map((product) => [Number(product.product_id), product])
  );

  const validatedItems = [];
  let subtotal = 0;

  for (const cartItem of normalizedCart) {
    const product = productMap.get(cartItem.id);

    if (!product) {
      const error = new Error(`Product ${cartItem.id} was not found`);
      error.statusCode = 400;
      throw error;
    }

    if (product.availability_status !== "available") {
      const error = new Error(`${product.product_name} is no longer available`);
      error.statusCode = 400;
      throw error;
    }

    if (cartItem.quantity > Number(product.quantity)) {
      const error = new Error(
        `Only ${product.quantity} unit(s) left for ${product.product_name}`
      );
      error.statusCode = 400;
      throw error;
    }

    const pricing = getBestSalePriceForProduct(product, activeSales);
    const lineTotal = Number(
      (pricing.effectiveUnitPrice * cartItem.quantity).toFixed(2)
    );

    subtotal = Number((subtotal + lineTotal).toFixed(2));

    validatedItems.push({
      productId: product.product_id,
      sellerId: product.seller_id,
      name: product.product_name,
      description: product.product_description || "",
      brand: product.brand || "",
      originalUnitPrice: pricing.originalUnitPrice,
      unitPrice: pricing.effectiveUnitPrice,
      quantity: cartItem.quantity,
      lineTotal,
      saleApplied: pricing.saleApplied,
    });
  }

  const validatedDiscount = await validateDiscountCode({
    discountCode: requestedDiscountCode,
    subtotal,
  });

  const expectedDiscountAmount = calculateExpectedDiscountAmount({
    discount: validatedDiscount,
    subtotal,
  });

  const expectedTotal = Number(
    Math.max(subtotal - expectedDiscountAmount, 0).toFixed(2)
  );

  return {
    validatedItems,
    validatedDiscount,
    subtotal,
    expectedDiscountAmount,
    expectedTotal,
  };
};

export const previewCheckout = async (req, res) => {
  try {
    const cartItems = req.body.cartItems || [];
    const requestedDiscountCode = req.body.discountCode || "";

    const {
      validatedItems,
      validatedDiscount,
      subtotal,
      expectedDiscountAmount,
      expectedTotal,
    } = await validateAndPriceCart({
      cartItems,
      requestedDiscountCode,
    });

    return res.status(200).json({
      pricing: {
        subtotalAmount: subtotal,
        discountAmount: expectedDiscountAmount,
        estimatedTotalAmount: expectedTotal,
        discountCode: validatedDiscount?.code || null,
        items: validatedItems.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          originalUnitPrice: item.originalUnitPrice,
          finalUnitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          saleApplied: item.saleApplied,
        })),
      },
    });
  } catch (error) {
    console.log("PREVIEW CHECKOUT ERROR:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to preview checkout",
    });
  }
};

export const createCheckoutSession = async (req, res) => {
  let createdOrderId = null;

  try {
    const userId = req.user.userId;
    const cartItems = req.body.cartItems || [];
    const requestedDiscountCode = req.body.discountCode || "";

    const {
      validatedItems,
      validatedDiscount,
      subtotal,
      expectedDiscountAmount,
      expectedTotal,
    } = await validateAndPriceCart({
      cartItems,
      requestedDiscountCode,
    });

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
          payment_status,
          discount_code_id
        )
        VALUES (
          $1,
          CURRENT_TIMESTAMP,
          $2,
          0.00,
          $3,
          $4,
          'pending',
          'unpaid',
          $5
        )
        RETURNING order_id
      `,
      [
        userId,
        subtotal,
        expectedDiscountAmount,
        expectedTotal,
        validatedDiscount?.discount_code_id || null,
      ]
    );

    createdOrderId = createdOrder.order_id;

    for (const item of validatedItems) {
      await db.none(
        `
          INSERT INTO order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            line_total,
            product_name_snapshot,
            seller_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          createdOrderId,
          item.productId,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          item.name,
          item.sellerId,
        ]
      );
    }

    const stripeCoupon = await createStripeCouponForDiscount({
      discount: validatedDiscount,
      subtotal,
      orderId: createdOrderId,
    });

    const lineItems = validatedItems.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          description: item.description || undefined,
          metadata: {
            productId: String(item.productId),
            originalUnitPrice: String(item.originalUnitPrice),
            saleApplied: item.saleApplied ? "true" : "false",
            saleSource: item.saleApplied?.source || "",
            saleId: item.saleApplied?.saleId
              ? String(item.saleApplied.saleId)
              : "",
          },
        },
        unit_amount: toCents(item.unitPrice),
      },
      quantity: item.quantity,
      ...(process.env.STRIPE_TAX_RATE_ID
        ? { tax_rates: [process.env.STRIPE_TAX_RATE_ID] }
        : {}),
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: process.env.CHECKOUT_SUCCESS_URL,
      cancel_url: process.env.CHECKOUT_CANCEL_URL,
      client_reference_id: String(createdOrderId),
      metadata: {
        orderId: String(createdOrderId),
        userId: String(userId),
        discountCodeId: validatedDiscount
          ? String(validatedDiscount.discount_code_id)
          : "",
        discountCode: validatedDiscount ? validatedDiscount.code : "",
      },
      ...(stripeCoupon
        ? {
            discounts: [
              {
                coupon: stripeCoupon.id,
              },
            ],
          }
        : {
            allow_promotion_codes: true,
          }),
    });

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
      pricing: {
        subtotalAmount: subtotal,
        discountAmount: expectedDiscountAmount,
        estimatedTotalAmount: expectedTotal,
        discountCode: validatedDiscount?.code || null,
        items: validatedItems.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          originalUnitPrice: item.originalUnitPrice,
          finalUnitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          saleApplied: item.saleApplied,
        })),
      },
    });
  } catch (error) {
    console.log("CREATE CHECKOUT SESSION ERROR:", error);

    if (createdOrderId) {
      try {
        await db.none(`DELETE FROM orders WHERE order_id = $1`, [createdOrderId]);
      } catch (cleanupError) {
        console.log("ORDER CLEANUP ERROR:", cleanupError);
      }
    }

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to start checkout",
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
        SELECT
          order_id,
          buyer_id,
          payment_status,
          discount_code_id
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
    const discountAmount = toDollars(
      session.total_details?.amount_discount || 0
    );

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
              order_status = 'completed',
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

      if (existingOrder.discount_code_id) {
        await t.none(
          `
            UPDATE discount_codes
            SET uses_count = uses_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE discount_code_id = $1
          `,
          [existingOrder.discount_code_id]
        );
      }

      await t.none(
        `
          UPDATE products p
          SET quantity = GREATEST(p.quantity - oi.quantity, 0),
              updated_at = CURRENT_TIMESTAMP
          FROM order_items oi
          WHERE oi.order_id = $1
            AND oi.product_id = p.product_id
        `,
        [orderId]
      );

      await t.none(
        `
          UPDATE products
          SET availability_status = 'sold',
              updated_at = CURRENT_TIMESTAMP
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