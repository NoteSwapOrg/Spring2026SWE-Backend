import express from "express";
import db_router from "./db_router.js";
import auth_router from "./auth_router.js";

// Main top-level router.
// This file acts like the traffic director for backend routes.
const router = express.Router();

// All database-related routes will begin with /database
router.use("/database", db_router);

// All authentication-related routes will begin with /auth
router.use("/auth", auth_router);

// Simple root route for testing that the server/router is alive.
router.get("/", (req, res) => {
  res.status(200).json("message: connected");
});

export default router;