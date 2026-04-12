/**
 * BLIND ID CLONE - BACKEND MATCHMAKING SERVICE
 * Tech Stack: Node.js, WebSockets (Socket.io), Redis, Mock-PostgreSQL
 * Description: Şehir bazlı ve yüksek performanslı karmaşık eşleşme algoritması.
 */

const { createClient } = require('redis');
// const { Pool } = require('pg'); // PostgreSQL client (mocked for this script)

// --- MOCK DATABASE (PostgreSQL Simülasyonu) ---
const MockDB = {
    users: {
        "user_1": { id: "user_1", gold: 120, freeRegionUsed: false, karma: 100 },
        "user_2": { id: "user_2", gold: 10, freeRegionUsed: true, karma: 90 }
    },
    async getUser(userId) {
        return this.users[userId] || null;
    },
    async updateGold(userId, amount) {
        if(this.users[userId]) {
            this.users[userId].gold += amount;
            return true;
        }
        return false;
    },
    async useFreeMatch(userId) {
        if(this.users[userId] && !this.users[userId].freeRegionUsed) {
            this.users[userId].freeRegionUsed = true;
            return true;
        }
        return false;
    }
};

class MatchmakerService {
    constructor() {
        // Gerçek bir senaryoda REDIS_URL environment variable'dan alınır.
        this.redis = createClient({ url: 'redis://localhost:6379' });
        this.redis.on('error', (err) => console.error('Redis Client Error', err));
        
        // Zaman aşımı (Timeout) takibi için local map
        this.activeQueues = new Map();
    }

    async init() {
        await this.redis.connect();
        console.log("🔥 Redis Matchmaking DB Bağlantısı Başarılı");
    }

    /**
     * Kullanıcının eşleşme kuyruğuna alınması ve Gold/Free mantığının yönetimi.
     * @param {string} userId - İstek atan kullanıcı IDs 
     * @param {string} targetCity - Filtrelenen şehir kodu (ör: "34" veya "istanbul")
     * @param {string} targetGender - Aranan cinsiyet (ör: "K", "E", "ALL")
     * @param {object} socket - Socket.io socket objesi (geriye dönüş ve haberleşme için)
     */
    async findCityMatch(userId, targetCity, targetGender, socket) {
        try {
            // 1. Kullanıcı Verisini Çek & Yetki Kontrolü
            const user = await MockDB.getUser(userId);
            if (!user) throw new Error("Kullanıcı bulunamadı");
            if (user.karma < 50) {
                // Karma düşükse cezalı havuza (Trolls Queue) yönlendir.
                targetCity = "low_karma_pool"; 
                console.log(`Uyarı: ${userId} TROLL havuzuna yönlendirildi! (Karma: ${user.karma})`);
            }

            // 2. Altın veya Ücretsiz Hak Kontrolü (Sadece şehir filtreliyorsa)
            let usedGold = false;
            if (targetCity !== "ALL" && targetCity !== "low_karma_pool") {
                const usedFree = await MockDB.useFreeMatch(userId);
                if (!usedFree) {
                    if (user.gold >= 10) {
                        await MockDB.updateGold(userId, -10);
                        usedGold = true;
                    } else {
                        socket.emit('match_error', { message: "Yetersiz bakiye! Bölge seçimi için 10 Altın gereklidir."});
                        return;
                    }
                }
            }

            // 3. Eşleşme Kuyruğu (Redis Key)
            const queueKey = `waiting_pool:${targetCity}:${targetGender}`;
            
            // 4. Kuyrukta bekleyen var mı diye kontrol et (LPOP -> O(1) Time Complexity, extreme fast)
            const matchedUserId = await this.redis.lPop(queueKey);

            if (matchedUserId) {
                // Eşleşme BULUNDU!
                // Not: Eşleşen kişiyi zaman aşımı listesinden silmeliyiz.
                this._clearQueueTimeout(matchedUserId);

                console.log(`✅ EŞLEŞME BAŞARILI: ${userId} <---> ${matchedUserId} (Şehir: ${targetCity})`);
                
                // İki kullanıcıya da sinyal gönder (WebRTC sinyalleşme başlat)
                socket.emit('match_found', { matchId: matchedUserId, city: targetCity });
                // Karşı tarafın socket'ine erişim için Redis Pub/Sub veya Socket.io Rooms kullanılır.
                return;
            }

            // 5. Eşleşme BULUNAMADI, Kullanıcıyı Kuyruğa Ekle (RPUSH -> O(1))
            await this.redis.rPush(queueKey, userId);
            console.log(`⏳ Eşleşme aranıyor... ${userId} ==> [${queueKey}] kuyruğunda`);
            socket.emit('in_queue', { message: "Bölgendeki kişiler aranıyor..." });

            // 6. Zaman Aşımı (Timeout) ve İptal Mantığı - 30 Saniye
            const timeoutId = setTimeout(async () => {
                // Kuyruktan çıkar (LREM -> Karmaşık LPOP yerine spesifik user silme)
                await this.redis.lRem(queueKey, 0, userId);
                this.activeQueues.delete(userId);
                
                console.log(`❌ TIMEOUT: ${userId} için 30 saniyede eşleşme bulunamadı.`);

                // Altın iadesi yap (eğer kullandıysa)
                if (usedGold) {
                    await MockDB.updateGold(userId, 10);
                    socket.emit('timeout', { message: "Kimse bulunamadı. Genel havuza geçiliyor, 10 Altın iade edildi." });
                } else {
                    socket.emit('timeout', { message: "Kimse bulunamadı. Genel havuza geçmek ister misin?" });
                }

            }, 30000); // 30 saniye
            
            this.activeQueues.set(userId, timeoutId);

        } catch (error) {
            console.error(`Matchmaking Hata (${userId}):`, error.message);
            socket.emit('match_error', { message: "Eşleşme sunucusunda teknik bir hata oluştu." });
        }
    }

    /**
     * Bekleme durumundan iptal olanların loglarını temizlemek için yardımcı
     */
    _clearQueueTimeout(userId) {
        if (this.activeQueues.has(userId)) {
            clearTimeout(this.activeQueues.get(userId));
            this.activeQueues.delete(userId);
        }
    }
}

// Servis Başlatma Örneği
async function runServer() {
    const mm = new MatchmakerService();
    // const io = require('socket.io')(3000); // Gerçek server ayağa kaldırmak için
    
    // Test Mock socket objesi
    const mockSocketUser1 = { emit: (event, data) => console.log(`[Socket -> User1] ${event}:`, data) };
    const mockSocketUser2 = { emit: (event, data) => console.log(`[Socket -> User2] ${event}:`, data) };

    // Redis connect atlaması (Sistemde redis kurulu değilse hata fırlatmasın diye yorum satırı yapıldı)
    // await mm.init(); 

    console.log("------- TEST SENARYOSU -------");
    
    // Bakiye 120 olan user_1 istanbul(34) seçiyor (10 Altın düşecek)
    await mm.findCityMatch("user_1", "34", "ALL", mockSocketUser1);

    // Kısa süre sonra User_2 de istanbul (34) için filtre atıyor ve eşleşiyorlar!
    setTimeout(async () => {
        await mm.findCityMatch("user_2", "34", "ALL", mockSocketUser2);
    }, 2000);
}

// Dosyayı terminalden direkt çalıştırmak istersen:
// runServer();

module.exports = MatchmakerService;
