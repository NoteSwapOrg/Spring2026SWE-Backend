import pgPromise from "pg-promise"
import "dotenv/config"

const pgp = pgPromise({})
const db = pgp(process.env.DB_CONNECTION); // Database URL Here

/* DB READS */
// User info - Retrieve user information with user id
export const user_info = async (user_id) => {
    try {
        const user_info = await db.one('SELECT * FROM users WHERE user_id = $1', user_id)
        return user_info
    }
    catch (error) {
        console.log("ERROR: ", error)
    }
}

// Order Info - Retrieve order information with order id
export const order_info = async (order_id) => {
    try {
        const order_info = await db.one('SELECT * FROM orders WHERE order_id = $1', order_id)
        return order_info
    }
    catch (error) {
        console.log("ERROR: ", error)
    }
}

// Product Inventory - Retrieve a list of all products in inventory
export const product_inventory = async () => {
    try {
        const product_inventory = await db.many('SELECT * FROM products')
        return product_inventory
    }
    catch (error) {
        console.log("ERROR: ", error)
    }
}