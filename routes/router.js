import express from 'express'
import db_router from './db_router.js';

const router = express.Router();

// Child Routes
router.use('/database', db_router)

// Default Route
router.get('/', (req, res) => {
  res.status(200).json("message: connected")
})

export default router