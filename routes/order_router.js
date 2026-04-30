import express from "express";
import { requireUser } from "../middleware/require_auth.js";
import {
  getMyOrders,
  getOrderById,
} from "../controllers/order_controller.js";

const order_router = express.Router();

order_router.get("/my-orders", requireUser, getMyOrders);
order_router.get("/:orderId", requireUser, getOrderById);

export default order_router;