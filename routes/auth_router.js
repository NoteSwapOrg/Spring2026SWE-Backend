import express from "express";
import { login, logout, me, signup } from "../controllers/auth_controller.js";

// Router dedicated to auth-related endpoints.
const auth_router = express.Router();

// Create a new account
auth_router.post("/signup", signup);

// Log into an existing account
auth_router.post("/login", login);

// Return the currently logged-in user based on JWT
auth_router.get("/me", me);

// Logout endpoint
auth_router.post("/logout", logout);

export default auth_router;