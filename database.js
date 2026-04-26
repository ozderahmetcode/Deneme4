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
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASS,
        port: process.env.DB_PORT || 5432,
      };

if (!isProduction && !process.env.DATABASE_URL && !process.env.DB_PASS) {
    console.warn("⚠️ [Güvenlik] DB_PASS eksik. Veritabanı bağlantısı kurulamayabilir.");
}

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

        // Madde 6: Match Preference Kolonu Ekle (Mevcut tabloları bozmadan güncelle)
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS match_preference VARCHAR(20) DEFAULT 'mixed';`);

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
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(reporter_id, reported_id)
            );
        `);

        // Refresh Token Tablosu
        await client.query(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
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
            console.log(`[Mock DB] Yeni kullanıcı oluşturuldu.`);
            return { id: `mock_${Date.now()}`, ...userData, gold_balance: 100 };
        }
        // Madde 28: Naming confusion fix (password_hash)
        const res = await pool.query(
            `INSERT INTO users (username, password_hash, age, gender, region, avatar_url, zodiac) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [userData.username, userData.password_hash || userData.password, userData.age, userData.gender, userData.region, userData.avatarUrl, userData.zodiac]
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
            // Madde 14 & 93 Fix: Mock veriyi tam şema ile senkronize et (Tutarlılık)
            return { 
                id: userId, 
                username: 'MockUser', 
                gold_balance: 1000, 
                level: 1, 
                xp: 0, 
                is_vip: false, 
                match_preference: 'mixed',
                gender: 'belirtilmemiş',
                age: 22,
                region: 'Türkiye',
                avatar_url: ''
            };
        }
        // Madde 25 & 81 Fix: Şema uyumlu kolon seçimi (gold -> gold_balance, reports_count silindi)
        const res = await pool.query(
            'SELECT id, username, avatar_url, gender, age, region, is_banned, match_preference, gold_balance, level, xp, is_vip FROM users WHERE id = $1', 
            [userId]
        );
        return res.rows[0];
    },

    async getUserByUsername(username) {
        if (!isDBConnected) return null;
        const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return res.rows[0];
    },

    async recordMatch(user1Id, user2Id, durationSeconds = 0) {
        if (!isDBConnected) return;
        await pool.query(
            'INSERT INTO matches (user1_id, user2_id, duration_seconds) VALUES ($1, $2, $3)',
            [user1Id, user2Id, durationSeconds]
        );
        // Madde 21: Başarılı eşleşme ödülü (5 Gold)
        await this.updateGoldBalance(user1Id, 5, 'Match Reward');
        await this.updateGoldBalance(user2Id, 5, 'Match Reward');
    },
    async addFriend(userId, friendId) {
        if (!isDBConnected) return;
        // Mevcut isteği kabul et (Status güncelle)
        await pool.query(
            'INSERT INTO friendships (user_id, friend_id, status) VALUES ($2, $1, $3) ON CONFLICT (user_id, friend_id) DO UPDATE SET status = $3',
            [userId, friendId, 'accepted']
        );
        // Karşılıklı ekleme
        await pool.query(
            'INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, $3) ON CONFLICT (user_id, friend_id) DO UPDATE SET status = $3',
            [userId, friendId, 'accepted']
        );
    },
    async sendFriendRequest(senderId, targetId) {
        if (!isDBConnected) return;
        await pool.query(
            'INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, $3) ON CONFLICT (user_id, friend_id) DO NOTHING',
            [senderId, targetId, 'pending']
        );
    },
    async hasPendingFriendRequest(senderId, targetId) {
        if (!isDBConnected) return false;
        const res = await pool.query(
            'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = $3',
            [senderId, targetId, 'pending']
        );
        return res.rowCount > 0;
    },
    async getPendingFriendRequests(userId) {
        if (!isDBConnected) return [];
        const res = await pool.query(
            `SELECT f.user_id as sender_id, u.username as sender_name, u.avatar_url as sender_avatar 
             FROM friendships f 
             JOIN users u ON f.user_id = u.id 
             WHERE f.friend_id = $1 AND f.status = 'pending'`,
            [userId]
        );
        return res.rows;
    },
    async rejectFriendRequest(userId, friendId) {
        if (!isDBConnected) return;
        await pool.query(
            'DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = $3',
            [friendId, userId, 'pending']
        );
    },
    async removeFriend(userId, friendId) {
        if (!isDBConnected) return;
        await pool.query(
            'DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
            [userId, friendId]
        );
    },
    async isFriends(userId, friendId) {
        if (!isDBConnected) return true; // Mock modunda izin ver
        const res = await pool.query(
            'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = $3',
            [userId, friendId, 'accepted']
        );
        return res.rowCount > 0;
    },
    async reportUser(reporterId, reportedId, reason) {
        if (!isDBConnected) return;

        // Madde 11 Fix: 24 saatlik mükerrer rapor kontrolü (Report Spam Protection)
        const checkRes = await pool.query(
            'SELECT id FROM reports WHERE reporter_id = $1 AND reported_id = $2 AND created_at > NOW() - INTERVAL \'24 hours\'',
            [reporterId, reportedId]
        );
        
        if (checkRes.rowCount > 0) {
            console.warn(`⚠️ [Audit] Mükerrer rapor engellendi: ${reporterId} -> ${reportedId}`);
            return false; // Başarısız/Engellendi
        }

        await pool.query(
            'INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3) ON CONFLICT (reporter_id, reported_id) DO NOTHING',
            [reporterId, reportedId, reason]
        );
        return true;
    },
    async updateUserPreference(userId, preference) {
        if (!isDBConnected) return;
        await pool.query('UPDATE users SET match_preference = $1 WHERE id = $2', [preference, userId]);
    },
    // --- REFRESH TOKEN METHODS ---
    async saveRefreshToken(userId, token, expiresAt) {
        if (!isDBConnected) return;
        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [userId, token, expiresAt]
        );
    },
    async verifyRefreshToken(token) {
        if (!isDBConnected) return null;
        const res = await pool.query(
            'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
            [token]
        );
        return res.rowCount > 0 ? res.rows[0].user_id : null;
    },
    async consumeRefreshToken(token) {
        if (!isDBConnected) return null;
        // Madde 11 Fix: Atomic Verify & Delete (Race Condition Prevention)
        const res = await pool.query(
            'DELETE FROM refresh_tokens WHERE token = $1 AND expires_at > NOW() RETURNING user_id',
            [token]
        );
        return res.rowCount > 0 ? res.rows[0].user_id : null;
    },
    async deleteUserRefreshTokens(userId) {
        if (!isDBConnected) return;
        await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    }
};

module.exports = { initDB, UserRepository, pool };