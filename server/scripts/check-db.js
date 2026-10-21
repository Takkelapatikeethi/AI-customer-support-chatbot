const { pool, checkDatabase } = require("../database");

(async () => {
  try {
    const result = await checkDatabase();
    console.log(`Database connected: ${result.database_name}`);
    const [tables] = await pool.query("SHOW TABLES");
    console.log("Tables:", tables.map((row) => Object.values(row)[0]).join(", "));
  } catch (error) {
    console.error("Database check failed:", error.code || "DATABASE_ERROR");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
