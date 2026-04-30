import express from "express";
import { requireAdmin } from "../middleware/require_auth.js";
import {
  adminHealth,
  getAdminDashboard,
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  getAdminUsers,
  updateAdminUser,
  getAdminOrders,
  updateAdminOrderStatus,
  createDiscountCode,
  getDiscountCodes,
  updateDiscountCode,
  deleteDiscountCode,
  createSale,
  getSales,
  updateSale,
  deleteSale,
} from "../controllers/admin_controller.js";

const admin_router = express.Router();

admin_router.use(requireAdmin);

admin_router.get("/health", adminHealth);

admin_router.get("/dashboard", getAdminDashboard);

admin_router.get("/products", getAdminProducts);
admin_router.post("/products", createAdminProduct);
admin_router.patch("/products/:productId", updateAdminProduct);
admin_router.delete("/products/:productId", deleteAdminProduct);

admin_router.get("/users", getAdminUsers);
admin_router.patch("/users/:userId", updateAdminUser);

admin_router.get("/orders", getAdminOrders);
admin_router.patch("/orders/:orderId/status", updateAdminOrderStatus);

admin_router.get("/discount-codes", getDiscountCodes);
admin_router.post("/discount-codes", createDiscountCode);
admin_router.patch("/discount-codes/:discountCodeId", updateDiscountCode);
admin_router.delete("/discount-codes/:discountCodeId", deleteDiscountCode);

admin_router.get("/sales", getSales);
admin_router.post("/sales", createSale);
admin_router.patch("/sales/:saleId", updateSale);
admin_router.delete("/sales/:saleId", deleteSale);

export default admin_router;