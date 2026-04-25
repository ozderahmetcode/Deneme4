/**
 * 🚀 PROJECT: OZDER NEXT-GEN
 * Ana Sunucu — Modülerleştirilmiş Mimari v2.0
 * 
 * Modüller:
 * - signaling.js    → WebRTC, Oda, DM, Oyun sinyalleri
 * - matchmaking.js  → In-memory eşleşme motoru
 * - matchmaker_service_.js → Eşleşme iş mantığı katmanı
 * - database.js     → PostgreSQL bağlantı ve şema
 */

require('dotenv').config();
console.log("🟢 Sunucu başlatma hazırlığı yapılıyor...");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// --- Modül İmportları ---
const setupSignaling = require('./signaling');
const MatchmakerService = require('./matchmaker_service_');
const { pool, initDB } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const JWT_SECRET = process.env.JWT_SECRET || 'ozder_default_secret';

app.use(express.static('./'));
app.use(express.json());

// ==================== HEALTH CHECK (Render.com uyumlu) ====================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        connections: io.engine ? io.engine.clientsCount : 0
    });
});

// ==================== AUTHENTICATION (JWT) ====================
app.post('/api/auth/register', (req, res) => {
    const { username, age, gender, region } = req.body;
    const userPayload = { 
        id: `user_${Math.random().toString(36).substr(2, 9)}`,
        username, age, gender, region 
    };
    
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: userPayload });
});

// Socket.io Middleware: Her bağlantıda Token kontrolü
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: No token provided"));
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error("Authentication error: Invalid token"));
        socket.decoded = decoded;
        next();
    });
});

// ==================== RATE LIMITING ====================
const rateLimitMap = new Map(); // socketId → { count, resetTime }
const RATE_LIMIT = { maxRequests: 30, windowMs: 10000 }; // 30 istek / 10 saniye

function checkRateLimit(socketId) {
    const now = Date.now();
    let entry = rateLimitMap.get(socketId);
    
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + RATE_LIMIT.windowMs };
        rateLimitMap.set(socketId, entry);
    }
    
    entry.count++;
    return entry.count <= RATE_LIMIT.maxRequests;
}

// Periyodik temizlik (her 30 saniyede eski rate limit kayıtlarını sil)
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap) {
        if (now > val.resetTime) rateLimitMap.delete(key);
    }
}, 30000);

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

    // Normal Rooms
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

// Initialize room arrays
const rooms = {};
for (const id in roomDefs) rooms[id] = [];

// Game pools
const gameWaitingPools = { 'xox': null, 'tetris': null };
const activeGameCounts = { 'xox': 0, 'tetris': 0 };

// ==================== HELPER FUNCTIONS ====================
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

function broadcastRoomsInfo() { io.emit('receive_rooms_info', getRoomsData()); }
function broadcastGamesInfo() { io.emit('games_info_update', getGamesData()); }

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
        rooms[roomId] = rooms[roomId].filter(u => u.userId !== decodedUser.id);
        sock.to(roomId).emit('room_user_left', { id: sock.id, userId: decodedUser.id });
        sock.leave(roomId);
        broadcastRoomsInfo();
    }
}

// ==================== SIGNALING MODULE ====================
const signaling = setupSignaling(io);

// ==================== SOCKET LOGIC ====================
io.on('connection', (socket) => {
    console.log('📱 Bağlandı:', socket.id);

    // --- Attach all signaling events from module ---
    signaling.attachToSocket(socket);

    // --- Initial data push ---
    socket.emit('receive_rooms_info', getRoomsData());
    socket.emit('games_info_update', getGamesData());

    // --- ROOMS INFO (tek handler) ---
    socket.on('get_rooms_info', () => {
        broadcastRoomsInfo();
        broadcastGamesInfo();
    });

    socket.on('get_games_info', () => {
        socket.emit('games_info_update', getGamesData());
    });

    // --- SMART MATCHING (MatchmakerService entegrasyonu) ---
    socket.on('find_match', async (data) => {
        if (!checkRateLimit(socket.id)) {
            socket.emit('rate_limited', { msg: 'Çok hızlı istek gönderiyorsunuz. Lütfen bekleyin.' });
            return;
        }

        const result = await MatchmakerService.handleFindMatch(socket, data);
        
        if (result && result.matched) {
            // User2'ye bildir (User1'e MatchmakerService içinden zaten bildirildi)
            io.to(result.targetSocketId).emit('match_found', result.payload);
            console.log(`🎉 EŞLEŞME! ${socket.id} <-> ${result.targetSocketId}`);
        } else {
            console.log('🛌 Kuyruğa alındı:', socket.id);
        }
    });

    // --- GAME MATCHMAKING ---
    socket.on('find_game_match', (data) => {
        if (!checkRateLimit(socket.id)) return;

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

    // --- ROOMS ---
    socket.on('join_room', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        
        const { roomId, username, avatarUrl } = data;
        const decodedUser = socket.decoded;
        const def = roomDefs[roomId];
        if (!def) return;

        // VIP check
        const userGold = decodedUser.gold || 1000; 
        if (def.vip && userGold < 500) {
            socket.emit('room_vip_required');
            return;
        }

        // Ghost Buster: tüm odalardan temizle
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
        
        socket.emit('room_participants', rooms[roomId]);
        socket.to(roomId).emit('room_user_joined', user);
        broadcastRoomsInfo();
    });

    socket.on('send_room_message', (data) => {
        if (!checkRateLimit(socket.id)) return;
        if (!data || !data.roomId) return;
        
        io.to(data.roomId).emit('receive_room_message', { 
            text: data.text, 
            username: data.username, 
            senderId: socket.id,
            msgId: data.msgId 
        });
    });

    socket.on('leave_room', (data) => leaveRoom(socket, data.roomId));

    // --- FRIEND SYSTEM ---
    socket.on('friend_request', (data) => {
        if (!data || !data.targetId) return;
        io.to(data.targetId).emit('friend_request_received', {
            senderId: socket.id,
            senderName: data.senderName,
            senderAvatar: data.senderAvatar
        });
    });

    socket.on('update_preference', (data) => {
        // Preference güncellemesi (isteğe bağlı sunucu tarafı kayıt)
        console.log(`⚙️ Tercih güncellendi: ${socket.id} → ${data.matchPref}`);
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const decodedUser = socket.decoded;
        if (decodedUser) {
            clearUserFromAllRooms(decodedUser.id, socket);
            console.log(`❌ [Zırhlı] Koptu: ${decodedUser.username} (${socket.id})`);
        } else {
            console.log('❌ [Zırhlı] Koptu (Bilinmeyen):', socket.id);
        }

        // MatchmakerService havuz temizliği (tek havuz)
        if (MatchmakerService && typeof MatchmakerService.handleDisconnect === 'function') {
            MatchmakerService.handleDisconnect(socket.id);
        }

        // Game pool temizliği
        for (const id in gameWaitingPools) {
            if (gameWaitingPools[id] === socket.id) gameWaitingPools[id] = null;
        }

        // Rate limit temizliği
        rateLimitMap.delete(socket.id);
    });
});

// ==================== ERROR MONITORING ====================
process.on('uncaughtException', (err) => {
    console.error('💥 [CRITICAL] Yakalanmamış Hata:', err.message);
    console.error(err.stack);
    // Sunucu çökmesini engelle — loglayıp devam et
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 [WARNING] İşlenmemiş Promise Reddi:', reason);
});

// ==================== STARTUP ====================
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Veritabanı bağlantısını dene (opsiyonel — bağlanamazsa devam et)
    try {
        await initDB();
        console.log('✅ Veritabanı bağlantısı kuruldu.');
    } catch (err) {
        console.warn('⚠️ Veritabanı bağlantısı kurulamadı (Hafıza modunda devam ediliyor):', err.message);
    }

    server.listen(PORT, '0.0.0.0', () => {
        console.log('\n======================================================');
        console.log('🚀 OZDER NEXT-GEN SUNUCUSU AKTİF!');
        console.log('======================================================\n');
        console.log(`💻 Port: ${PORT}`);
        console.log(`🏥 Health: http://localhost:${PORT}/health`);
        console.log('======================================================\n');
    });
}

startServer();