import pgPromise from "pg-promise"
import "dotenv/config"

const pgp = pgPromise({})
const db = pgp(process.env.DB_CONNECTION); // Database URL Here

/* DB READS */
// User_info
export const user_info = async (user_id) => {
    try {
        const user_info = await db.one('SELECT * FROM users WHERE user_id = $1', user_id)
        return user_info
    }
    catch (error) {
        console.log("ERROR: ", error)
    }
}

// Order Info
export const order_info = async (order_id) => {
    try {
        const order_info = await db.one('SELECT * FROM orders WHERE order_id = $1', order_id)
        return order_info
    }
    catch (error) {
        console.log("ERROR: ", error)
    }
}

