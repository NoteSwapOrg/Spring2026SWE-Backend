import express from "express";
import { requireAuth } from "../middleware/require_auth.js";
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
} from "../controllers/user_controller.js";

const user_router = express.Router();

user_router.get("/me", requireAuth, getCurrentUserProfile);
user_router.patch("/me", requireAuth, updateCurrentUserProfile);

export default user_router;