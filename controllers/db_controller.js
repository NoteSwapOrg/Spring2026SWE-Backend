const pgp = require("pg-promise")
const db = pgp(''); // TODO: Database URL Here

// Order Info
db.many('SELECT * AS order_info FROM orders')
    .then((data) => {
        console.log("ORDER INFO: ", data.order_info) // PLACEHOLDER - Handle Data Here
    })
    .catch((error) => {
        console.log("ERROR: ", error)
    })