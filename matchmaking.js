/**
 * 🚀 PROJECT: OZDER NEXT-GEN
 * Phase 4: Hybrid Matchmaking Engine (Memory + Redis)
 */

const Redis = require('ioredis');

class MatchmakingEngine {
    constructor() {
        this.waitingPool = []; // Fallback in-memory pool
        const redisUrl = process.env.UPSTASH_REDIS_URL;
        this.redis = redisUrl ? new Redis(redisUrl) : null;
        this.QUEUE_KEY = 'ozder:matchmaking_queue';
        
        if (this.redis) {
            console.log('🔗 Matchmaking Engine Redis modunda çalışıyor.');
            this.redis.on('error', (err) => console.error('🔴 Matchmaking Redis Hatası:', err.message));
        }
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
            await this.redis.hset(this.QUEUE_KEY, userData.socketId, JSON.stringify(entry));
        } else {
            this.waitingPool.push(entry);
        }
        
        console.log(`📥 [Havuz] Bir kullanıcı eklendi: ${userData.socketId}`);
        return await this.tryMatch(entry);
    }

    /**
     * Havuzdan çıkar (Disconnect durumunda)
     */
    async removeFromQueue(socketId) {
        if (this.redis) {
            await this.redis.hdel(this.QUEUE_KEY, socketId);
        } else {
            this.waitingPool = this.waitingPool.filter(u => u.socketId !== socketId);
        }
    }

    /**
     * Mümkün olan en iyi eşleşmeyi bul
     */
    async tryMatch(currentUser) {
        let pool = [];
        if (this.redis) {
            const rawPool = await this.redis.hgetall(this.QUEUE_KEY);
            for (let key in rawPool) {
                pool.push(JSON.parse(rawPool[key]));
            }
            // Sort by timestamp to match oldest first
            pool.sort((a, b) => a.timestamp - b.timestamp);
        } else {
            pool = this.waitingPool;
        }

        if (pool.length < 2) return null;

        let matchedUser = null;

        // Eşleşme Algoritması
        for (let i = 0; i < pool.length; i++) {
            const potentialMatch = pool[i];

            // Kendisiyle eşleşemez
            if (potentialMatch.socketId === currentUser.socketId) continue;

            const aGender = (currentUser.gender || '').toLowerCase();
            const bGender = (potentialMatch.gender || '').toLowerCase();
            const unknownGenders = ['belirtilmemiş', 'belirtilmemis', 'unknown', ''];
            const eitherUnknown = unknownGenders.includes(aGender) || unknownGenders.includes(bGender);

            const genderOk = eitherUnknown
                || (currentUser.preference === 'mixed' || potentialMatch.preference === 'mixed')
                || (aGender !== bGender);

            let regionOk = true;
            if (currentUser.regionFilter && potentialMatch.regionFilter) {
                regionOk = (currentUser.region === potentialMatch.region);
            }

            if (genderOk && regionOk) {
                matchedUser = potentialMatch;
                break;
            }
        }

        if (matchedUser) {
            await this.removeFromQueue(currentUser.socketId);
            await this.removeFromQueue(matchedUser.socketId);
            
            console.log(`✅ [Match] Eşleşme sağlandı: ${currentUser.socketId} <-> ${matchedUser.socketId}`);
            return {
                user1: currentUser,
                user2: matchedUser
            };
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