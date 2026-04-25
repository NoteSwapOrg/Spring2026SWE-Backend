import express from "express";
import { requireAuth } from "../middleware/require_auth.js";
import {
  createCheckoutSession,
  finalizeOrder,
} from "../controllers/payment_controller.js";

const payment_router = express.Router();

payment_router.post("/create-checkout-session", requireAuth, createCheckoutSession);
payment_router.post("/finalize-order", requireAuth, finalizeOrder);

export default payment_router;