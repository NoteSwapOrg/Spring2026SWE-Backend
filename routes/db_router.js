import express from "express";
import {
  get_all_products,
  get_product_by_id,
  order_info,
  user_info,
} from "../controllers/db_controller.js";

const db_router = express.Router();

db_router.get("/user_info", async (req, res) => {
  try {
    const data = await user_info(1);
    res.status(200).json(data);
  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({ error: "Failed to fetch user info" });
  }
});

db_router.get("/order_info", async (req, res) => {
  try {
    const data = await order_info(1);
    res.status(200).json(data);
  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({ error: "Failed to fetch order info" });
  }
});

db_router.get("/products", async (req, res) => {
  try {
    const data = await get_all_products();
    res.status(200).json(data);
  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

db_router.get("/products/:product_id", async (req, res) => {
  try {
    const productId = Number(req.params.product_id);

    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const data = await get_product_by_id(productId);

    if (!data) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json(data);
  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

export default db_router;