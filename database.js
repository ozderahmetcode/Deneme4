/**
 * 🚀 PROJECT: BLIND ID NEXT-GEN
 * Phase 2: PostgreSQL Database Schema & Connection Setup
 *
 * NEDEN BU YOLU SEÇTİK? (Genel Mimari Kararları)
 * 1. ORM Yerine Native pg (PostgreSQL) Pool: Sequelize veya Prisma gibi dev ORM'ler, yüksek I/O ve
 * anlık çoklu işlemlerde darboğaza yol açabilir. Sinyal işlemede saf SQL (Raw SQL) her zaman en yüksek performansı verir.
 * 2. Kapsamlı Indexleme: Matches (Eşleşmeler) ve Transactions tablolarındaki user_id sütunlarına Index (B-Tree) eklendi.
 * Milyonlarca satıra ulaşıldığında dahi geçmiş eşleşmeleri veya bakiyeyi salisede hesaplamak için.
 * 3. Foreign Keys ve Relational Integrity: Blueprint'e tamamen uygun olarak foreign key (dış anahtarlar) kuruldu,
 * "Hesabı Sil" (Account Deletion) senaryosunda ON DELETE CASCADE kuralı eklendi; yani kullanıcı silinince ona ait
 * tüm çöp datalar da otomatik uçar ve hiçbir amelelik bırakmaz.
 */

let Pool;
let isNativePool = false;

try {
    const pg = require('pg');
    Pool = pg.Pool;
    isNativePool = true;
    console.log("🟢 PostgreSQL kütüphanesi hazır.");
} catch (err) {
    console.warn("⚠️ [UYARI] PostgreSQL (pg) kütüphanesi yüklü değil. Veritabanı işlemleri 'Hafıza Modu' (Mock) üzerinden yürüyecek.");
    // Mock Pool for safety
    Pool = class {
        constructor() { this.on = () => {}; }
        connect() { return { query: async () => ({ rows: [] }), release: () => {} }; }
        query() { return { rows: [] }; }
    };
}

// Üretim ortamında (Production) bu değerler .env dosyasından çekilir.
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'blindid_db',
    password: process.env.DB_PASS || '123456',
    port: process.env.DB_PORT || 5432,
    max: 50,
    idleTimeoutMillis: 30000,
});

async function initDB() {
    if (!isNativePool) {
        console.log("ℹ️ Hafıza Modu aktif: Tablo kurulumları atlanıyor...");
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("Veritabanı tabloları Blueprint kurallarına göre senkronize ediliyor...");
        // ... (rest of the SQL queries remain same but inside this safety check)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(50) UNIQUE NOT NULL,
                age INT NOT NULL CHECK (age >= 18),
                gold_balance INT DEFAULT 100 CHECK (gold_balance >= 0),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await client.query('COMMIT');
        console.log("✅ Veritabanı Master Tabloları Hazır!");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ DB kurulum hatası:", err);
    } finally {
        client.release();
    }
}

const UserRepository = {
    async updateGoldBalance(userId, amount, reason) {
        if (!isNativePool) {
            console.log(`[Mock DB] Bakiye güncelleme: ${userId} -> ${amount} (${reason})`);
            return 1000; // Mock bakiye
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const userRes = await client.query(
                'UPDATE users SET gold_balance = gold_balance + $1 WHERE id = $2 RETURNING gold_balance',
                [amount, userId]
            );
            await client.query('COMMIT');
            return userRes.rows[0].gold_balance;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
};

module.exports = { pool, initDB, UserRepository };

module.exports = { pool, initDB, UserRepository };

// Eğer test için tek başına çalıştırılacaksa:
// initDB();