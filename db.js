import pgPromise from "pg-promise";
import "dotenv/config";

// Initialize pg-promise once for the whole backend.
const pgp = pgPromise({});

// Create one shared database connection using the DB_CONNECTION value from .env
const db = pgp(process.env.DB_CONNECTION);

// Export the shared db instance so controllers can import and use it.
export default db;