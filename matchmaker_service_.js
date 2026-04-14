/**
 * 🚀 PROJECT: BLIND ID NEXT-GEN
 * Phase 4: Matchmaker Service (Business Logic Layer)
 * 
 * BU KATMAN NE YAPAR?
 * 1. Doğrulama: Kullanıcının VIP olup olmadığını veya yeterli kredisi olup olmadığını kontrol eder.
 * 2. Koordinasyon: MatchmakingEngine (Memory) ile Socket.io arasındaki köprüdür.
 * 3. Redis/Fastify Bağımlılığı: Tamamen temizlendi. Pure JavaScript logic.
 */

const MatchmakingEngine = require('./matchmaking');

const MatchmakerService = {
    /**
     * Eşleşme arayan kullanıcıyı işleme alır
     */
    async handleFindMatch(socket, data) {
        console.log(`🔍 [Service] Arama isteği: ${socket.id} (Username: ${data.username})`);

        // 1. VIP/Kredi Kontrolü (Mock)
        // PostgreSQL kaldırıldığı için şimdilik client'dan gelen gold verisine veya 
        // localState'e güveniyoruz.
        const userGold = data.gold || 0;
        const isVIP = userGold >= 500;

        // 2. Havuzuna Ekle
        const matchResult = MatchmakingEngine.addToQueue({
            socketId: socket.id,
            userId: data.userId || socket.id,
            username: data.username || 'Anonim',
            gender: data.gender,
            region: data.region,
            preference: data.preference,
            regionFilter: data.regionFilter,
            age: data.age,
            zodiac: data.zodiac,
            isVIP: isVIP
        });

        // 3. Eşleşme Varsa Bildir
        if (matchResult) {
            const { user1, user2 } = matchResult;
            const iceBreaker = "En son ne zaman gerçekten mutlu hissettin?";

            // User 1'e haber ver
            socket.emit('match_found', {
                opponentId: user2.socketId,
                role: 'caller', // Arayan taraf
                iceBreaker,
                oppUsername: user2.username,
                oppGender: user2.gender,
                oppRegion: user2.region,
                oppAge: user2.age,
                oppZodiac: user2.zodiac
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
                    oppUsername: user1.username,
                    oppGender: user1.gender,
                    oppRegion: user1.region,
                    oppAge: user1.age,
                    oppZodiac: user1.zodiac
                }
            };
        }

        return { matched: false };
    },

    /**
     * Bağlantı kesildiğinde havuzdan temizle
     */
    handleDisconnect(socketId) {
        MatchmakingEngine.removeFromQueue(socketId);
    }
};

module.exports = MatchmakerService;
