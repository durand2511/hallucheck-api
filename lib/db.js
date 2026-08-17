const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { require: true, rejectUnauthorized: false },
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
