require('dotenv').config();
console.log("🟢 Sunucu başlatma hazırlığı yapılıyor...");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const JWT_SECRET = process.env.JWT_SECRET || 'ozder_default_secret';

app.use(express.static('./'));
app.use(express.json());

// ==================== AUTHENTICATION (JWT) ====================
// Kullanıcı girişi veya misafir oturumu için Token üretir
app.post('/api/auth/register', (req, res) => {
    const { username, age, gender, region } = req.body;
    // Not: Gerçek bir uygulamada burada veritabanına kayıt atılır.
    // Şimdilik sadece Token üretip geri dönüyoruz.
    const userPayload = { 
        id: `user_${Math.random().toString(36).substr(2, 9)}`,
        username, age, gender, region 
    };
    
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: userPayload });
});

// Socket.io Middleware: Her bağlantıda Token kontrolü yapar
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: No token provided"));
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error("Authentication error: Invalid token"));
        socket.decoded = decoded; // Token içindeki kullanıcı bilgisini sokete bağla
        next();
    });
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

// Game pools
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
    socket.on('find_match', (data) => {
        // data: { gender, region, preference ('opposite'|'mixed') }
        const myGender = data.gender || 'erkek';
        const myRegion = data.region || '';
        const pref = data.preference || 'opposite';
        const regionFilter = data.regionFilter || false;

        console.log(`⏳ Arama: ${socket.id} (${myGender}, ${myRegion}, pref:${pref}, regionFilter:${regionFilter})`);

        // --- SMART MATCHING ENGINE ---
        let matchIdx = -1;

        // 1. Pass: Perfect Match (Gender & Region if filter is on)
        for (let i = 0; i < waitingPool.length; i++) {
            const w = waitingPool[i];
            if (w.socketId === socket.id) continue;

            const genderOk = (pref === 'mixed' || w.preference === 'mixed') || (myGender !== w.gender);
            let regionOk = true;
            if (regionFilter && w.regionFilter) {
                regionOk = (myRegion === w.region);
            }

            if (genderOk && regionOk) {
                matchIdx = i;
                break;
            }
        }

        // 2. Pass: If no match found and we are in a small pool, relax region filter automatically
        if (matchIdx === -1 && regionFilter) {
            for (let i = 0; i < waitingPool.length; i++) {
                const w = waitingPool[i];
                if (w.socketId === socket.id) continue;
                const genderOk = (pref === 'mixed' || w.preference === 'mixed') || (myGender !== w.gender);
                if (genderOk) {
                    matchIdx = i;
                    break;
                }
            }
        }

        if (matchIdx >= 0) {
            const opponent = waitingPool.splice(matchIdx, 1)[0];
            const iceBreaker = "Küçükken kahramanım dediğin biri var mıydı?";

            io.to(socket.id).emit('match_found', {
                opponentId: opponent.socketId, iceBreaker, role: 'caller',
                oppGender: opponent.gender, oppRegion: opponent.region,
                oppAge: opponent.age, oppUsername: opponent.username, oppZodiac: opponent.zodiac
            });
            io.to(opponent.socketId).emit('match_found', {
                opponentId: socket.id, iceBreaker, role: 'callee',
                oppGender: myGender, oppRegion: myRegion,
                oppAge: data.age, oppUsername: data.username, oppZodiac: data.zodiac
            });
            console.log(`🎉 EŞLEŞME! ${opponent.socketId} <-> ${socket.id}`);
        } else {
            // Remove any existing entry for this socket
            waitingPool = waitingPool.filter(w => w.socketId !== socket.id);
            waitingPool.push({
                socketId: socket.id, gender: myGender, region: myRegion,
                preference: pref, regionFilter,
                age: data.age, username: data.username, zodiac: data.zodiac
            });
            console.log('🛌 Kuyruğa alındı:', socket.id);
        }
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

    socket.on('end_call', (p) => io.to(p.targetId).emit('peer_disconnected', { msg: 'Disconnected' }));

    // --- ROOMS ---
    socket.on('join_room', async (data) => {
        const { roomId, username, avatarUrl } = data;
        const decodedUser = socket.decoded; // JWT ile dogrulanmis kimlik
        const def = roomDefs[roomId];
        if (!def) return;

        // VIP check (Sunucu tarafli dogrulama)
        // User'in gercek altinini Token'dan veya DB'den aliyoruz (data'dan degil!)
        const userGold = decodedUser.gold || 1000; 
        if (def.vip && userGold < 500) {
            socket.emit('room_vip_required');
            return;
        }

        // --- Zirhli Oda Kontrolü (Duplicates & Ghosts) ---
        // Yeni bir odaya girmeden once diger butun odalardan temizle
        clearUserFromAllRooms(decodedUser.id, socket);
        
        if (rooms[roomId].length >= def.cap) {
            socket.emit('room_full');
            return;
        }
        
        const user = { 
            id: socket.id, 
            userId: decodedUser.id, 
            username: decodedUser.username, 
            avatarUrl: decodedUser.avatarUrl || avatarUrl 
        };
        
        rooms[roomId].push(user);
        socket.join(roomId);
        
        // --- Zırhlı Onay ---
        socket.emit('room_join_success', { roomId, username: user.username });
        
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

    // --- Nuclear Room Cleanup (Ghost Buster) ---
    // Kullaniciyi butun odalardan tertemiz silen yardimci fonksiyon
    function clearUserFromAllRooms(userId, sock) {
        let changed = false;
        for (const rId in rooms) {
            const initialCount = rooms[rId].length;
            rooms[rId] = rooms[rId].filter(u => u.userId !== userId);
            if (rooms[rId].length !== initialCount) {
                changed = true;
                if (sock) sock.to(rId).emit('room_user_left', { userId: userId });
            }
        }
        if (changed) broadcastRoomsInfo();
    }

    function leaveRoom(sock, roomId) {
        if (rooms[roomId]) {
            const decodedUser = sock.decoded;
            // Artik socket.id degil, kalici userId uzerinden temizlik yapiyoruz
            rooms[roomId] = rooms[roomId].filter(u => u.userId !== decodedUser.id);
            sock.to(roomId).emit('room_user_left', { id: sock.id, userId: decodedUser.id });
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
        const decodedUser = socket.decoded;
        if (decodedUser) {
            // Sunucudan kopunca butun odalardan tertemiz siliniyoruz
            clearUserFromAllRooms(decodedUser.id, socket);
            console.log(`❌ [Zırhlı] Koptu: ${decodedUser.username} (${socket.id})`);
        } else {
            console.log('❌ [Zırhlı] Koptu (Bilinmeyen):', socket.id);
        }

        // Matchmaking ve Havuz Temizliği
        waitingPool = waitingPool.filter(w => w.socketId !== socket.id);
        MatchmakerService.handleDisconnect(socket.id);
        for (const id in gameWaitingPools) { if (gameWaitingPools[id] === socket.id) gameWaitingPools[id] = null; }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log('🚀 OZDER ID NEXT-GEN SUNUCUSU AKTİF!');
    console.log('======================================================\n');
    console.log(`💻 Port: ${PORT}`);
    console.log('======================================================\n');
});