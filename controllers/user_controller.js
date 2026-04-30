import db from "../db.js";

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

export const getCurrentUserProfile = async (req, res) => {
  try {
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
      [req.user.userId]
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
    console.log("GET CURRENT USER PROFILE ERROR:", error);
    return res.status(500).json({
      error: "Failed to fetch profile",
    });
  }
};

export const updateCurrentUserProfile = async (req, res) => {
  try {
    const {
      username,
      email,
      firstName,
      lastName,
      fullName,
      phoneNumber,
      address,
    } = req.body;

    const [derivedFirstName, derivedLastName] = splitFullName(fullName);

    const normalizedUsername = username?.trim() || "";
    const normalizedEmail = email?.trim().toLowerCase() || "";
    const finalFirstName = firstName?.trim() || derivedFirstName || "";
    const finalLastName = lastName?.trim() || derivedLastName || "";
    const finalPhoneNumber = phoneNumber?.trim() || null;
    const finalAddress = address?.trim() || null;

    if (!normalizedUsername || !normalizedEmail || !finalFirstName || !finalLastName) {
      return res.status(400).json({
        error: "Username, email, first name, and last name are required",
      });
    }

    const existingUser = await db.oneOrNone(
      `
        SELECT user_id, username, email
        FROM users
        WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2))
          AND user_id <> $3
      `,
      [normalizedUsername, normalizedEmail, req.user.userId]
    );

    if (existingUser) {
      const conflictField =
        existingUser.email.toLowerCase() === normalizedEmail ? "email" : "username";

      return res.status(409).json({
        error: `That ${conflictField} is already in use`,
      });
    }

    const updatedUser = await db.one(
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
        normalizedUsername,
        normalizedEmail,
        finalFirstName,
        finalLastName,
        finalPhoneNumber,
        finalAddress,
        req.user.userId,
      ]
    );

    return res.status(200).json({
      message: "Profile updated successfully",
      user: buildSafeUser(updatedUser),
    });
  } catch (error) {
    console.log("UPDATE CURRENT USER PROFILE ERROR:", error);
    return res.status(500).json({
      error: "Failed to update profile",
    });
  }
};