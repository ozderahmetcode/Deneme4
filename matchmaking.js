/**
 * 🚀 PROJECT: OZDER NEXT-GEN
 * Phase 4: Hybrid Matchmaking Engine (Memory + Redis)
 */

const Redis = require('ioredis');

class MatchmakingEngine {
    constructor() {
        this.waitingPool = []; // Fallback in-memory pool
        this.redis = null;
        this.QUEUE_KEY = 'ozder:matchmaking_queue';
    }

    /**
     * Dışarıdan (server.js) ana Redis bağlantısını enjekte et
     */
    setRedisClient(client) {
        this.redis = client;
        if (this.redis) {
            console.log('🔗 Matchmaking Engine: Ana Redis bağlantısı paylaşıldı.');
        }
    }

    /**
     * Redis komutlarını zaman aşımı ile çalıştıran yardımcı fonksiyon
     */
    async redisCall(command, ...args) {
        if (!this.redis) return null;
        
        return Promise.race([
            this.redis[command](...args),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 2500))
        ]).catch(err => {
            console.error(`🔴 Redis Komut Hatası (${command}):`, err.message);
            return null; // Hata durumunda null dön ki fallback devreye girsin
        });
    }

    /**
     * Kullanıcıyı havuzuna ekle (Async)
     */
    async addToQueue(userData) {
        // Mükerrer kaydı engelle
        await this.removeFromQueue(userData.socketId);
        
        const entry = {
            userId: userData.userId,
            socketId: userData.socketId,
            gender: userData.gender || 'mixed',
            region: userData.region || 'Unknown',
            preference: userData.preference || 'mixed',
            regionFilter: userData.regionFilter || false,
            timestamp: Date.now(),
            age: userData.age,
            username: userData.username,
            zodiac: userData.zodiac
        };

        if (this.redis) {
            const success = await this.redisCall('hset', this.QUEUE_KEY, userData.socketId, JSON.stringify(entry));
            if (success !== null) {
                const size = await this.redisCall('hlen', this.QUEUE_KEY);
                console.log(`📥 [Redis-Havuz] Kullanıcı eklendi. Güncel havuz boyutu: ${size || '?'}`);
            } else {
                // Redis hatası/timeout durumunda memory fallback
                this.waitingPool.push(entry);
                console.log(`📥 [Fallback-Memory] Redis geciktiği için memory'ye eklendi: ${userData.socketId}`);
            }
        } else {
            this.waitingPool.push(entry);
            console.log(`📥 [Memory-Havuz] Kullanıcı eklendi. Güncel havuz boyutu: ${this.waitingPool.length}`);
        }
        
        return await this.tryMatch(entry);
    }

    /**
     * Havuzdan çıkar (Disconnect durumunda)
     */
    async removeFromQueue(socketId) {
        if (this.redis) {
            await this.redisCall('hdel', this.QUEUE_KEY, socketId);
        }
        // Her zaman memory'den de temizle
        this.waitingPool = this.waitingPool.filter(u => u.socketId !== socketId);
    }

    /**
     * Mümkün olan en iyi eşleşmeyi bul
     */
    async tryMatch(currentUser) {
        let pool = [];
        if (this.redis) {
            try {
                const rawPool = await this.redisCall('hgetall', this.QUEUE_KEY);
                if (rawPool) {
                    for (let key in rawPool) {
                        try {
                            pool.push(JSON.parse(rawPool[key]));
                        } catch (e) {
                            console.error(`🔴 Redis kuyruk parse hatası (Key: ${key}):`, e.message);
                            await this.redisCall('hdel', this.QUEUE_KEY, key);
                        }
                    }
                } else {
                    pool = this.waitingPool; // Redis timeout/hata durumunda memory'ye bak
                }
                
                // Sort by timestamp to match oldest first
                pool.sort((a, b) => a.timestamp - b.timestamp);
                console.log(`🧐 [Match-Logic] Havuz tarandı (${pool.length} kullanıcı).`);
            } catch (err) {
                console.error("🔴 Matchmaking Error:", err.message);
                pool = this.waitingPool;
            }
        } else {
            pool = this.waitingPool;
            console.log(`🧐 [Memory-Match] Havuz tarandı (${pool.length} kullanıcı).`);
        }

        if (pool.length < 2) return null;

        let matchedUser = null;

        // Eşleşme Algoritması
        for (let i = 0; i < pool.length; i++) {
            const potentialMatch = pool[i];

            // Kendisiyle eşleşemez
            if (potentialMatch.socketId === currentUser.socketId) continue;

            // Filtre 1: Cinsiyet Uyumu
            const aGender = (currentUser.gender || '').toLowerCase();
            const bGender = (potentialMatch.gender || '').toLowerCase();
            const unknownGenders = ['belirtilmemiş', 'belirtilmemis', 'unknown', ''];
            const eitherUnknown = unknownGenders.includes(aGender) || unknownGenders.includes(bGender);

            const genderOk = eitherUnknown
                || (currentUser.preference === 'mixed' || potentialMatch.preference === 'mixed')
                || (aGender !== bGender);

            // Filtre 2: Bölge Uyumu (Opsiyonel)
            let regionOk = true;
            if (currentUser.regionFilter || potentialMatch.regionFilter) {
                regionOk = (currentUser.region === potentialMatch.region);
            }

            if (genderOk && regionOk) {
                const matchedUser = potentialMatch;
                console.log(`✅ [Match-Success] ${currentUser.socketId} <-> ${matchedUser.socketId} eşleşti!`);

                // Havuzdan ikisini de çıkar
                await this.removeFromQueue(currentUser.socketId);
                await this.removeFromQueue(matchedUser.socketId);

                return {
                    user1: currentUser,
                    user2: matchedUser
                };
            } else {
                console.log(`❌ [Match-Skip] ${potentialMatch.socketId} elendi. Sebepler: GenderOK=${genderOk}, RegionOK=${regionOk} (Genders: ${aGender} vs ${bGender}, Prefs: ${currentUser.preference} vs ${potentialMatch.preference})`);
            }
        }

        return null;
    }

    async getPoolSize() {
        if (this.redis) {
            return await this.redis.hlen(this.QUEUE_KEY);
        }
        return this.waitingPool.length;
    }
}

module.exports = new MatchmakingEngine();