const express = require('express')

const router = express.Router;

// Default Route
app.get('/', (req, res) => {
  res.status(200).json({message: "connected"})
})

export default router