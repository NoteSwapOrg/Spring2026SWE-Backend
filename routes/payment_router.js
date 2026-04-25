import express from "express";
import { requireUser } from "../middleware/require_auth.js";
import {
  createCheckoutSession,
  finalizeOrder,
} from "../controllers/payment_controller.js";

const payment_router = express.Router();

payment_router.post("/create-checkout-session", requireUser, createCheckoutSession);
payment_router.post("/finalize-order", requireUser, finalizeOrder);

export default payment_router;