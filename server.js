const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');

// Para Kazandırıcı Modül Entegrasyonu
const { UserRepository, pool, initDB } = require('./database');
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('./'));

// Veritabanını Başlat (Tabloları kontrol et/oluştur)
initDB().then(() => {
    console.log("🗄️ Veritabanı bağlantısı ve tablolar hazır.");
}).catch(err => {
    console.error("❌ Veritabanı başlatma hatası:", err);
});

// ==================== ROOM DEFINITIONS ====================
const roomDefs = {
    // VIP Rooms (gold >= 500 required)
    'vip_elmas':      { name: '💎 Elmas Salon',       cap: 10, vip: true },
    'vip_sampanya':   { name: '🥂 Şampanya Kulübü',   cap: 5,  vip: true },
    'vip_centilmen':  { name: '🎩 Centilmen Odası',    cap: 5,  vip: true },
    'vip_sohbet':     { name: '👑 VIP Sohbet',         cap: 5,  vip: true },
    'vip_yildiz':     { name: '🌟 Yıldız Odası',       cap: 4,  vip: true },
    'vip_galaksi':    { name: '💫 Galaksi',             cap: 4,  vip: true },
    'vip_trident':    { name: '🔱 Trident',             cap: 4,  vip: true },
    'vip_sampiyon':   { name: '🏆 Şampiyonlar',         cap: 3,  vip: true },
    'vip_mor':        { name: '💜 Mor Oda',              cap: 3,  vip: true },
    'vip_gul':        { name: '🌹 Gül Bahçesi',         cap: 3,  vip: true },
    'vip_altin':      { name: '📀 Altın Plak',          cap: 2,  vip: true },
    'vip_zirve':      { name: '🏔️ Zirve Lounge',        cap: 4,  vip: true },
    'vip_exclusive':  { name: '🕴️ Exclusive',           cap: 2,  vip: true },
    'vip_secret':     { name: '🤫 Gizli Oda',           cap: 2,  vip: true },
    'vip_private':    { name: '🔒 Özel Süit',           cap: 2,  vip: true },
    'vip_penthouse':  { name: '🏢 Penthouse',           cap: 6,  vip: true },
    'vip_yacht':      { name: '🛥️ Yat Kulübü',          cap: 6,  vip: true },
    'vip_royal':      { name: '⚜️ Royal Hall',           cap: 8,  vip: true },
    'vip_emerald':    { name: '💚 Emerald Lounge',      cap: 4,  vip: true },
    'vip_ruby':       { name: '❤️ Ruby Club',           cap: 4,  vip: true },
    'vip_ikili_a':    { name: '💕 İkili Sohbet A',       cap: 2,  vip: true },
    'vip_ikili_b':    { name: '🤝 İkili Sohbet B',       cap: 2,  vip: true },

    // Normal Rooms (everyone)
    'gece_kuslari':   { name: '🌙 Gece Kuşları',        cap: 10, vip: false },
    'rap_hiphop':     { name: '🎤 Rap & HipHop',        cap: 10, vip: false },
    'kahve':          { name: '☕ Kahve Molası',         cap: 10, vip: false },
    'muzik':          { name: '🎵 Müzik Severler',       cap: 10, vip: false },
    'spor':           { name: '⚽ Spor Kulübü',          cap: 10, vip: false },
    'kitap':          { name: '📚 Kitap Kurdu',          cap: 10, vip: false },
    'film':           { name: '🎬 Film & Dizi',          cap: 10, vip: false },
    'gezi':           { name: '🌍 Gezi & Seyahat',       cap: 10, vip: false },
    'oyuncular':      { name: '🎮 Oyuncular',            cap: 10, vip: false },
    'teknoloji':      { name: '💻 Tekno Sohbet',        cap: 10, vip: false },
    'sanat':          { name: '🎨 Sanat Galerisi',       cap: 10, vip: false },
    'gurme':          { name: '🍔 Gurme Paylaşımlar',    cap: 10, vip: false },
    'psikoloji':      { name: '🧠 Psikoloji & Yaşam',    cap: 10, vip: false },
    'serbest':        { name: '💬 Serbest Sohbet',       cap: 10, vip: false },
    'genel_sohbet':   { name: '👥 Genel Sohbet',         cap: 30, vip: false },

    // Radios
    'radio_joy':      { name: '📻 Joy FM',               cap: 50, vip: false, radio: true, stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_FM_ITUNES.mp3' },
    'radio_joy_turk': { name: '📻 Joy Türk',              cap: 50, vip: false, radio: true, stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_ITUNES.mp3' },
    'radio_metro':    { name: '📻 Metro FM',             cap: 50, vip: false, radio: true, stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM.mp3' },
    'radio_capital':  { name: '📻 Capital FM (Global)',  cap: 50, vip: false, radio: true, stream: 'https://ice-sov.musicradio.com/CapitalMP3' }
};

// Initialize room user arrays
const rooms = {};
for (const id in roomDefs) rooms[id] = [];

// ==================== MATCHING POOLS ====================
// Gender-aware pool: { socketId, gender, region, preference }
let waitingPool = [];

// Monetization: Active Call Tracking (Gold per minute)
const activeCalls = new Map(); // key: socketId (caller), value: { targetId, intervalId, startTime }

function startCallBilling(callerSocket, targetId, callerId_db) {
    if (activeCalls.has(callerSocket.id)) return;

    const intervalId = setInterval(async () => {
        try {
            const cost = 10; // 10 Gold per minute
            const newBalance = await UserRepository.updateGoldBalance(callerId_db, -cost, 'call_per_minute');
            
            if (newBalance < cost) {
                // Bakiye bitti, aramayı sonlandır
                io.to(callerSocket.id).emit('insufficient_funds_stop', { msg: "Bakiyeniz bitti! Görüşme sonlandırılıyor." });
                io.to(targetId).emit('peer_disconnected', { msg: "Karşı tarafın bakiyesi bitti." });
                stopCallBilling(callerSocket.id);
            } else {
                callerSocket.emit('balance_update', { newBalance });
            }
        } catch (err) {
            console.error("Billing Error:", err);
            stopCallBilling(callerSocket.id);
        }
    }, 60000); // Her 60 saniyede bir

    activeCalls.set(callerSocket.id, { targetId, intervalId, startTime: Date.now() });
}

function stopCallBilling(socketId) {
    if (activeCalls.has(socketId)) {
        clearInterval(activeCalls.get(socketId).intervalId);
        activeCalls.delete(socketId);
    }
}

// Game pools (Restored)
const gameWaitingPools = { 'xox': null, 'tetris': null };
const activeGameCounts = { 'xox': 0, 'tetris': 0 };

// ==================== SOCKET LOGIC ====================
io.on('connection', (socket) => {
    console.log('📱 Bağlandı:', socket.id);

    // --- SMART MATCHING ---
    socket.on('get_rooms_info', () => {
        socket.emit('receive_rooms_info', getRoomsData());
    });

    socket.on('get_games_info', () => {
        socket.emit('games_info_update', getGamesData());
    });

    // Initial Push to newly connected user only
    socket.emit('receive_rooms_info', getRoomsData());
    socket.emit('games_info_update', getGamesData());
    socket.on('find_match', async (data) => {
        // data: { gender, region, preference, targetCity, ageRange, userId_db, isVip, karma, username, avatarUrl }
        const { userId_db, isVip, karma, username, avatarUrl, ageRange, targetCity } = data;
        const myGender = data.gender || 'erkek';
        const myRegion = data.region || 'Bilinmiyor';
        const pref = data.preference || 'opposite';

        console.log(`⏳ Arama: ${username} (VIP:${isVip}, Karma:${karma}) [Local Engine]`);

        // 1. Temizlik: Kullanıcı zaten kuyruktaysa çıkar
        waitingPool = waitingPool.filter(w => w.socketId !== socket.id);

        // 2. Troll Pool Control
        if (karma < 50) {
            // Troller sadece diğer trollerle eşleşebilir (Simulated here by prefixing city)
            data.isTroll = true;
        }

        // 3. Matchmaking Engine (Local Memory Scan - Diagnostic Mode)
        console.log(`🔍 Eşleşme Aranıyor: ${username} | Bölge: ${myRegion} | VIP: ${isVip} | Tercih: ${pref}`);
        
        let matchIdx = -1;
        
        for (let i = 0; i < waitingPool.length; i++) {
            const w = waitingPool[i];
            
            // 1. Temel Kontroller
            if (w.socketId === socket.id) continue;
            // if (data.isTroll !== w.isTroll) continue; // Troll kısıtlamasını şimdilik kaldırdık

            // 2. Cinsiyet & Tercih Uyumlu mu?
            let genderOk = false;
            
            if (pref === 'mixed' || w.preference === 'mixed') {
                genderOk = true;
            } else {
                const iMatchHim = (pref === w.gender);
                const heMatchesMe = (w.preference === myGender);
                if (iMatchHim && heMatchesMe) genderOk = true;
            }

            if (!genderOk) {
                console.log(`   - ❌ Cinsiyet/Tercih uyuşmuyor: ${w.username}`);
                continue;
            }

            // 3. Bölge & VIP Filtreleri
            let regionOk = (myRegion === w.region);
            // VIP şehir tercihlerini şimdilik "tercih" seviyesinde tutuyoruz
            /*
            if (isVip && targetCity && targetCity !== "ALL" && w.region !== targetCity) regionOk = false;
            if (w.isVip && w.targetCity && w.targetCity !== "ALL" && myRegion !== w.targetCity) regionOk = false;
            */

            if (!regionOk) {
                console.log(`   - ⏳ Bölge uyumsuz (Faz 1 skipped): ${w.username}`);
                continue;
            }

            matchIdx = i;
            break;
        }

        // Phase 2: Kısıtlamaları Kaldır (Catch-All)
        if (matchIdx < 0) {
            console.log(`🔄 Faz 2: Kısıtlamalar kaldırılıyor (Catch-All). Havuzdaki kişi sayısı: ${waitingPool.length}`);
            for (let i = 0; i < waitingPool.length; i++) {
                const w = waitingPool[i];
                if (w.socketId === socket.id) continue;
                
                // Faz 2'de bekleyen ilk kişi ile eşleşmeyi zorla
                console.log(`🎯 Faz 2 eşleşmesi bulundu: ${w.username}`);
                matchIdx = i;
                break;
            }
        }


        if (matchIdx >= 0) {
            const oppData = waitingPool.splice(matchIdx, 1)[0];
            const iceBreaker = "Aklına gelen ilk şeyi söyle!";

            // EŞLEŞME BİLDİRİMİ
            io.to(socket.id).emit('match_found', {
                opponentId: oppData.socketId, iceBreaker, role: 'caller',
                oppUsername: oppData.username, oppAvatar: oppData.avatarUrl,
                oppId_db: oppData.userId_db,
                oppRegion: oppData.region
            });
            io.to(oppData.socketId).emit('match_found', {
                opponentId: socket.id, iceBreaker, role: 'callee',
                oppUsername: username, oppAvatar: avatarUrl,
                oppId_db: userId_db,
                oppRegion: myRegion
            });
            
            console.log(`🎉 MATCH SUCCESS: ${username} <-> ${oppData.username}`);
        } else {
            // KUYRUĞA EKLE
            const payload = {
                socketId: socket.id, userId_db, username, avatarUrl, 
                gender: myGender, region: myRegion, isVip: isVip,
                isTroll: data.isTroll || false, preference: pref,
                targetCity: targetCity || "ALL", ageRange: ageRange || "ALL",
                timestamp: Date.now()
            };

            if (isVip) waitingPool.unshift(payload);
            else waitingPool.push(payload);
            
            socket.emit('searching', { 
                msg: "Kuyrukta bekleyenler arasında taranıyor...", 
                poolCount: waitingPool.length 
            });
            console.log(`➕ Kuyruğa Eklendi: ${username} (Toplam: ${waitingPool.length})`);
        }
    });

    socket.on('cancel_match', () => {
        const initialLen = waitingPool.length;
        waitingPool = waitingPool.filter(w => w.socketId !== socket.id);
        if (waitingPool.length < initialLen) {
            console.log(`➖ Kuyruktan Çıktı: ${socket.id} (Kalan: ${waitingPool.length})`);
        }
    });

    // --- MONETIZATION: BILLING TRIGGERS ---
    socket.on('call_confirmed', (data) => {
        // data: { targetId, userId_db }
        console.log(`✅ Arama Onaylandı: ${socket.id} (Billing Başlıyor)`);
        startCallBilling(socket, data.targetId, data.userId_db);
    });

    // --- GAME MATCHMAKING ---
    socket.on('find_game_match', (data) => {
        const gameId = data.gameId;
        if (gameWaitingPools[gameId] && gameWaitingPools[gameId] !== socket.id) {
            const opponentId = gameWaitingPools[gameId];
            io.to(socket.id).emit('game_match_found', { opponentId, gameId, role: 'caller' });
            io.to(opponentId).emit('game_match_found', { opponentId: socket.id, gameId, role: 'callee' });
            gameWaitingPools[gameId] = null;
            activeGameCounts[gameId]++;
            broadcastGamesInfo();
        } else {
            gameWaitingPools[gameId] = socket.id;
            broadcastGamesInfo();
        }
    });

    // --- GAME SIGNALING ---
    socket.on('game_move', (p) => io.to(p.targetId).emit('game_move', { senderId: socket.id, moveData: p.moveData }));
    socket.on('game_score', (p) => io.to(p.targetId).emit('game_score', { senderId: socket.id, score: p.score }));

    // --- WEBRTC SIGNALING (1-on-1) ---
    socket.on("webrtc_offer", (p) => io.to(p.targetId).emit("webrtc_offer", { senderId: socket.id, sdp: p.sdp }));
    socket.on("webrtc_answer", (p) => io.to(p.targetId).emit("webrtc_answer", { senderId: socket.id, sdp: p.sdp }));
    socket.on("webrtc_ice_candidate", (p) => io.to(p.targetId).emit("webrtc_ice_candidate", { senderId: socket.id, candidate: p.candidate }));

    // --- ROOM SIGNALING (isolated) ---
    socket.on("room_webrtc_offer", (p) => io.to(p.targetId).emit("room_webrtc_offer", { senderId: socket.id, sdp: p.sdp }));
    socket.on("room_webrtc_answer", (p) => io.to(p.targetId).emit("room_webrtc_answer", { senderId: socket.id, sdp: p.sdp }));
    socket.on("room_webrtc_ice_candidate", (p) => io.to(p.targetId).emit("room_webrtc_ice_candidate", { senderId: socket.id, candidate: p.candidate }));

    socket.on('end_call', (p) => {
        stopCallBilling(socket.id);
        io.to(p.targetId).emit('peer_disconnected', { msg: 'Disconnected' });
    });

    // --- ROOMS ---
    socket.on('join_room', (data) => {
        const { roomId, username, avatarUrl, gold } = data;
        const def = roomDefs[roomId];
        if (!def) return;

        // VIP check
        if (def.vip && (!gold || gold < 500)) {
            socket.emit('room_vip_required');
            return;
        }

        if (rooms[roomId].length >= def.cap) {
            socket.emit('room_full');
            return;
        }

        const user = { id: socket.id, username, avatarUrl };
        rooms[roomId].push(user);
        socket.join(roomId);
        
        socket.emit('room_participants', rooms[roomId]);
        socket.to(roomId).emit('room_user_joined', user);
        broadcastRoomsInfo();
    });

    socket.on('send_room_message', (data) => {
        // Broad relay to everyone in the room
        io.to(data.roomId).emit('receive_room_message', { 
            text: data.text, 
            username: data.username, 
            senderId: socket.id,
            msgId: data.msgId 
        });
    });

    socket.on('leave_room', (data) => leaveRoom(socket, data.roomId));

    // --- DM MESSAGING ---
    socket.on('send_message', (data) => {
        io.to(data.targetId).emit('receive_message', { text: data.text, senderId: socket.id, type: data.type || 'text', photoData: data.photoData, audioData: data.audioData, ephemeral: data.ephemeral });
    });

    // --- MONETIZATION: GIFTING SYSTEM ---
    socket.on('send_gift', async (data) => {
        // data: { targetId, giftId, goldValue, senderUsername, targetUsername }
        const { targetId, giftId, goldValue, senderUsername, targetUsername, senderId_db, targetId_db } = data;
        
        try {
            // 1. Gönderen bakiyesini kontrol et ve düş
            const newBalance = await UserRepository.updateGoldBalance(senderId_db, -goldValue, `gift_sent_${giftId}`);
            
            // 2. Alıcıya XP ekle (%70 değerinde XP, %30 sistem komisyonu)
            const recipientXP = Math.floor(goldValue * 0.7);
            await pool.query('UPDATE users SET xp = xp + $1 WHERE id = $2', [recipientXP, targetId_db]);
            
            // 3. Her iki tarafa sinyal gönder
            io.to(targetId).emit('receive_gift', { 
                giftId, 
                from: senderUsername, 
                xpGained: recipientXP 
            });
            
            socket.emit('gift_sent_success', { 
                newBalance, 
                msg: `${targetUsername} kullanıcısına hediye gönderildi!` 
            });

            console.log(`🎁 HEDİYE: ${senderUsername} -> ${targetUsername} (${giftId}, ${goldValue} Gold)`);
        } catch (err) {
            socket.emit('gift_error', { msg: "İşlem başarısız! Bakiyenizi kontrol edin." });
        }
    });

    // --- MONETIZATION: REWARDED ADS ---
    socket.on('reward_ad_watched', async (data) => {
        // data: { userId_db }
        try {
            const reward = 5;
            const newBalance = await UserRepository.updateGoldBalance(data.userId_db, reward, 'reward_ad');
            socket.emit('ad_reward_success', { newBalance, reward });
            console.log(`📺 REKLAM ÖDÜLÜ: ${data.userId_db} (+5 Gold)`);
        } catch (err) {
            console.error("Ad Reward Error:", err);
        }
    });

    // --- PRIVATE CALLS (DM) ---
    socket.on('private_call_init', (data) => {
        // data: { targetId, type ('audio'|'video'), callerName, callerAvatar }
        if (data.targetId) {
            io.to(data.targetId).emit('private_call_incoming', {
                callerId: socket.id,
                type: data.type,
                callerName: data.callerName,
                callerAvatar: data.callerAvatar
            });
        }
    });

    socket.on('private_call_signal', (data) => {
        // Broad relay for all WebRTC signals (offer, answer, ice)
        io.to(data.targetId).emit('private_call_signal', {
            senderId: socket.id,
            signal: data.signal
        });
    });

    socket.on('private_call_reject', (data) => {
        io.to(data.targetId).emit('private_call_rejected', { senderId: socket.id });
    });

    socket.on('private_call_hangup', (data) => {
        io.to(data.targetId).emit('private_call_finished', { senderId: socket.id });
    });

    function leaveRoom(sock, roomId) {
        if (rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(u => u.id !== sock.id);
            sock.to(roomId).emit('room_user_left', { id: sock.id });
            sock.leave(roomId);
            broadcastRoomsInfo();
        }
    }

    function getRoomsData() {
        const info = {};
        for (const id in roomDefs) {
            info[id] = { 
                userCount: rooms[id].length, 
                cap: roomDefs[id].cap, 
                vip: roomDefs[id].vip, 
                radio: roomDefs[id].radio,
                name: roomDefs[id].name, 
                stream: roomDefs[id].stream,
                avatars: rooms[id].slice(0, 3).map(u => u.avatarUrl) 
            };
        }
        return info;
    }

    function getGamesData() {
        return {
            'xox': { active: activeGameCounts['xox'], waiting: gameWaitingPools['xox'] ? 1 : 0 },
            'tetris': { active: activeGameCounts['tetris'], waiting: gameWaitingPools['tetris'] ? 1 : 0 }
        };
    }

    function broadcastRoomsInfo() {
        io.emit('receive_rooms_info', getRoomsData());
    }

    function broadcastGamesInfo() {
        io.emit('games_info_update', getGamesData());
    }

    socket.on('get_rooms_info', () => { broadcastRoomsInfo(); broadcastGamesInfo(); });

    socket.on('disconnect', () => {
        console.log('🔴 Çıktı:', socket.id);
        stopCallBilling(socket.id);
        waitingPool = waitingPool.filter(w => w.socketId !== socket.id);
        // Bellekten temizle
        for (const id in gameWaitingPools) { if (gameWaitingPools[id] === socket.id) gameWaitingPools[id] = null; }
        for (const r in rooms) { if (rooms[r].some(u => u.id === socket.id)) leaveRoom(socket, r); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log('🚀 BLIND ID NEXT-GEN SUNUCUSU AKTİF!');
    console.log('======================================================\n');
    console.log(`💻 Port: ${PORT}`);
    console.log('======================================================\n');
});
