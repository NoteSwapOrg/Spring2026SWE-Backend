import db from "../db.js";

/* DB READS */

// USER INFO
// Simple example query that fetches one user by user_id.
export const user_info = async (user_id) => {
  try {
    const user_info = await db.one("SELECT * FROM users WHERE user_id = $1", [
      user_id,
    ]);
    return user_info;
  } catch (error) {
    console.log("ERROR:", error);
    throw error;
  }
};

// ORDER INFO
// Simple example query that fetches one order by order_id.
export const order_info = async (order_id) => {
  try {
    const order_info = await db.one("SELECT * FROM orders WHERE order_id = $1", [
      order_id,
    ]);
    return order_info;
  } catch (error) {
    console.log("ERROR:", error);
    throw error;
  }
};

// Shared fallback image logic.
// Product-specific p.image_url is used first.
// Category image is only used if image_url is missing.
const categoryImageFallback = `
  CASE c.category_name
    WHEN 'Guitar' THEN 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80'
    WHEN 'Piano' THEN 'https://images.unsplash.com/photo-1514119412350-e174d90d280e?auto=format&fit=crop&w=900&q=80'
    WHEN 'Drums' THEN 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?auto=format&fit=crop&w=900&q=80'
    WHEN 'Violin' THEN 'https://images.unsplash.com/photo-1465821185615-20b3c2fbf41b?auto=format&fit=crop&w=900&q=80'
    WHEN 'Brass' THEN 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=900&q=80'
    WHEN 'Woodwind' THEN 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&w=900&q=80'
    WHEN 'Accessories' THEN 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80'
    ELSE 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80'
  END
`;

// Shared SQL fragment for product lookups.
// This calculates the best active sale price from:
// 1. Direct product sale: products.sale_price when products.is_on_sale = true
// 2. Active site-wide sale campaigns
// 3. Active product-specific sale campaigns
// 4. Active category-specific sale campaigns
//
// It returns the fields your frontend already expects:
// salePrice, isOnSale, saleName, saleScope, saleSource, etc.
const productSelect = `
  SELECT
    p.product_id AS id,
    p.sku,
    p.product_name AS name,
    c.category_name AS category,
    p.brand,
    p.price::float8 AS price,

    best_sale.sale_price::float8 AS "salePrice",
    (best_sale.sale_price IS NOT NULL) AS "isOnSale",
    best_sale.sale_id AS "saleId",
    best_sale.sale_name AS "saleName",
    best_sale.sale_source AS "saleSource",
    best_sale.sale_scope AS "saleScope",
    best_sale.discount_type AS "saleDiscountType",
    best_sale.discount_value::float8 AS "saleDiscountValue",

    p.is_featured AS "isFeatured",
    p.quantity,
    p.item_type::text AS "itemType",
    p.product_condition::text AS condition,
    p.product_description AS description,
    p.listing_date AS "listingDate",
    p.availability_status::text AS "availabilityStatus",
    CONCAT(u.first_name, ' ', u.last_name) AS seller,
    COALESCE(u.address, 'San Antonio, TX') AS location,

    COALESCE(NULLIF(TRIM(p.image_url), ''), ${categoryImageFallback}) AS image,
    p.image_url AS "imageUrl"

  FROM products p
  JOIN categories c ON p.category_id = c.category_id
  JOIN users u ON p.seller_id = u.user_id

  LEFT JOIN LATERAL (
    SELECT *
    FROM (
      SELECT
        NULL::int AS sale_id,
        'Product Sale'::text AS sale_name,
        'product_sale_price'::text AS sale_source,
        'product'::text AS sale_scope,
        NULL::text AS discount_type,
        NULL::numeric AS discount_value,
        p.sale_price::numeric AS sale_price
      WHERE p.is_on_sale = true
        AND p.sale_price IS NOT NULL
        AND p.sale_price >= 0
        AND p.sale_price < p.price

      UNION ALL

      SELECT
        s.sale_id,
        s.sale_name::text AS sale_name,
        'sales_table'::text AS sale_source,
        s.sale_scope::text AS sale_scope,
        s.discount_type::text AS discount_type,
        s.discount_value::numeric AS discount_value,
        CASE
          WHEN s.discount_type = 'percentage'
            THEN ROUND((p.price * (1 - (s.discount_value / 100)))::numeric, 2)
          WHEN s.discount_type = 'fixed_amount'
            THEN GREATEST(ROUND((p.price - s.discount_value)::numeric, 2), 0)
          ELSE p.price
        END AS sale_price
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
            AND sp.product_id = p.product_id
          )
          OR (
            s.sale_scope = 'category'
            AND sc.category_id = p.category_id
          )
        )
    ) sale_candidates
    WHERE sale_candidates.sale_price < p.price
    ORDER BY sale_candidates.sale_price ASC
    LIMIT 1
  ) best_sale ON true
`;

// GET ALL PRODUCTS
// Returns all currently available products for the marketplace homepage.
export const get_all_products = async () => {
  try {
    return await db.any(`
      ${productSelect}
      WHERE p.availability_status = 'available'
      ORDER BY p.is_featured DESC, p.listing_date DESC, p.product_id DESC
    `);
  } catch (error) {
    console.log("ERROR:", error);
    throw error;
  }
};

// GET PRODUCT BY ID
// Used when we want details for one specific item.
export const get_product_by_id = async (product_id) => {
  try {
    return await db.oneOrNone(
      `
        ${productSelect}
        WHERE p.product_id = $1
      `,
      [product_id]
    );
  } catch (error) {
    console.log("ERROR:", error);
    throw error;
  }
};