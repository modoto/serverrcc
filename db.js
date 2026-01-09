const { Pool } = require("pg");

const pool = new Pool({
  //host: "192.167.61.2",
  host: "localhost",
  user: "postgres",
  password: "P@ssword",
  database: "dbcomando",
  port: 5432,
});

module.exports = pool;
