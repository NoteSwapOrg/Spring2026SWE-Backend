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

const getEnvList = (value = "") => {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const loadLocalUserFromCognitoPayload = async (payload) => {
  const username = payload.username || payload["cognito:username"] || null;
  const email = payload.email || null;
  const cognitoSub = payload.sub || null;

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
        cognito_sub,
        role,
        is_active,
        created_at
      FROM users
      WHERE
        ($1 IS NOT NULL AND cognito_sub = $1)
        OR ($2 IS NOT NULL AND LOWER(username) = LOWER($2))
        OR ($3 IS NOT NULL AND LOWER(email) = LOWER($3))
      LIMIT 1
    `,
    [cognitoSub, username, email]
  );

  if (!user) {
    return null;
  }

  if (cognitoSub && !user.cognito_sub) {
    await db.none(
      `
        UPDATE users
        SET cognito_sub = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
      `,
      [cognitoSub, user.user_id]
    );

    user.cognito_sub = cognitoSub;
  }

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
  role: user.role || "customer",
  isActive: user.is_active !== false,
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

    if (localUser.is_active === false) {
      return res.status(403).json({
        error: "This account has been deactivated",
      });
    }

    req.cognitoPayload = payload;
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
    const localUser = await loadLocalUserFromCognitoPayload(payload);

    if (!localUser) {
      return res.status(404).json({
        error: "No matching local app user found for this Cognito account",
      });
    }

    if (localUser.is_active === false) {
      return res.status(403).json({
        error: "This account has been deactivated",
      });
    }

    const groups = payload["cognito:groups"] || [];
    const normalizedGroups = groups.map((group) => String(group).toLowerCase());

    const tokenEmail = payload.email?.toLowerCase() || "";
    const localEmail = localUser.email?.toLowerCase() || "";
    const adminEmails = getEnvList(process.env.ADMIN_EMAILS || "");

    const isAdminByCognitoGroup =
      normalizedGroups.includes("admin");

    const isAdminByDatabaseRole =
      String(localUser.role || "").toLowerCase() === "admin";

    const isAdminByTemporaryEmail =
      adminEmails.includes(tokenEmail) || adminEmails.includes(localEmail);

    const isAdmin =
      isAdminByCognitoGroup ||
      isAdminByDatabaseRole ||
      isAdminByTemporaryEmail;

    if (!isAdmin) {
      return res.status(403).json({
        error: "Admin access required",
      });
    }

    req.cognitoPayload = payload;
    req.user = buildAppUser(localUser, payload);

    next();
  } catch (err) {
    console.log("Admin token verification failed:", err);
    return res.status(403).json({
      error: "Invalid or expired token",
    });
  }
};