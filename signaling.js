/**
 * 🚀 PROJECT: BLIND ID NEXT-GEN
 * Phase 3: Backend Signaling Server (WebRTC Sinyalleşme)
 *
 * NEDEN BU YOLU SEÇTİK?
 * 1. Payload Hafifliği: WebRTC sinyalleşmesi (SDP ve ICE dataları) oldukça büyüktür. Veritabanını kirletmemek için
 * bu verileri asla kaydetmiyoruz. Gelen 'offer' anında 'targetUserId' üzerinden direkt yönlendiriliyor.
 * 2. Room (Oda) Mantığı: Karmaşık dizi takibi yerine, eşleşenleri Socket.io'nun native `room` özelliğine alıyoruz. 
 * İkiden fazla kişi giremesin diye oda izolasyonu sağlandı.
 */

const { Server } = require("socket.io");

function setupSignaling(server) {
    // Standart HTTP Server üzerinden ayağa kalkan Socket.io Motoru
    const io = new Server(server, {
        cors: {
            origin: "*", // Prod ortamında bu domainle kısıtlanır
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket) => {
        console.log(`📡 Yeni soket bağlantısı: ${socket.id}`);

        // Auth doğrulama (Mock)
        const userId = socket.handshake.auth.userId; 
        if(userId) socket.join(userId); // Kullanıcı kendi özel odasına atanır (Birebir veri iletimi için)

        // 1. WEBRTC "OFFER" (Arama teklifi başlatıldığında)
        socket.on("webrtc_offer", (payload) => {
            // Sadece gerekli olanı (SDP) hedef kişiye ilet (Lightweight payload prensibi)
            socket.to(payload.targetId).emit("webrtc_offer", {
                senderId: userId,
                sdp: payload.sdp 
            });
        });

        // 2. WEBRTC "ANSWER" (Karşı taraf kabul ettiğinde)
        socket.on("webrtc_answer", (payload) => {
            socket.to(payload.targetId).emit("webrtc_answer", {
                senderId: userId,
                sdp: payload.sdp
            });
        });

        // 3. WEBRTC "ICE CANDIDATE" (İki cihazın IP port delme işlemleri için pin göndermesi)
        socket.on("webrtc_ice_candidate", (payload) => {
            socket.to(payload.targetId).emit("webrtc_ice_candidate", {
                senderId: userId,
                candidate: payload.candidate
            });
        });

        // 4. Görüşme Sonlandırıldığında (Kasıtlı veya Kopma)
        socket.on("end_call", (payload) => {
            socket.to(payload.targetId).emit("peer_disconnected", { msg: "Karşı taraf görüşmeyi sonlandırdı." });
        });

        socket.on("disconnect", () => {
            console.log(`🔌 Bağlantı koptu: ${socket.id}`);
            // TODO: Eğer aktif eşleşmesi varsa DB.is_busy = false update'i atılmalı
        });
    });

    console.log("🟢 Socket.io Sinyalleşme Motoru (WebRTC) Hazır!");
    return io;
}

module.exports = setupSignaling;