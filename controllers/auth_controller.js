import "dotenv/config";
import crypto from "crypto";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
  GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import db from "../db.js";

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || "us-east-2",
});

const COGNITO_PLACEHOLDER_PASSWORD = "COGNITO_MANAGED";

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

const splitFullName = (fullName = "") => {
  const trimmed = fullName.trim();
  if (!trimmed) return ["", ""];
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  return [firstName, lastName];
};

const getSecretHash = (username) => {
  const clientId = (process.env.COGNITO_CLIENT_ID || "").trim();
  const clientSecret = (process.env.COGNITO_CLIENT_SECRET || "").trim();
  const normalizedUsername = (username || "").trim();

  if (!clientId) {
    throw new Error("Missing COGNITO_CLIENT_ID in environment");
  }

  if (!clientSecret) {
    throw new Error("Missing COGNITO_CLIENT_SECRET in environment");
  }

  return crypto
    .createHmac("sha256", clientSecret)
    .update(`${normalizedUsername}${clientId}`)
    .digest("base64");
};

const getUserAttribute = (attributes = [], name) => {
  const found = attributes.find((attr) => attr.Name === name);
  return found?.Value || "";
};

const findOrCreateLocalUser = async ({
  username,
  email,
  firstName,
  lastName,
  phoneNumber,
  address,
}) => {
  const existingUser = await db.oneOrNone(
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
         OR LOWER(email) = LOWER($2)
      LIMIT 1
    `,
    [username, email]
  );

  if (existingUser) {
    return db.one(
      `
        UPDATE users
        SET
          username = $1,
          email = $2,
          first_name = $3,
          last_name = $4,
          phone_number = $5,
          address = $6
        WHERE user_id = $7
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
        username,
        email,
        firstName || null,
        lastName || null,
        phoneNumber || null,
        address || null,
        existingUser.user_id,
      ]
    );
  }

  return db.one(
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
      username,
      COGNITO_PLACEHOLDER_PASSWORD,
      email,
      firstName || null,
      lastName || null,
      phoneNumber || null,
      address || null,
    ]
  );
};

export const signup = async (req, res) => {
  try {
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

    const normalizedUsername = username?.trim() || "";
    const normalizedEmail = email?.trim().toLowerCase() || "";
    const normalizedFullName = fullName?.trim() || "";
    const [derivedFirstName, derivedLastName] = splitFullName(normalizedFullName);
    const resolvedFirstName = firstName?.trim() || derivedFirstName || "";
    const resolvedLastName = lastName?.trim() || derivedLastName || "";

    if (!normalizedUsername || !normalizedEmail || !password || !normalizedFullName) {
      return res.status(400).json({
        error: "Full name, username, email, and password are required",
      });
    }

    const command = new SignUpCommand({
      ClientId: (process.env.COGNITO_CLIENT_ID || "").trim(),
      Username: normalizedUsername,
      Password: password,
      SecretHash: getSecretHash(normalizedUsername),
      UserAttributes: [
        { Name: "email", Value: normalizedEmail },
        { Name: "preferred_username", Value: normalizedUsername },
        { Name: "name", Value: normalizedFullName },
        ...(resolvedFirstName
          ? [{ Name: "given_name", Value: resolvedFirstName }]
          : []),
        ...(resolvedLastName
          ? [{ Name: "family_name", Value: resolvedLastName }]
          : []),
        ...(phoneNumber?.trim()
          ? [{ Name: "phone_number", Value: phoneNumber.trim() }]
          : []),
        ...(address?.trim()
          ? [{ Name: "address", Value: address.trim() }]
          : []),
      ],
    });

    const result = await cognitoClient.send(command);

    return res.status(200).json({
      message: result.UserConfirmed
        ? "Signup successful"
        : "Signup successful. Confirmation code required.",
      username: normalizedUsername,
      userConfirmed: Boolean(result.UserConfirmed),
      userSub: result.UserSub,
      requiresConfirmation: !result.UserConfirmed,
    });
  } catch (error) {
    console.log("COGNITO SIGNUP ERROR:", error);
    return res.status(500).json({
      error: error.name || error.message || "Failed to sign up",
    });
  }
};

export const confirmSignup = async (req, res) => {
  try {
    const { username, code } = req.body;

    if (!username || !code) {
      return res.status(400).json({
        error: "Username and confirmation code are required",
      });
    }

    const normalizedUsername = username.trim();

    const command = new ConfirmSignUpCommand({
      ClientId: (process.env.COGNITO_CLIENT_ID || "").trim(),
      Username: normalizedUsername,
      ConfirmationCode: code.trim(),
      SecretHash: getSecretHash(normalizedUsername),
    });

    await cognitoClient.send(command);

    return res.status(200).json({
      message: "Account confirmed successfully",
    });
  } catch (error) {
    console.log("COGNITO CONFIRM SIGNUP ERROR:", error);
    return res.status(500).json({
      error: error.name || error.message || "Failed to confirm signup",
    });
  }
};

export const resendSignupCode = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        error: "Username is required",
      });
    }

    const normalizedUsername = username.trim();

    const command = new ResendConfirmationCodeCommand({
      ClientId: (process.env.COGNITO_CLIENT_ID || "").trim(),
      Username: normalizedUsername,
      SecretHash: getSecretHash(normalizedUsername),
    });

    await cognitoClient.send(command);

    return res.status(200).json({
      message: "Confirmation code resent",
    });
  } catch (error) {
    console.log("COGNITO RESEND CODE ERROR:", error);
    return res.status(500).json({
      error: error.name || error.message || "Failed to resend confirmation code",
    });
  }
};

export const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        error: "Identifier and password are required",
      });
    }

    const normalizedIdentifier = identifier.trim();

    // This pool is currently using username-based login.
    // Use the Cognito username here, not email.
    if (normalizedIdentifier.includes("@")) {
      return res.status(400).json({
        error: "Use your username to log in, not your email address",
      });
    }

    const cognitoUsername = normalizedIdentifier;

    const authCommand = new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: (process.env.COGNITO_CLIENT_ID || "").trim(),
      AuthParameters: {
        USERNAME: cognitoUsername,
        PASSWORD: password,
        SECRET_HASH: getSecretHash(cognitoUsername),
      },
    });

    const authResult = await cognitoClient.send(authCommand);

    if (authResult.ChallengeName) {
      return res.status(400).json({
        error: `Cognito challenge "${authResult.ChallengeName}" is not handled yet`,
      });
    }

    if (!authResult.AuthenticationResult?.AccessToken) {
      return res.status(400).json({
        error: "No access token returned from Cognito",
      });
    }

    const accessToken = authResult.AuthenticationResult.AccessToken;

    const getUserCommand = new GetUserCommand({
      AccessToken: accessToken,
    });

    const cognitoUser = await cognitoClient.send(getUserCommand);

    const username =
      getUserAttribute(cognitoUser.UserAttributes, "preferred_username") ||
      cognitoUser.Username ||
      cognitoUsername;

    const email = getUserAttribute(cognitoUser.UserAttributes, "email");
    const firstName = getUserAttribute(cognitoUser.UserAttributes, "given_name");
    const lastName = getUserAttribute(cognitoUser.UserAttributes, "family_name");
    const phoneNumber = getUserAttribute(cognitoUser.UserAttributes, "phone_number");
    const address = getUserAttribute(cognitoUser.UserAttributes, "address");

    if (!email) {
      return res.status(400).json({
        error: "Cognito user is missing an email attribute",
      });
    }

    const localUser = await findOrCreateLocalUser({
      username,
      email,
      firstName,
      lastName,
      phoneNumber,
      address,
    });

    return res.status(200).json({
      message: "Login successful",
      token: authResult.AuthenticationResult.AccessToken,
      idToken: authResult.AuthenticationResult.IdToken || null,
      refreshToken: authResult.AuthenticationResult.RefreshToken || null,
      user: buildSafeUser(localUser),
    });
  } catch (error) {
    console.log("COGNITO LOGIN ERROR:", error);
    return res.status(500).json({
      error: error.name || error.message || "Failed to log in",
    });
  }
};

export const logout = async (req, res) => {
  return res.status(200).json({
    message: "Logout successful",
  });
};