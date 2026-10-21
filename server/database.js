const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_SSL_CA"]) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key}. Configure server/.env before starting the backend.`);
  }
}

const dbPort = Number(process.env.DB_PORT || 3306);
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  throw new Error("DB_PORT must be a valid port number.");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: dbPort,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: fs.readFileSync(path.resolve(__dirname, process.env.DB_SSL_CA)),
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 50,
  connectTimeout: 10000,
  enableKeepAlive: true,
  charset: "utf8mb4",
  supportBigNumbers: true,
  bigNumberStrings: true,
});

async function checkDatabase() {
  const [rows] = await pool.execute("SELECT DATABASE() AS database_name, 1 AS connected");
  return rows[0];
}

module.exports = { pool, checkDatabase };
