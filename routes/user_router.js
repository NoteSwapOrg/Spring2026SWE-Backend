import express from "express";
import { requireUser } from "../middleware/require_auth.js";
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
} from "../controllers/user_controller.js";

const user_router = express.Router();

user_router.get("/me", requireUser, getCurrentUserProfile);
user_router.patch("/me", requireUser, updateCurrentUserProfile);

export default user_router;