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

const { Pool } = require('pg');

// Üretim ortamında (Production) bu değerler .env dosyasından çekilir.
// max: 50 -> Aynı anda maksimum 50 eşzamanlı aktif veritabanı bağlantısı (Yüksek performans havuzu).
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'blindid_db',
    password: process.env.DB_PASS || '123456',
    port: process.env.DB_PORT || 5432,
    max: 50,
    idleTimeoutMillis: 30000,
});

pool.on('error', (err, client) => {
    console.error('Beklenmeyen bir Error PostgreSQL istemcisinde bozulmaya sebep oldu', err);
    process.exit(-1);
});

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Transaction başlatıldı (Eğer biri hata verirse hiçbiri oluşmaz - Safe Rollback)

        console.log("Veritabanı tabloları Blueprint kurallarına göre senkronize ediliyor...");

        // 1. USERS TABLOSU
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(50) UNIQUE NOT NULL,
                age INT NOT NULL CHECK (age >= 18), -- Güvenlik için DB bazında +18 yaş filtresi
                height INT,
                weight INT,
                gold_balance INT DEFAULT 100 CHECK (gold_balance >= 0),
                karma_score INT DEFAULT 100,
                city_id VARCHAR(5) NOT NULL,
                is_online BOOLEAN DEFAULT false,
                is_busy BOOLEAN DEFAULT false,
                last_free_match_date DATE, -- Günlük ücretsiz eşleşme kontrolü için
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. MATCHES TABLOSU
        await client.query(`
            CREATE TABLE IF NOT EXISTS matches (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
                user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
                duration_seconds INT NOT NULL DEFAULT 0,
                rating INT CHECK (rating >= 1 AND rating <= 5),
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Sık arama yapılan id'lere hız kattık
            CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
            CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
        `);

        // 3. TRANSACTIONS TABLOSU (Ekonomi Günlüğü)
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                amount INT NOT NULL,
                type VARCHAR(20) NOT NULL CHECK (type IN ('purchase', 'spend', 'refund')),
                reason VARCHAR(50) NOT NULL, -- Örn: 'city_filter', 'gift', 'in_app_purchase'
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
        `);

        // 4. REPORTS TABLOSU (Moderasyon)
        await client.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
                reported_id UUID REFERENCES users(id) ON DELETE CASCADE,
                reason VARCHAR(255) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);
        `);

        await client.query('COMMIT'); // İşlemleri onayla
        console.log("✅ Tüm Master Tablolar Başarıyla Kuruldu veya Güncellendi!");

    } catch (err) {
        await client.query('ROLLBACK'); // Hata durumunda hiçbir yarı-işlem bırakma
        console.error("❌ Veritabanı kurulum hatası! Rollback yapıldı:", err);
    } finally {
        client.release();
    }
}

/**
 * DB Entegrasyon Yardımcı Fonksiyonlar (Örnek kullanım)
 */
const UserRepository = {
    // Karma puanına veya bakiyeye direkt safe update atar
    async updateGoldBalance(userId, amount, reason) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Balance'ı güncelle
            const userRes = await client.query(
                'UPDATE users SET gold_balance = gold_balance + $1 WHERE id = $2 RETURNING gold_balance',
                [amount, userId]
            );
            
            // 2. Transaction tablosuna log düş (- ise spend, + ise refund/purchase)
            const type = amount < 0 ? 'spend' : 'refund';
            await client.query(
                'INSERT INTO transactions (user_id, amount, type, reason) VALUES ($1, $2, $3, $4)',
                [userId, Math.abs(amount), type, reason]
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

// Eğer test için tek başına çalıştırılacaksa:
// initDB();
