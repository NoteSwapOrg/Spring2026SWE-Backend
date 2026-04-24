import express from "express";
import db_router from "./db_router.js";
import auth_router from "./auth_router.js";
import payment_router from "./payment_router.js";
import user_router from "./user_router.js";
import order_router from "./order_router.js";

const router = express.Router();

router.use("/database", db_router);
router.use("/auth", auth_router);
router.use("/payments", payment_router);
router.use("/users", user_router);
router.use("/orders", order_router);

router.get("/", (req, res) => {
  res.status(200).json("message: connected");
});

export default router;