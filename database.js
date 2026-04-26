/**
 * 🚀 PROJECT: OZDER NEXT-GEN
 * Modül: PostgreSQL Veritabanı & Şema Yönetimi
 * 
 * Mimari:
 * 1. Native pg Pool — ORM kullanmıyoruz, saf SQL ile maksimum performans
 * 2. Graceful Fallback — DB yoksa hafıza modunda çalışır
 * 3. ON DELETE CASCADE — Kullanıcı silinince tüm ilişkili veriler temizlenir
 */

const { Pool } = require('pg');

// Üretim ortamında DATABASE_URL öncelikli
const isProduction = process.env.NODE_ENV === 'production';
const connectionConfig = process.env.DATABASE_URL 
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: process.env.DB_SSL_STRICT === 'true' } : false
      }
    : {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'ozder_db',
        password: process.env.DB_PASS || '123456',
        port: process.env.DB_PORT || 5432,
      };

const pool = new Pool({
    ...connectionConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// DB bağlantı durumu
let isDBConnected = false;

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("📦 Veritabanı tabloları senkronize ediliyor...");

        // UUID ve Crypto fonksiyonları için eklenti (PG < 13 uyumluluğu)
        await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

        // Users tablosu — genişletilmiş şema
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                age INT CHECK (age >= 18),
                gender VARCHAR(20) DEFAULT 'belirtilmemiş',
                region VARCHAR(50) DEFAULT 'Türkiye',
                avatar_url TEXT,
                bio TEXT DEFAULT '',
                zodiac VARCHAR(20) DEFAULT '',
                gold_balance INT DEFAULT 100 CHECK (gold_balance >= 0),
                xp INT DEFAULT 0,
                level INT DEFAULT 1,
                is_vip BOOLEAN DEFAULT false,
                is_banned BOOLEAN DEFAULT false,
                ban_reason TEXT,
                last_login TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Eşleşme geçmişi
        await client.query(`
            CREATE TABLE IF NOT EXISTS matches (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
                user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
                duration_seconds INT DEFAULT 0,
                user1_rating VARCHAR(10),
                user2_rating VARCHAR(10),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Altın işlem geçmişi
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                amount INT NOT NULL,
                reason VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Arkadaşlık sistemi
        await client.query(`
            CREATE TABLE IF NOT EXISTS friendships (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                friend_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, friend_id)
            );
        `);

        // Raporlar
        await client.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
                reported_id UUID REFERENCES users(id) ON DELETE CASCADE,
                reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Index'ler — hızlı sorgu için
        await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);`);

        await client.query('COMMIT');
        isDBConnected = true;
        console.log("✅ Veritabanı Master Tabloları Hazır! (5 tablo, 4 index)");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ DB kurulum hatası:", err.message);
        throw err;
    } finally {
        client.release();
    }
}

const UserRepository = {
    async createUser(userData) {
        if (!isDBConnected) {
            console.log(`[Mock DB] Yeni kullanıcı oluşturuldu. (İsim maskelendi)`);
            return { id: `mock_${Date.now()}`, ...userData, gold_balance: 100 };
        }
        const res = await pool.query(
            `INSERT INTO users (username, password_hash, age, gender, region, avatar_url, zodiac) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [userData.username, userData.password, userData.age, userData.gender, userData.region, userData.avatarUrl, userData.zodiac]
        );
        return res.rows[0];
    },

    async updateGoldBalance(userId, amount, reason) {
        if (!isDBConnected) {
            console.log(`[Mock DB] Bakiye güncelleme: ${userId} -> ${amount} (${reason})`);
            return 1000;
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const userRes = await client.query(
                'UPDATE users SET gold_balance = gold_balance + $1 WHERE id = $2 RETURNING gold_balance',
                [amount, userId]
            );
            await client.query(
                'INSERT INTO transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
                [userId, amount, reason]
            );
            await client.query('COMMIT');
            return userRes.rows[0].gold_balance;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    },

    async getUserById(userId) {
        if (!isDBConnected) {
            return { id: userId, username: 'MockUser', gold_balance: 1000 };
        }
        const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        return res.rows[0];
    },

    async getUserByUsername(username) {
        if (!isDBConnected) return null;
        const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return res.rows[0];
    },

    async recordMatch(user1Id, user2Id, durationSeconds) {
        if (!isDBConnected) return;
        await pool.query(
            'INSERT INTO matches (user1_id, user2_id, duration_seconds) VALUES ($1, $2, $3)',
            [user1Id, user2Id, durationSeconds]
        );
        // Madde 10: Başarılı eşleşme ödülü (Sunucu tarafı güvenli gold kazanımı)
        await this.updateGoldBalance(user1Id, 5, 'Match Reward');
        await this.updateGoldBalance(user2Id, 5, 'Match Reward');
    },

    async addFriend(userId, friendId) {
        if (!isDBConnected) return;
        await pool.query(
            'INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [userId, friendId, 'accepted']
        );
    },

    async reportUser(reporterId, reportedId, reason) {
        if (!isDBConnected) return;
        await pool.query(
            'INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)',
            [reporterId, reportedId, reason]
        );
    },

    async updateUserPreference(userId, preference) {
        if (!isDBConnected) return;
        // Madde 16: Kullanıcı tercihini bölge alanında veya özel bir kolonda sakla
        await pool.query('UPDATE users SET region = $1 WHERE id = $2', [preference, userId]);
    }
};

module.exports = { pool, initDB, UserRepository };