import express from 'express'
import { order_info, user_info, product_inventory } from '../controllers/db_controller.js'

const db_router = express.Router()

// User Info , Just returns the first user for now
db_router.get('/user_info', (req, res) => {
    user_info(1) // TODO: Remove Hard Coded ID
    .then((data) => {
        res.status(200).json(data)
    })
    .catch((error) => {
        console.log("ERROR: ", error)
    })
})

// * DOESN'T WORK RIGHT NOW * Order Info , We dont have the db schema inserts set up for orders yet
db_router.get('/order_info', (req, res) => {
    order_info(1) // TODO: Remove Hard Coded ID
    .then((data) => {
        res.status(200).json(data)
    })
    .catch((error) => {
        console.log("ERROR: ", error)
    })
})

// Product Inventory
db_router.get('/product_inventory', (req, res) => {
    product_inventory()
    .then((data) => {
        res.status(200).json(data)
    })
    .catch((error) => {
        console.log("ERROR: ", error)
    })
})

export default db_router