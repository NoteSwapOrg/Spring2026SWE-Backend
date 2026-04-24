import express from "express";
import { requireAuth } from "../middleware/require_auth.js";
import {
  getMyOrders,
  getOrderById,
} from "../controllers/order_controller.js";

const order_router = express.Router();

order_router.get("/my-orders", requireAuth, getMyOrders);
order_router.get("/:orderId", requireAuth, getOrderById);

export default order_router;