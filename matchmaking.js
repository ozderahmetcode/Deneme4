/**
 * 🚀 PROJECT: BLIND ID NEXT-GEN
 * Phase 1: High-Performance Redis Matchmaking Algorithm
 *
 * NEDEN BU YOLU SEÇTİK? (Genel Mimari Kararları)
 * 1. Fastify Kullanımı: Express.js'e göre istek başına maliyet (overhead) çok daha azdır. Sinyal işlemede (matchmaking) nanisaniye bile önemli olduğu için seçildi.
 * 2. Redis Sorted Sets (ZADD/ZRANGE): Standart List (LPOP/RPUSH) yerine niye Sorted Set kullandık? Çünkü kullanıcıları "kuyruğa girme milisaniyesine" (Timestamp) göre puanlıyoruz (Score). Bu sayede en çok bekleyen kişiyi (en düşük score) ZPOPMIN ile O(log(N)) hızında, tamamen hakkaniyetli şekilde çekebiliriz.
 * 3. Altın Blokajı: Altını direkt çekmiyoruz. Kullanıcının altınını bir "pending" (bloke) duruma alıyoruz ki eğer 30 saniye içinde iptal veya başarısızlık olursa tek işlemde iade edebilelim (Race condition'ı engeller).
 */

const fastify = require('fastify')({ logger: false });
const { createClient } = require('redis');

// Redis İstemcisi
const redis = createClient({ url: 'redis://localhost:6379' });
redis.on('error', (err) => console.error('Redis Error', err));

// --- MOCK DATABASE TABLOLARI (Blueprint standardında) ---
const DB = {
    Users: {
        "user_1": { id: "user_1", username: "NightOwl", gold_balance: 50, karma_score: 90, daily_free_used: false, is_online: true, is_busy: false },
        "user_2": { id: "user_2", username: "Traveler", gold_balance: 5, karma_score: 100, daily_free_used: false, is_online: true, is_busy: false }
    },
    async getUser(id) { return this.Users[id]; },
    async blockGold(id, amount) {
        if(this.Users[id].gold_balance >= amount) {
            this.Users[id].gold_balance -= amount; // Bloke edildi varsayalım
            return true;
        }
        return false;
    },
    async refundGold(id, amount) { this.Users[id].gold_balance += amount; }
};

// Aktif timeoutları takip eden harita (Ghost kuyrukları engellemek için)
const timeoutTasks = new Map();

/**
 * 🎯 ANA MATCHMAKING FONKSİYONU
 */
async function processMatchmaking(userId, cityId, socket) {
    try {
        const user = await DB.getUser(userId);

        // -- GÜVENLİK ve TPS KONTROLÜ --
        if (!user || !user.is_online || user.is_busy) {
            return socket.emit('error', { msg: "Bağlantı geçersiz veya zaten bir görüşmedesiniz." });
        }
        if (user.karma_score < 50) {
            // Blueprint'teki karma koruması: düşük karmalılar sadece kendileriyle (farklı bir kuyruk prefix'i) eşleşir
            cityId = "TROP_POOL"; 
        }

        // -- ALTIN EKONOMİSİ VE ŞEHİR FİLTRESİ --
        let goldBlocked = false;   
        if (cityId !== "ALL" && cityId !== "TROP_POOL") { // Spesifik bir filtre istiyor
            if (!user.daily_free_used) {
                user.daily_free_used = true;
                socket.emit('info', { msg: "Günlük ücretsiz şehir eşleşme hakkınızı kullandınız!" });
            } else {
                // Altın kontrol ve blokaj
                const hasGold = await DB.blockGold(userId, 10);
                if (!hasGold) {
                    return socket.emit('error', { msg: "Yeterli altınınız yok! Özel şehir seçimi 10 Altındır." });
                }
                goldBlocked = true;
            }
        }

        // -- REDIS SORTED SET İLE EŞLEŞTİRME (TIME-BASED FAIR MATCHING) --
        const queueKey = `match_q:city:${cityId}`;

        // Neden ZPOPMIN? -> O şehirdeki kuyruğa 'en önce' (en düşük timestamp) girmiş, bekleyen kişiyi atomik olarak çekip siler. Böylece 2 kişi aynı anda arama yapsa bile race condition olmaz!
        const matchedData = await redis.zPopMin(queueKey);

        if (matchedData && matchedData.length > 0) {
            // EŞLEŞME BULUNDU!
            const matchedUserId = matchedData[0].value;
            
            // Eğer eşleşilen kişinin bir timeout (30sn) beklemesi varsa onu temizle
            if(timeoutTasks.has(matchedUserId)) {
                clearTimeout(timeoutTasks.get(matchedUserId));
                timeoutTasks.delete(matchedUserId);
            }

            // Statüleri Busy yap
            user.is_busy = true;
            await DB.getUser(matchedUserId).then(u => u.is_busy = true);

            console.log(`✅ MATCH SUCCESS: ${userId} ile ${matchedUserId} (CITY: ${cityId}) eşleşti.`);
            
            // Gerçek projede Ice Breaker veritabanından rastgele bir soru gönderilir
            const iceBreaker = "En son hangi filmde ağladın?";

            socket.emit('match_found', { opponentId: matchedUserId, iceBreaker });
            // Not: İdeal dünyada diğer eşleşene de socket id si üzerinden emit atılır
            return;
        }

        // ÖNCEKİ KİMSE YOK: KULLANICIYI KUYRUĞA EKLE
        // Neden ZADD? -> Kullanıcının id'sini key, girdiği süreyi (Date.now()) score olarak veriyoruz. FIFO (First In First Out) tamamen sorunsuz işliyor.
        await redis.zAdd(queueKey, { score: Date.now(), value: userId });
        console.log(`⏳ ARANIYOR... ${userId} ==> ${queueKey} (Score: ${Date.now()})`);
        socket.emit('searching', { msg: "Bölgenizdeki kişiler taranıyor..." });

        // -- 30 SANİYE ZAMAN AŞIMI (TIMEOUT) MANTIĞI --
        // Belirtilen kural: 30 saniye içinde eşleşme olmazsa altını iade et ve "Genel Havuz" teklifi sun.
        const tObj = setTimeout(async () => {
            // Kuyruktan çıkar (ZREM ile tam nokta atışı)
            await redis.zRem(queueKey, userId);
            timeoutTasks.delete(userId);

            console.log(`❌ TIMEOUT: ${userId} için 30 sn doldu.`);

            if (goldBlocked) {
                await DB.refundGold(userId, 10); // İade
                socket.emit('timeout', { msg: "Eşleşme bulunamadı. 10 Altınınız iade edildi. Genel havuza (şehirsiz) geçmek ister misiniz?" });
            } else {
                socket.emit('timeout', { msg: "Bölgenizde aktif kimse yok, genel havuza geçmek ister misiniz?" });
            }
        }, 30000);

        timeoutTasks.set(userId, tObj);

    } catch (err) {
        console.error(`Matchmaking Hatası (${userId}):`, err);
        socket.emit('error', { msg: "Sistemsel bir hata oluştu." });
    }
}

// FASTIFY SERVER BAŞLATMA
fastify.get('/ping', async (request, reply) => {
    return { status: "Matchmaking Service Okey" };
});

const startServer = async () => {
    try {
        await redis.connect();
        console.log("🟢 Redis Bağlantısı Kuruldu (Master Blueprint Standardı)");
        
        await fastify.listen({ port: 3000 });
        console.log("🚀 Fastify Server localhost:3000 üzerinde dinleniyor...");

        // -------- SENARYO TESTİ ---------
        // User 1 (İstanbul - Altın Bloke Testi)
        const mockSocket = { emit: (ev, d) => console.log(`  [SOCKET] --> ${ev}:`, d) };
        await processMatchmaking("user_1", "34", mockSocket);
        
        // 2 saniye sonra User 2 geliyor ve eşleşiyor
        setTimeout(async () => {
             await processMatchmaking("user_2", "34", mockSocket);
        }, 2000);

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// startServer();
module.exports = { processMatchmaking, startServer };
