import db from "../db.js";

const formatOrderNumber = (orderId) => `NS-${String(orderId).padStart(6, "0")}`;

const logAdminAction = async ({
  adminUserId,
  action,
  targetTable = null,
  targetId = null,
  details = {},
}) => {
  try {
    await db.none(
      `
        INSERT INTO admin_audit_logs (
          admin_user_id,
          action,
          target_table,
          target_id,
          details
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [adminUserId, action, targetTable, targetId, details]
    );
  } catch (error) {
    console.log("ADMIN AUDIT LOG ERROR:", error);
  }
};

export const adminHealth = async (req, res) => {
  return res.status(200).json({
    message: "Admin route is working",
    admin: true,
    user: {
      userId: req.user.userId,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      groups: req.user.groups,
    },
  });
};

export const getAdminDashboard = async (req, res) => {
  try {
    const stats = await db.one(
      `
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE is_active = true) AS active_users,
          (SELECT COUNT(*)::int FROM products) AS total_products,
          (SELECT COUNT(*)::int FROM products WHERE availability_status = 'available') AS available_products,
          (SELECT COUNT(*)::int FROM orders) AS total_orders,
          (SELECT COUNT(*)::int FROM orders WHERE order_status = 'pending') AS pending_orders,
          (SELECT COALESCE(SUM(total_amount), 0)::float8 FROM orders WHERE payment_status = 'paid') AS total_revenue,
          (SELECT COUNT(*)::int FROM discount_codes WHERE is_active = true) AS active_discount_codes,
          (SELECT COUNT(*)::int FROM sales WHERE is_active = true) AS active_sales
      `
    );

    return res.status(200).json({
      dashboard: {
        totalUsers: stats.total_users,
        activeUsers: stats.active_users,
        totalProducts: stats.total_products,
        availableProducts: stats.available_products,
        totalOrders: stats.total_orders,
        pendingOrders: stats.pending_orders,
        totalRevenue: Number(stats.total_revenue) || 0,
        activeDiscountCodes: stats.active_discount_codes,
        activeSales: stats.active_sales,
      },
    });
  } catch (error) {
    console.log("GET ADMIN DASHBOARD ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch admin dashboard",
    });
  }
};

export const getAdminProducts = async (req, res) => {
  try {
    const products = await db.any(
      `
        SELECT
          p.product_id,
          p.sku,
          p.product_name,
          p.brand,
          p.price::float8 AS price,
          p.sale_price::float8 AS sale_price,
          p.is_on_sale,
          p.is_featured,
          p.quantity,
          p.item_type::text AS item_type,
          p.product_condition::text AS product_condition,
          p.availability_status::text AS availability_status,
          p.product_description,
          p.image_url,
          p.listing_date,
          p.updated_at,
          c.category_id,
          c.category_name,
          u.user_id AS seller_id,
          u.username AS seller_username,
          u.email AS seller_email,
          CONCAT(u.first_name, ' ', u.last_name) AS seller_name
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        JOIN users u ON p.seller_id = u.user_id
        ORDER BY p.listing_date DESC, p.product_id DESC
      `
    );

    return res.status(200).json({
      products: products.map((product) => ({
        productId: product.product_id,
        sku: product.sku,
        name: product.product_name,
        brand: product.brand,
        price: Number(product.price) || 0,
        salePrice: product.sale_price === null ? null : Number(product.sale_price),
        isOnSale: product.is_on_sale,
        isFeatured: product.is_featured,
        quantity: Number(product.quantity) || 0,
        itemType: product.item_type,
        condition: product.product_condition,
        availabilityStatus: product.availability_status,
        description: product.product_description,
        imageUrl: product.image_url,
        listingDate: product.listing_date,
        updatedAt: product.updated_at,
        category: {
          categoryId: product.category_id,
          name: product.category_name,
        },
        seller: {
          userId: product.seller_id,
          username: product.seller_username,
          email: product.seller_email,
          name: product.seller_name,
        },
      })),
    });
  } catch (error) {
    console.log("GET ADMIN PRODUCTS ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch admin products",
    });
  }
};

export const updateAdminProduct = async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId)) {
      return res.status(400).json({
        error: "Invalid product id",
      });
    }

    const {
      productName,
      brand,
      price,
      salePrice,
      isOnSale,
      isFeatured,
      quantity,
      availabilityStatus,
      productDescription,
      imageUrl,
    } = req.body;

    const updatedProduct = await db.oneOrNone(
      `
        UPDATE products
        SET
          product_name = COALESCE($1, product_name),
          brand = COALESCE($2, brand),
          price = COALESCE($3, price),
          sale_price = $4,
          is_on_sale = COALESCE($5, is_on_sale),
          is_featured = COALESCE($6, is_featured),
          quantity = COALESCE($7, quantity),
          availability_status = COALESCE($8, availability_status),
          product_description = COALESCE($9, product_description),
          image_url = COALESCE($10, image_url),
          updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $11
        RETURNING *
      `,
      [
        productName ?? null,
        brand ?? null,
        price ?? null,
        salePrice ?? null,
        typeof isOnSale === "boolean" ? isOnSale : null,
        typeof isFeatured === "boolean" ? isFeatured : null,
        quantity ?? null,
        availabilityStatus ?? null,
        productDescription ?? null,
        imageUrl?.trim() || null,
        productId,
      ]
    );

    if (!updatedProduct) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "UPDATE_PRODUCT",
      targetTable: "products",
      targetId: productId,
      details: req.body,
    });

    return res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    console.log("UPDATE ADMIN PRODUCT ERROR:", error);
    return res.status(500).json({
      error: "Failed to update product",
    });
  }
};

export const createAdminProduct = async (req, res) => {
  try {
    const {
      sku,
      productName,
      brand,
      categoryId,
      price,
      salePrice,
      isOnSale,
      isFeatured,
      quantity,
      itemType,
      productCondition,
      availabilityStatus,
      productDescription,
      imageUrl,
    } = req.body;

    if (!sku || !productName || !categoryId || price === undefined || quantity === undefined) {
      return res.status(400).json({
        error: "SKU, product name, category, price, and quantity are required",
      });
    }

    const numericCategoryId = Number(categoryId);
    const numericPrice = Number(price);
    const numericQuantity = Number(quantity);
    const numericSalePrice =
      salePrice === null || salePrice === undefined || salePrice === ""
        ? null
        : Number(salePrice);

    if (!Number.isInteger(numericCategoryId)) {
      return res.status(400).json({
        error: "Invalid category",
      });
    }

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        error: "Price must be a valid positive number",
      });
    }

    if (!Number.isInteger(numericQuantity) || numericQuantity < 0) {
      return res.status(400).json({
        error: "Quantity must be a valid whole number",
      });
    }

    if (
      numericSalePrice !== null &&
      (!Number.isFinite(numericSalePrice) || numericSalePrice < 0)
    ) {
      return res.status(400).json({
        error: "Sale price must be a valid positive number",
      });
    }

    if (Boolean(isOnSale) && numericSalePrice === null) {
      return res.status(400).json({
        error: "Sale price is required when product is marked on sale",
      });
    }

    if (numericSalePrice !== null && numericSalePrice > numericPrice) {
      return res.status(400).json({
        error: "Sale price cannot be greater than regular price",
      });
    }

    const category = await db.oneOrNone(
      `
        SELECT category_id
        FROM categories
        WHERE category_id = $1
      `,
      [numericCategoryId]
    );

    if (!category) {
      return res.status(404).json({
        error: "Category not found",
      });
    }

    const createdProduct = await db.one(
      `
        INSERT INTO products (
          sku,
          seller_id,
          category_id,
          product_name,
          brand,
          price,
          sale_price,
          is_on_sale,
          is_featured,
          quantity,
          item_type,
          product_condition,
          availability_status,
          product_description,
          image_url,
          listing_date,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          COALESCE($8, false),
          COALESCE($9, false),
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING *
      `,
      [
        sku.trim().toUpperCase(),
        req.user.userId,
        numericCategoryId,
        productName.trim(),
        brand?.trim() || null,
        numericPrice,
        numericSalePrice,
        typeof isOnSale === "boolean" ? isOnSale : false,
        typeof isFeatured === "boolean" ? isFeatured : false,
        numericQuantity,
        itemType || "used",
        productCondition || "good",
        availabilityStatus || "available",
        productDescription?.trim() || null,
        imageUrl?.trim() || null,
      ]
    );

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "CREATE_PRODUCT",
      targetTable: "products",
      targetId: createdProduct.product_id,
      details: req.body,
    });

    return res.status(201).json({
      message: "Product created successfully",
      product: createdProduct,
    });
  } catch (error) {
    console.log("CREATE ADMIN PRODUCT ERROR:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "A product with this SKU already exists",
      });
    }

    return res.status(500).json({
      error: "Failed to create product",
    });
  }
};

export const deleteAdminProduct = async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId)) {
      return res.status(400).json({
        error: "Invalid product id",
      });
    }

    const updatedProduct = await db.oneOrNone(
      `
        UPDATE products
        SET availability_status = 'removed',
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $1
        RETURNING product_id, product_name, availability_status
      `,
      [productId]
    );

    if (!updatedProduct) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "REMOVE_PRODUCT",
      targetTable: "products",
      targetId: productId,
      details: {
        productId,
        productName: updatedProduct.product_name,
        availabilityStatus: updatedProduct.availability_status,
      },
    });

    return res.status(200).json({
      message: "Product removed successfully",
      product: {
        productId: updatedProduct.product_id,
        name: updatedProduct.product_name,
        availabilityStatus: updatedProduct.availability_status,
      },
    });
  } catch (error) {
    console.log("DELETE ADMIN PRODUCT ERROR:", error);
    return res.status(500).json({
      error: "Failed to remove product",
    });
  }
};

export const getAdminUsers = async (req, res) => {
  try {
    const users = await db.any(
      `
        SELECT
          u.user_id,
          u.username,
          u.email,
          u.first_name,
          u.last_name,
          u.phone_number,
          u.address,
          u.role,
          u.is_active,
          u.created_at,
          u.updated_at,
          COUNT(o.order_id)::int AS order_count,
          COALESCE(SUM(o.total_amount), 0)::float8 AS total_spent
        FROM users u
        LEFT JOIN orders o ON u.user_id = o.buyer_id
        GROUP BY u.user_id
        ORDER BY u.created_at DESC, u.user_id DESC
      `
    );

    return res.status(200).json({
      users: users.map((user) => ({
        userId: user.user_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phoneNumber: user.phone_number,
        address: user.address,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        orderCount: Number(user.order_count) || 0,
        totalSpent: Number(user.total_spent) || 0,
      })),
    });
  } catch (error) {
    console.log("GET ADMIN USERS ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch admin users",
    });
  }
};

export const updateAdminUser = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        error: "Invalid user id",
      });
    }

    const {
      username,
      email,
      firstName,
      lastName,
      phoneNumber,
      address,
      role,
      isActive,
    } = req.body;

    const updatedUser = await db.oneOrNone(
      `
        UPDATE users
        SET
          username = COALESCE($1, username),
          email = COALESCE($2, email),
          first_name = COALESCE($3, first_name),
          last_name = COALESCE($4, last_name),
          phone_number = COALESCE($5, phone_number),
          address = COALESCE($6, address),
          role = COALESCE($7, role),
          is_active = COALESCE($8, is_active),
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $9
        RETURNING
          user_id,
          username,
          email,
          first_name,
          last_name,
          phone_number,
          address,
          role,
          is_active,
          created_at,
          updated_at
      `,
      [
        username ?? null,
        email ?? null,
        firstName ?? null,
        lastName ?? null,
        phoneNumber ?? null,
        address ?? null,
        role ?? null,
        typeof isActive === "boolean" ? isActive : null,
        userId,
      ]
    );

    if (!updatedUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "UPDATE_USER",
      targetTable: "users",
      targetId: userId,
      details: req.body,
    });

    return res.status(200).json({
      message: "User updated successfully",
      user: {
        userId: updatedUser.user_id,
        username: updatedUser.username,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phoneNumber: updatedUser.phone_number,
        address: updatedUser.address,
        role: updatedUser.role,
        isActive: updatedUser.is_active,
        createdAt: updatedUser.created_at,
        updatedAt: updatedUser.updated_at,
      },
    });
  } catch (error) {
    console.log("UPDATE ADMIN USER ERROR:", error);
    return res.status(500).json({
      error: "Failed to update user",
    });
  }
};

export const getAdminOrders = async (req, res) => {
  try {
    const allowedSorts = {
      date: "o.order_date",
      customer: "u.last_name",
      amount: "o.total_amount",
      status: "o.order_status",
    };

    const sortBy = req.query.sortBy || "date";
    const direction =
      String(req.query.direction || "desc").toLowerCase() === "asc"
        ? "ASC"
        : "DESC";

    const sortColumn = allowedSorts[sortBy] || allowedSorts.date;

    const orders = await db.any(
      `
        SELECT
          o.order_id,
          o.order_date,
          o.subtotal_amount::float8 AS subtotal_amount,
          o.tax_amount::float8 AS tax_amount,
          o.discount_amount::float8 AS discount_amount,
          o.total_amount::float8 AS total_amount,
          o.order_status::text AS order_status,
          o.payment_status,
          u.user_id AS buyer_id,
          u.username AS buyer_username,
          u.email AS buyer_email,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          COUNT(oi.order_item_id)::int AS item_count
        FROM orders o
        JOIN users u ON o.buyer_id = u.user_id
        LEFT JOIN order_items oi ON o.order_id = oi.order_id
        GROUP BY
          o.order_id,
          u.user_id
        ORDER BY ${sortColumn} ${direction}, o.order_id DESC
      `
    );

    return res.status(200).json({
      orders: orders.map((order) => ({
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
        customer: {
          userId: order.buyer_id,
          username: order.buyer_username,
          email: order.buyer_email,
          name: order.customer_name,
        },
      })),
    });
  } catch (error) {
    console.log("GET ADMIN ORDERS ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch admin orders",
    });
  }
};

export const updateAdminOrderStatus = async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    const { orderStatus } = req.body;

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({
        error: "Invalid order id",
      });
    }

    const allowedStatuses = ["pending", "completed", "cancelled"];

    if (!allowedStatuses.includes(orderStatus)) {
      return res.status(400).json({
        error: "Invalid order status",
      });
    }

    const updatedOrder = await db.oneOrNone(
      `
        UPDATE orders
        SET order_status = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $2
        RETURNING
          order_id,
          order_status::text AS order_status,
          payment_status,
          updated_at
      `,
      [orderStatus, orderId]
    );

    if (!updatedOrder) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "UPDATE_ORDER_STATUS",
      targetTable: "orders",
      targetId: orderId,
      details: {
        orderStatus,
      },
    });

    return res.status(200).json({
      message: "Order status updated successfully",
      order: {
        orderId: updatedOrder.order_id,
        orderStatus: updatedOrder.order_status,
        paymentStatus: updatedOrder.payment_status,
        updatedAt: updatedOrder.updated_at,
      },
    });
  } catch (error) {
    console.log("UPDATE ADMIN ORDER STATUS ERROR:", error);
    return res.status(500).json({
      error: "Failed to update order status",
    });
  }
};

export const createDiscountCode = async (req, res) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      minimumOrderAmount,
      maxUses,
      startsAt,
      expiresAt,
      isActive,
    } = req.body;

    if (!code || !discountType || !discountValue) {
      return res.status(400).json({
        error: "Code, discount type, and discount value are required",
      });
    }

    const createdCode = await db.one(
      `
        INSERT INTO discount_codes (
          code,
          description,
          discount_type,
          discount_value,
          minimum_order_amount,
          max_uses,
          starts_at,
          expires_at,
          is_active,
          created_by_admin_id
        )
        VALUES (
          UPPER($1),
          $2,
          $3,
          $4,
          COALESCE($5, 0.00),
          $6,
          $7,
          $8,
          COALESCE($9, true),
          $10
        )
        RETURNING *
      `,
      [
        code.trim(),
        description || null,
        discountType,
        discountValue,
        minimumOrderAmount ?? 0,
        maxUses ?? null,
        startsAt ?? null,
        expiresAt ?? null,
        typeof isActive === "boolean" ? isActive : true,
        req.user.userId,
      ]
    );

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "CREATE_DISCOUNT_CODE",
      targetTable: "discount_codes",
      targetId: createdCode.discount_code_id,
      details: createdCode,
    });

    return res.status(201).json({
      message: "Discount code created successfully",
      discountCode: createdCode,
    });
  } catch (error) {
    console.log("CREATE DISCOUNT CODE ERROR:", error);
    return res.status(500).json({
      error: "Failed to create discount code",
    });
  }
};

export const getDiscountCodes = async (req, res) => {
  try {
    const codes = await db.any(
      `
        SELECT *
        FROM discount_codes
        ORDER BY created_at DESC, discount_code_id DESC
      `
    );

    return res.status(200).json({
      discountCodes: codes,
    });
  } catch (error) {
    console.log("GET DISCOUNT CODES ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch discount codes",
    });
  }
};

export const createSale = async (req, res) => {
  try {
    const {
      saleName,
      description,
      saleScope,
      discountType,
      discountValue,
      startsAt,
      endsAt,
      isActive,
      productIds = [],
      categoryIds = [],
    } = req.body;

    if (!saleName || !saleScope || !discountType || !discountValue) {
      return res.status(400).json({
        error: "Sale name, sale scope, discount type, and discount value are required",
      });
    }

    const sale = await db.tx(async (t) => {
      const createdSale = await t.one(
        `
          INSERT INTO sales (
            sale_name,
            description,
            sale_scope,
            discount_type,
            discount_value,
            starts_at,
            ends_at,
            is_active,
            created_by_admin_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), $9)
          RETURNING *
        `,
        [
          saleName,
          description || null,
          saleScope,
          discountType,
          discountValue,
          startsAt ?? null,
          endsAt ?? null,
          typeof isActive === "boolean" ? isActive : true,
          req.user.userId,
        ]
      );

      if (saleScope === "product" && Array.isArray(productIds)) {
        for (const productId of productIds) {
          await t.none(
            `
              INSERT INTO sale_products (sale_id, product_id)
              VALUES ($1, $2)
              ON CONFLICT (sale_id, product_id) DO NOTHING
            `,
            [createdSale.sale_id, productId]
          );
        }
      }

      if (saleScope === "category" && Array.isArray(categoryIds)) {
        for (const categoryId of categoryIds) {
          await t.none(
            `
              INSERT INTO sale_categories (sale_id, category_id)
              VALUES ($1, $2)
              ON CONFLICT (sale_id, category_id) DO NOTHING
            `,
            [createdSale.sale_id, categoryId]
          );
        }
      }

      return createdSale;
    });

    await logAdminAction({
      adminUserId: req.user.userId,
      action: "CREATE_SALE",
      targetTable: "sales",
      targetId: sale.sale_id,
      details: req.body,
    });

    return res.status(201).json({
      message: "Sale created successfully",
      sale,
    });
  } catch (error) {
    console.log("CREATE SALE ERROR:", error);
    return res.status(500).json({
      error: "Failed to create sale",
    });
  }
};

export const getSales = async (req, res) => {
  try {
    const sales = await db.any(
      `
        SELECT *
        FROM sales
        ORDER BY created_at DESC, sale_id DESC
      `
    );

    return res.status(200).json({
      sales,
    });
  } catch (error) {
    console.log("GET SALES ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch sales",
    });
  }
};