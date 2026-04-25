import { CognitoJwtVerifier } from "aws-jwt-verify";

// Verifier that expects valid access tokens
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_POOL_ID,
  tokenUse: "access",
  clientId: process.env.COGNITO_CLIENT_ID,
});

// Require an authorized user to be logged in
const requireUser = async (req, res, next) => {
    // extract the jwt token 
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.satus(401).json({
            error: "Invalid Header, Missing Authorization"
        })
    }
    const token = authHeader.split(" ")[1]
    // assess the group
    try {
        const payload = await verifier.verify(token)

        const group = payload["cognito:groups"] || []
        if (!group.includes("user")) {
            return res.status(401).json({
                error: "Unauthorized Access"
            })
        }
        req.user = payload
        next()
    }
    catch (err) {
        console.log("Token Verification Failed: ", err)
        return res.status(403).json({
            error: "invalid or expired token"
        })
    }
}

// Require an authorized admin to be logged in
const requireAdmin = async (req, res, next) => {
    // extract the jwt token 
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.satus(401).json({
            error: "Invalid Header, Missing Authorization"
        })
    }
    const token = authHeader.split(" ")[1]
    // assess the group
    try {
        const payload = await verifier.verify(token)

        const group = payload["cognito:groups"] || []
        if (!group.includes("admin")) {
            return res.status(401).json({
                error: "Unauthorized Access"
            })
        }
        req.user = payload
        next()
    }
    catch (err) {
        console.log("Token Verification Failed: ", err)
        return res.status(403).json({
            error: "invalid or expired token"
        })
    }
}