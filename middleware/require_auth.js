import { CognitoJwtVerifier } from "aws-jwt-verify";
import db from "../db.js";

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
  tokenUse: "access",
});

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice(7).trim();
};

const loadLocalUserFromCognitoPayload = async (payload) => {
  const username =
    payload.username ||
    payload["cognito:username"] ||
    null;

  const email = payload.email || null;

  // To keep your current controllers working, we map Cognito users
  // back to your local users table and return the same shape as before.
  // This assumes Cognito usernames match your app usernames.
  // If your team later wants a stronger mapping, add a cognito_sub column.
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
      WHERE LOWER(username) = LOWER($1)
         OR ($2 IS NOT NULL AND LOWER(email) = LOWER($2))
      LIMIT 1
    `,
    [username, email]
  );

  return user;
};

const buildAppUser = (user, payload) => ({
  userId: user.user_id,
  username: user.username,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  phoneNumber: user.phone_number,
  address: user.address,
  createdAt: user.created_at,
  cognitoSub: payload.sub,
  groups: payload["cognito:groups"] || [],
});

export const requireUser = async (req, res, next) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Missing authorization token",
      });
    }

    const payload = await verifier.verify(token);

    const localUser = await loadLocalUserFromCognitoPayload(payload);

    if (!localUser) {
      return res.status(404).json({
        error: "No matching local app user found for this Cognito account",
      });
    }

    req.user = buildAppUser(localUser, payload);
    next();
  } catch (err) {
    console.log("Token verification failed:", err);
    return res.status(403).json({
      error: "Invalid or expired token",
    });
  }
};

export const requireAdmin = async (req, res, next) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Missing authorization token",
      });
    }

    const payload = await verifier.verify(token);
    const groups = payload["cognito:groups"] || [];

    if (!groups.includes("admin")) {
      return res.status(401).json({
        error: "Unauthorized access",
      });
    }

    const localUser = await loadLocalUserFromCognitoPayload(payload);

    if (!localUser) {
      return res.status(404).json({
        error: "No matching local app user found for this Cognito account",
      });
    }

    req.user = buildAppUser(localUser, payload);
    next();
  } catch (err) {
    console.log("Token verification failed:", err);
    return res.status(403).json({
      error: "Invalid or expired token",
    });
  }
};