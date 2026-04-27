import express from "express";
import { requireAdmin } from "../middleware/require_auth.js";
import {
  adminHealth,
  getAdminDashboard,
  getAdminProducts,
  updateAdminProduct,
  getAdminUsers,
  updateAdminUser,
  getAdminOrders,
  updateAdminOrderStatus,
  createDiscountCode,
  getDiscountCodes,
  createSale,
  getSales,
} from "../controllers/admin_controller.js";

const admin_router = express.Router();

admin_router.use(requireAdmin);

admin_router.get("/health", adminHealth);

admin_router.get("/dashboard", getAdminDashboard);

admin_router.get("/products", getAdminProducts);
admin_router.patch("/products/:productId", updateAdminProduct);

admin_router.get("/users", getAdminUsers);
admin_router.patch("/users/:userId", updateAdminUser);

admin_router.get("/orders", getAdminOrders);
admin_router.patch("/orders/:orderId/status", updateAdminOrderStatus);

admin_router.get("/discount-codes", getDiscountCodes);
admin_router.post("/discount-codes", createDiscountCode);

admin_router.get("/sales", getSales);
admin_router.post("/sales", createSale);

export default admin_router;