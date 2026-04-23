import db from "../db.js";

/* DB READS */

// USER INFO
// Simple example query that fetches one user by user_id.
export const user_info = async (user_id) => {
  try {
    const user_info = await db.one("SELECT * FROM users WHERE user_id = $1", [user_id]);
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
    const order_info = await db.one("SELECT * FROM orders WHERE order_id = $1", [order_id]);
    return order_info;
  } catch (error) {
    console.log("ERROR:", error);
    throw error;
  }
};

// Shared SQL fragment for product lookups.
// This joins products with categories and users so the frontend gets
// one clean object with everything it needs for display.
const productSelect = `
  SELECT
    p.product_id AS id,
    p.sku,
    p.product_name AS name,
    c.category_name AS category,
    p.brand,
    p.price::float8 AS price,
    p.quantity,
    p.item_type::text AS "itemType",
    p.product_description AS description,
    p.listing_date AS "listingDate",
    p.availability_status::text AS "availabilityStatus",
    CONCAT(u.first_name, ' ', u.last_name) AS seller,
    COALESCE(u.address, 'San Antonio, TX') AS location,
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
  FROM products p
  JOIN categories c ON p.category_id = c.category_id
  JOIN users u ON p.seller_id = u.user_id
`;

// GET ALL PRODUCTS
// Returns all currently available products for the marketplace homepage.
export const get_all_products = async () => {
  try {
    return await db.any(`
      ${productSelect}
      WHERE p.availability_status = 'available'
      ORDER BY p.listing_date DESC, p.product_id DESC
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