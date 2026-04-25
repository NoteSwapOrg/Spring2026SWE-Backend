import express from "express";
import {
  signup,
  confirmSignup,
  resendSignupCode,
  login,
  logout,
} from "../controllers/auth_controller.js";

const auth_router = express.Router();

auth_router.post("/signup", signup);
auth_router.post("/confirm-signup", confirmSignup);
auth_router.post("/resend-signup-code", resendSignupCode);
auth_router.post("/login", login);
auth_router.post("/logout", logout);

export default auth_router;