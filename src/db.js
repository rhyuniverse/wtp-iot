const mysql = require("mysql2/promise");

const config = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "tesplc"
};

const pool = mysql.createPool({ ...config, charset: "utf8mb4", connectionLimit: 10 });

const schema = [
    "CREATE TABLE IF NOT EXISTS snapshots (machine VARCHAR(16) PRIMARY KEY, payload MEDIUMTEXT NOT NULL, updated_at VARCHAR(32) NOT NULL)",
    "CREATE TABLE IF NOT EXISTS samples (id BIGINT AUTO_INCREMENT PRIMARY KEY, machine VARCHAR(16) NOT NULL, tag VARCHAR(160) NOT NULL, value TEXT, quality TEXT, sampled_at VARCHAR(32) NOT NULL, INDEX samples_machine_tag_time (machine, tag, sampled_at), INDEX samples_time (sampled_at))",
    "CREATE TABLE IF NOT EXISTS alarms (id BIGINT AUTO_INCREMENT PRIMARY KEY, machine VARCHAR(16) NOT NULL, tag VARCHAR(160) NOT NULL, severity VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL, message TEXT NOT NULL, value TEXT, opened_at VARCHAR(32) NOT NULL, acknowledged_at VARCHAR(32), acknowledged_by VARCHAR(64), cleared_at VARCHAR(32), INDEX alarms_status_time (status, opened_at), INDEX alarms_machine_tag_status (machine, tag, status))",
    "CREATE TABLE IF NOT EXISTS alarm_rules (machine VARCHAR(16) NOT NULL, tag VARCHAR(160) NOT NULL, low DOUBLE, high DOUBLE, severity VARCHAR(16) NOT NULL DEFAULT 'warning', PRIMARY KEY (machine, tag))",
    "CREATE TABLE IF NOT EXISTS roles (name VARCHAR(64) PRIMARY KEY, permissions TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS users (username VARCHAR(64) PRIMARY KEY, password_hash VARCHAR(255) NOT NULL, role VARCHAR(64) NOT NULL)",
    "CREATE TABLE IF NOT EXISTS activity (id BIGINT AUTO_INCREMENT PRIMARY KEY, actor VARCHAR(80) NOT NULL, action VARCHAR(80) NOT NULL, target VARCHAR(200) NOT NULL, details TEXT, created_at VARCHAR(32) NOT NULL, INDEX activity_time (created_at))"
];

async function initSchema() {
    try {
        const conn = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password });
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${config.database.replace(/`/g, "")}\` CHARACTER SET utf8mb4`);
        await conn.end();
    } catch (error) { console.warn(`Could not create database (create it manually if missing): ${error.message}`); }
    for (const sql of schema) await pool.query(sql);
}

module.exports = { pool, config, initSchema };
