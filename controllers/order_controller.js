import db from "../db.js";

const formatOrderNumber = (orderId) => `NS-${String(orderId).padStart(6, "0")}`;

export const getMyOrders = async (req, res) => {
  try {
    const orders = await db.any(
      `
        SELECT
          o.order_id,
          o.order_date,
          o.subtotal_amount,
          o.tax_amount,
          o.discount_amount,
          o.total_amount,
          o.order_status::text AS order_status,
          o.payment_status,
          COUNT(oi.order_item_id)::int AS item_count
        FROM orders o
        LEFT JOIN order_items oi ON o.order_id = oi.order_id
        WHERE o.buyer_id = $1
        GROUP BY
          o.order_id,
          o.order_date,
          o.subtotal_amount,
          o.tax_amount,
          o.discount_amount,
          o.total_amount,
          o.order_status,
          o.payment_status
        ORDER BY o.order_date DESC, o.order_id DESC
      `,
      [req.user.userId]
    );

    const normalizedOrders = orders.map((order) => ({
      orderId: order.order_id,
      orderNumber: formatOrderNumber(order.order_id),
      orderDate: order.order_date,
      subtotalAmount: Number(order.subtotal_amount) || 0,
      taxAmount: Number(order.tax_amount) || 0,
      discountAmount: Number(order.discount_amount) || 0,
      totalAmount: Number(order.total_amount) || 0,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      itemCount: Number(order.item_count) || 0,
    }));

    return res.status(200).json({
      orders: normalizedOrders,
    });
  } catch (error) {
    console.log("GET MY ORDERS ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch orders",
    });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({
        error: "Invalid order id",
      });
    }

    const order = await db.oneOrNone(
      `
        SELECT
          o.order_id,
          o.buyer_id,
          o.order_date,
          o.subtotal_amount,
          o.tax_amount,
          o.discount_amount,
          o.total_amount,
          o.order_status::text AS order_status,
          o.payment_status,
          o.stripe_checkout_session_id,
          o.stripe_payment_intent_id
        FROM orders o
        WHERE o.order_id = $1
          AND o.buyer_id = $2
      `,
      [orderId, req.user.userId]
    );

    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    const items = await db.any(
      `
        SELECT
          oi.order_item_id,
          oi.product_id,
          oi.quantity,
          oi.unit_price,
          oi.line_total,
          p.product_name,
          p.brand,
          p.sku,
          c.category_name AS category,
          CASE c.category_name
            WHEN 'Guitar' THEN 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80'
            WHEN 'Piano' THEN 'https://images.unsplash.com/photo-1514119412350-e174d90d280e?auto=format&fit=crop&w=900&q=80'
            WHEN 'Drums' THEN 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?auto=format&fit=crop&w=900&q=80'
            WHEN 'Violin' THEN 'https://images.unsplash.com/photo-1465821185615-20b3c2fbf41b?auto=format&fit=crop&w=900&q=80'
            WHEN 'Brass' THEN 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=900&q=80'
            WHEN 'Woodwind' THEN 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&w=900&q=80'
            WHEN 'Accessories' THEN 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80'
            ELSE 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80'
          END AS image
        FROM order_items oi
        JOIN products p ON oi.product_id = p.product_id
        JOIN categories c ON p.category_id = c.category_id
        WHERE oi.order_id = $1
        ORDER BY oi.order_item_id ASC
      `,
      [orderId]
    );

    return res.status(200).json({
      order: {
        orderId: order.order_id,
        orderNumber: formatOrderNumber(order.order_id),
        orderDate: order.order_date,
        subtotalAmount: Number(order.subtotal_amount) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        totalAmount: Number(order.total_amount) || 0,
        orderStatus: order.order_status,
        paymentStatus: order.payment_status,
        stripeCheckoutSessionId: order.stripe_checkout_session_id,
        stripePaymentIntentId: order.stripe_payment_intent_id,
        items: items.map((item) => ({
          orderItemId: item.order_item_id,
          productId: item.product_id,
          name: item.product_name,
          brand: item.brand,
          sku: item.sku,
          category: item.category,
          image: item.image,
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unit_price) || 0,
          lineTotal: Number(item.line_total) || 0,
        })),
      },
    });
  } catch (error) {
    console.log("GET ORDER BY ID ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch order details",
    });
  }
};