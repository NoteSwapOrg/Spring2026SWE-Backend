import express from 'express'
import cors from 'cors'



import router from "./routes/router.js"

const app = express()
const PORT = 5001

// Middleware
app.use('/', router)
app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})