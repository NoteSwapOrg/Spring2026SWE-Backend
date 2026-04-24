import jwt from "jsonwebtoken";
import db from "../db.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing authorization token",
      });
    }

    const token = authHeader.slice(7).trim();

    if (!process.env.JWT_SECRET) {
      throw new Error("Missing JWT_SECRET in environment");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await db.oneOrNone(
      `
        SELECT
          user_id,
          username,
          email,
          first_name,
          last_name,
          phone_number,
          address,
          created_at
        FROM users
        WHERE user_id = $1
      `,
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({
        error: "User not found",
      });
    }

    req.user = {
      userId: user.user_id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    };

    next();
  } catch (error) {
    console.log("AUTH MIDDLEWARE ERROR:", error);
    return res.status(401).json({
      error: "Invalid or expired token",
    });
  }
};