/**
 * 🚀 PROJECT: OZDER NEXT-GEN
 * Phase 4: Matchmaker Service (Business Logic Layer)
 * 
 * BU KATMAN NE YAPAR?
 * 1. Doğrulama: Kullanıcının VIP olup olmadığını veya yeterli kredisi olup olmadığını kontrol eder.
 * 2. Koordinasyon: MatchmakingEngine (Memory) ile Socket.io arasındaki köprüdür.
 * 3. Redis/Fastify Bağımlılığı: Tamamen temizlendi. Pure JavaScript logic.
 */

const MatchmakingEngine = require('./matchmaking');
const { UserRepository } = require('./database');

const MatchmakerService = {
    /**
     * Eşleşme arayan kullanıcıyı işleme alır
     */
    async handleFindMatch(socket, data, sanitizeString) {
        // Artik veriler istemciden (data) degil, Token'dan (socket.decoded) geliyor.
        const user = socket.decoded;
        console.log(`🔍 [Service] Eşleşme aranıyor... (Kullanıcı maskelendi)`);

        // 1. VIP/Kredi Kontrolü (Sunucu Taraflı - Veritabanı Doğrulaması)
        // Madde 9 Fix: Token verisi eski olabilir, taze veriyi DB'den çekiyoruz
        let dbUser = null;
        try {
            dbUser = await UserRepository.getUserById(user.id);
        } catch (e) {
            console.error("Matchmaker DB Error:", e);
        }
        
        const userGold = dbUser ? dbUser.gold_balance : 100;
        const isVIP = userGold >= 500;

        // 2. Havuzuna Ekle (Manipülasyona kapalı veri seti)
        const matchResult = await MatchmakingEngine.addToQueue({
            socketId: socket.id,
            userId: user.id,
            username: dbUser ? dbUser.username : user.username,
            gender: dbUser ? dbUser.gender : 'unknown',
            region: dbUser ? dbUser.region : 'Global',
            // Madde 6 Fix: Veritabanındaki kalıcı tercihi kullan (Eğer istemci boş gönderirse)
            preference: data.preference || (dbUser ? dbUser.match_preference : 'mixed'), 
            regionFilter: data.regionFilter,
            age: dbUser ? dbUser.age : 18,
            zodiac: dbUser ? dbUser.zodiac : '', // Madde 12 Fix: Zodiac Sync
            isVIP: isVIP
        });

        // 3. Eşleşme Varsa Bildir
        if (matchResult) {
            const { user1, user2 } = matchResult;
            const iceBreaker = "En son ne zaman gerçekten mutlu hissettin?";

            // Madde 21 & 18 Fix: Non-blocking asenkron kayıt (Hata yönetimi dahil)
            UserRepository.recordMatch(user1.userId, user2.userId, 0).catch(e => console.error("🚨 [Service] Eşleşme kaydı hatası:", e.message));

            // User 1'e haber ver (Madde 17 & 96 Fix: oppUsername Sanitization)
            socket.emit('match_found', {
                opponentId: user2.socketId,
                role: 'caller', // Arayan taraf
                iceBreaker,
                oppUsername: sanitizeString(user2.username),
                oppGender: sanitizeString(user2.gender),
                oppRegion: sanitizeString(user2.region),
                oppAge: user2.age,
                oppZodiac: sanitizeString(user2.zodiac || '')
            });

            // User 2'e haber ver (Global IO üzerinden veya socket.to kullanarak)
            // Not: IO nesnesi genellikle server.js'de tanımlıdır. 
            // Bu servis bir callback dönerek server.js'in emit yapmasını sağlayabilir.
            return {
                matched: true,
                targetSocketId: user2.socketId,
                payload: {
                    opponentId: user1.socketId,
                    role: 'callee', // Aranan taraf
                    iceBreaker,
                    oppUsername: sanitizeString(user1.username),
                    oppGender: sanitizeString(user1.gender),
                    oppRegion: sanitizeString(user1.region),
                    oppAge: user1.age,
                    oppZodiac: sanitizeString(user1.zodiac || '')
                }
            };
        }

        return { matched: false };
    },

    /**
     * Bağlantı kesildiğinde havuzdan temizle
     */
    handleDisconnect(socketId) {
        MatchmakingEngine.removeFromQueue(socketId).catch(e => console.error("Redis remove error:", e));
    }
};

module.exports = MatchmakerService;