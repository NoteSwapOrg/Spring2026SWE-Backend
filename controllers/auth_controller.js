import "dotenv/config";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../db.js";

// Number of salt rounds used by bcrypt when hashing passwords.
// Higher = more secure, but slower.
const SALT_ROUNDS = 10;

// Helper function that removes sensitive fields before sending a user back to the frontend.
// We never want to return password_hash to the client.
const buildSafeUser = (user) => ({
  userId: user.user_id,
  username: user.username,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  phoneNumber: user.phone_number,
  address: user.address,
  createdAt: user.created_at,
});

// Creates a signed JWT token for a successfully authenticated user.
// The token stores a few basic identifying fields.
const signToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET in environment");
  }

  return jwt.sign(
    {
      userId: user.user_id,
      username: user.username,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

// Reads the Bearer token from the Authorization header.
// Example header format: "Authorization: Bearer abc123..."
const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
};

// If the frontend sends one full name string instead of separate first/last names,
// this helper splits it into two pieces for the database.
const splitFullName = (fullName = "") => {
  const trimmed = fullName.trim();
  if (!trimmed) return ["", ""];
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  return [firstName, lastName];
};

// SIGNUP CONTROLLER
// Creates a new user account.
export const signup = async (req, res) => {
  try {
    // Pull values from the request body sent by the frontend.
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      fullName,
      phoneNumber,
      address,
    } = req.body;

    // Normalize values before using them.
    const normalizedEmail = email?.trim().toLowerCase() || "";
    const derivedUsername = username?.trim() || normalizedEmail.split("@")[0] || "";
    const [derivedFirstName, derivedLastName] = splitFullName(fullName);
    const finalFirstName = firstName?.trim() || derivedFirstName;
    const finalLastName = lastName?.trim() || derivedLastName;

    // Basic required field validation.
    if (!normalizedEmail || !password || !derivedUsername || !finalFirstName || !finalLastName) {
      return res.status(400).json({
        error:
          "username or email, password, first name, and last name are required",
      });
    }

    // Password minimum length check.
    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    // Check whether username or email is already in use.
    const existingUser = await db.oneOrNone(
      `
        SELECT user_id, username, email
        FROM users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($2)
      `,
      [derivedUsername, normalizedEmail]
    );

    if (existingUser) {
      const conflictField =
        existingUser.email.toLowerCase() === normalizedEmail ? "email" : "username";

      return res.status(409).json({
        error: `That ${conflictField} is already in use`,
      });
    }

    // Hash the password before storing it in the database.
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert the new user and return the created row.
    const newUser = await db.one(
      `
        INSERT INTO users (
          username,
          password_hash,
          email,
          first_name,
          last_name,
          phone_number,
          address
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          user_id,
          username,
          email,
          first_name,
          last_name,
          phone_number,
          address,
          created_at
      `,
      [
        derivedUsername,
        passwordHash,
        normalizedEmail,
        finalFirstName,
        finalLastName,
        phoneNumber?.trim() || null,
        address?.trim() || null,
      ]
    );

    // Generate a JWT for the newly created user.
    const token = signToken(newUser);

    // Return a success response, token, and safe user object.
    return res.status(201).json({
      message: "Signup successful",
      token,
      user: buildSafeUser(newUser),
    });
  } catch (error) {
    console.log("SIGNUP ERROR:", error);
    return res.status(500).json({
      error: "Failed to create account",
    });
  }
};

// LOGIN CONTROLLER
// Verifies credentials and returns a token if correct.
export const login = async (req, res) => {
  try {
    const { identifier, email, username, password } = req.body;

    // Allow login by identifier, email, or username.
    const loginValue = (identifier || email || username || "").trim().toLowerCase();

    if (!loginValue || !password) {
      return res.status(400).json({
        error: "identifier and password are required",
      });
    }

    // Look up the user by username or email.
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
          created_at,
          password_hash
        FROM users
        WHERE LOWER(email) = LOWER($1)
           OR LOWER(username) = LOWER($1)
      `,
      [loginValue]
    );

    if (!user) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    // Compare the submitted password with the stored hash.
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    // Create a token for the authenticated user.
    const token = signToken(user);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: buildSafeUser(user),
    });
  } catch (error) {
    console.log("LOGIN ERROR:", error);
    return res.status(500).json({
      error: "Failed to log in",
    });
  }
};

// ME CONTROLLER
// Returns the currently logged-in user based on the Bearer token.
export const me = async (req, res) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Missing authorization token",
      });
    }

    // Verify the JWT and decode the payload.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the user from the database using the userId stored in the token.
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
      return res.status(404).json({
        error: "User not found",
      });
    }

    return res.status(200).json({
      user: buildSafeUser(user),
    });
  } catch (error) {
    console.log("ME ERROR:", error);
    return res.status(401).json({
      error: "Invalid or expired token",
    });
  }
};

// LOGOUT CONTROLLER
// For this version, logout is mostly a frontend action.
// The frontend removes the token from storage.
// This route exists so the frontend has a clean logout endpoint to call.
export const logout = async (req, res) => {
  return res.status(200).json({
    message: "Logout successful. Remove the token on the client.",
  });
};