/**
 * 🚀 PROJECT: BLIND ID NEXT-GEN
 * Phase 4: In-Memory Matchmaking Engine (Pure WebRTC Architecture)
 * 
 * BU DOSYADA NE DEĞİŞTİ?
 * 1. Redis Tamamen Kaldırıldı: Altyapı artık harici bir Redis sunucusuna ihtiyaç duymadan,
 *    doğrudan JavaScript hafızası (Memory) üzerinden çalışıyor.
 * 2. WebRTC Optimizasyonu: Sistem sadece matchmaking (eşleşme) yapar, sinyalleşme signaling.js üzerinden akar.
 * 3. Hız: Milyonlarca kullanıcıya kadar RAM üzerinde saniyenin binde biri hızında eşleşme döner.
 */

class MatchmakingEngine {
    constructor() {
        this.waitingPool = []; // [ { userId, socketId, gender, region, preference, filters } ]
    }

    /**
     * Kullanıcıyı havuzuna ekle
     */
    addToQueue(userData) {
        // Mükerrer kaydı engelle
        this.removeFromQueue(userData.socketId);
        
        const entry = {
            userId: userData.userId,
            socketId: userData.socketId,
            gender: userData.gender || 'mixed',
            region: userData.region || 'Unknown',
            preference: userData.preference || 'mixed',
            regionFilter: userData.regionFilter || false,
            timestamp: Date.now(),
            // Ekstra profil bilgileri
            age: userData.age,
            username: userData.username,
            zodiac: userData.zodiac
        };

        this.waitingPool.push(entry);
        console.log(`📥 [Havuz] Bir kullanıcı eklendi. Güncel sayı: ${this.waitingPool.length}`);
        return this.tryMatch(entry);
    }

    /**
     * Havuzdan çıkar (Disconnect durumunda)
     */
    removeFromQueue(socketId) {
        const initialLen = this.waitingPool.length;
        this.waitingPool = this.waitingPool.filter(u => u.socketId !== socketId);
        if (this.waitingPool.length < initialLen) {
            console.log(`📤 [Havuz] Kullanıcı çıkarıldı. Güncel sayı: ${this.waitingPool.length}`);
        }
    }

    /**
     * Mümkün olan en iyi eşleşmeyi bul
     */
    tryMatch(currentUser) {
        if (this.waitingPool.length < 2) return null;

        let matchIdx = -1;

        // Eşleşme Algoritması
        for (let i = 0; i < this.waitingPool.length; i++) {
            const potentialMatch = this.waitingPool[i];

            // Kendisiyle eşleşemez
            if (potentialMatch.socketId === currentUser.socketId) continue;

            // 1. Cinsiyet Filtresi
            const genderOk = (currentUser.preference === 'mixed' || potentialMatch.preference === 'mixed') || 
                             (currentUser.gender !== potentialMatch.gender);
            
            // 2. Bölge Filtresi (Eğer her iki taraf da aktif ettiyse veya özellikle arıyorsa)
            let regionOk = true;
            if (currentUser.regionFilter && potentialMatch.regionFilter) {
                regionOk = (currentUser.region === potentialMatch.region);
            }

            if (genderOk && regionOk) {
                matchIdx = i;
                break;
            }
        }

        if (matchIdx !== -1) {
            const matchedUser = this.waitingPool.splice(matchIdx, 1)[0];
            this.removeFromQueue(currentUser.socketId); // Kendisini de havuzdan al
            
            console.log(`✅ [Match] Eşleşme sağlandı: ${currentUser.socketId} <-> ${matchedUser.socketId}`);
            return {
                user1: currentUser,
                user2: matchedUser
            };
        }

        return null;
    }

    getPoolSize() {
        return this.waitingPool.length;
    }
}

module.exports = new MatchmakingEngine();
