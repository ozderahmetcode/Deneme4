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
const crypto = require('crypto');

// --- Modül İmportları ---
const setupSignaling = require('./signaling');
const MatchmakerService = require('./matchmaker_service_');
const { initDB, UserRepository } = require('./database');

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : (process.env.NODE_ENV === 'production' ? ['https://ozderahmetcode.github.io'] : ['*']); // Madde 18: Prod için varsayılan domain ekle

const app = express();
app.set('trust proxy', 1); // Render/Heroku arkasındaki gerçek IP'yi tanı (Madde 12)
const server = http.createServer(app);

// Güvenlik Middleware'leri
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.socket.io", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https://api.dicebear.com", "https://assets.mixkit.co"],
            connectSrc: ["'self'", "wss:", "https:", "https://cdn.socket.io", "*.streamtheworld.com", "*.musicradio.com"], // Madde 29
            mediaSrc: ["'self'", "blob:", "data:", "*.streamtheworld.com", "*.musicradio.com"], // Madde 29
            frameAncestors: ["'none'"], // Madde 17: Clickjacking Koruması
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    xFrameOptions: { action: "deny" }
}));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true })); // Sıkılaştırılmış CORS politikası

// HTTP Rate Limit (Brute-force koruması)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 dakika
    max: 100, // IP başına limit
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        console.warn(`🚨 [Audit] HTTP Rate Limit İhlali: ${req.ip} -> ${req.originalUrl}`);
        res.status(options.statusCode).send(options.message);
    }
});
app.use('/api/', limiter);

const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("❌ KRİTİK HATA: JWT_SECRET ortam değişkeni bulunamadı. Sunucu güvenliği için başlatılmıyor.");
    process.exit(1);
}

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
// Şifre Hashleme Yardımcıları
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, key] = storedHash.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex');
    // Madde 24: Timing Safe Comparison (Siber Saldırı Koruması)
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

// UUID Doğrulama (PostgreSQL format hatalarını önlemek için)
function isValidUUID(uuid) {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
}

app.post('/api/auth/register', async (req, res) => {
    const { username, password, age, gender, region } = req.body;
    
    // Güvenlik: Username sadece harf, rakam ve alt tire içerebilir. Max 20 karakter.
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    // Madde 18: Şifre Politikası (Min 8 Karakter, Harf ve Rakam Zorunlu)
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

    if (!username || !password || !usernameRegex.test(username) || !passwordRegex.test(password)) {
        return res.status(400).json({ 
            success: false, 
            error: "Geçersiz kullanıcı adı (3-20 karakter) veya zayıf şifre (Min 8 karakter, en az bir harf ve bir rakam içermelidir)" 
        });
    }

    try {
        const existingUser = await UserRepository.getUserByUsername(username);
        if (existingUser) {
            return res.status(400).json({ success: false, error: "Bu kullanıcı adı zaten alınmış." });
        }

        const passwordHash = hashPassword(password);
        const newUser = await UserRepository.createUser({
            username,
            password_hash: passwordHash,
            age: age || null,
            gender: gender || null,
            region: region || null,
            avatarUrl: '',
            zodiac: ''
        });

        const userPayload = { 
            id: newUser.id,
            username: newUser.username,
            avatarUrl: newUser.avatarUrl || ''
        };
        
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: userPayload });
    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ success: false, error: "Kayıt olurken bir hata oluştu." });
    }
});

const loginAttempts = new Map(); // username → { count, lockUntil }

// Madde 12: Memory Leak Koruması (Periyodik Temizlik)
setInterval(() => {
    const now = Date.now();
    for (const [user, attempt] of loginAttempts) {
        if (now > attempt.lockUntil && attempt.count === 0) {
            loginAttempts.delete(user);
        }
    }
}, 15 * 60000); // 15 dakikada bir temizle

// Madde 3: Arkadaşlık İstekleri Yetkilendirme Map'i (targetUserId -> Set of requesterUserIds)
const pendingFriendRequests = new Map();

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: "Kullanıcı adı ve şifre gereklidir." });
    }

    // Madde 26: Lockout DoS Koruması (IP + Username bazlı kilit)
    const lockKey = `${req.ip}_${username}`;
    const attempt = loginAttempts.get(lockKey) || { count: 0, lockUntil: 0 };
    if (Date.now() < attempt.lockUntil) {
        const remainingMin = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
        return res.status(429).json({ success: false, error: `Çok fazla başarısız deneme. Lütfen ${remainingMin} dakika bekleyin.` });
    }

    try {
        const user = await UserRepository.getUserByUsername(username);
        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            console.warn(`🚨 [Audit] Başarısız Giriş: ${username} (IP: ${req.ip})`);
            attempt.count++;
            if (attempt.count >= 5) {
                attempt.lockUntil = Date.now() + 5 * 60000;
                attempt.count = 0;
            }
            loginAttempts.set(lockKey, attempt);
            return res.status(401).json({ success: false, error: "Hatalı kullanıcı adı veya şifre." });
        }

        // Başarılı giriş: Denemeleri sıfırla
        loginAttempts.delete(lockKey);

        const userPayload = { 
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl || ''
        };
        
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: userPayload });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ success: false, error: "Giriş yaparken bir hata oluştu." });
    }
});

// Socket.io Middleware: Her bağlantıda Token ve Ban kontrolü
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: No token provided"));
    
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return next(new Error("Authentication error: Invalid token"));
        
        try {
            // Güvenlik (Token Revocation): Kullanıcının banlı olup olmadığını anlık kontrol et
            const dbUser = await UserRepository.getUserById(decoded.id);
            if (!dbUser) return next(new Error("Authentication error: User not found"));
            if (dbUser.is_banned) return next(new Error("Authentication error: User is banned"));
            
            socket.decoded = decoded;
            next();
        } catch (dbErr) {
            console.error("Token verification DB error:", dbErr);
            next(new Error("Authentication error: Internal DB error"));
        }
    });
});

// ==================== RATE LIMITING ====================
const rateLimitMap = new Map(); // clientIp → { count, resetTime }
const RATE_LIMIT = { maxRequests: 30, windowMs: 10000 }; // 30 istek / 10 saniye

function checkRateLimit(socket) {
    const now = Date.now();
    // Güvenlik: Proxy güveni sonrası gerçek IP (Madde 25)
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;     const userId = socket.decoded ? socket.decoded.id : 'anon';
    const limitKey = `${userId}_${clientIp}`;
    
    let entry = rateLimitMap.get(limitKey);
    
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + RATE_LIMIT.windowMs };
        rateLimitMap.set(limitKey, entry);
    }
    
    entry.count++;
    if (entry.count > RATE_LIMIT.maxRequests) {
        console.warn(`🚨 [Audit] Socket Rate Limit İhlali: ${userId} (IP: ${clientIp})`);
    }
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
// XSS Koruması
function sanitizeString(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// SSRF / Zararlı Link Koruması (Madde 11: Hardened)
function isValidUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        
        const host = parsed.hostname.toLowerCase();
        // Lokal ve internal IP bloklarını engelle (SSRF Koruması)
        const blacklisted = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'];
        if (blacklisted.includes(host)) return false;
        if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.')) return false;
        
        return true;
    } catch (e) {
        return false;
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
// Madde 13: Game Match Locks modül scope'una taşındı (Race Condition Koruması)
const gameMatchLocks = {};

io.on('connection', (socket) => {
    console.log('📱 Bağlandı:', socket.id);

    // --- Attach all signaling events from module ---
    signaling.attachToSocket(socket, io, checkRateLimit);

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
    const matchLocks = {}; // Matchmaker için kilit (Top-level yerine socket içinde kalabilir çünkü handleFindMatch kendi kilidini yönetir)
    
    socket.on('find_match', async (data) => {
        if (!checkRateLimit(socket)) {
            socket.emit('rate_limited', { msg: 'Çok hızlı istek gönderiyorsunuz. Lütfen bekleyin.' });
            return;
        }

        const result = await MatchmakerService.handleFindMatch(socket, data);
        
        if (result && result.matched) {
            // Güvenlik: Sinyalleşme yetkilendirmesi için eşleşme kaydı
            const opponentSocket = io.sockets.sockets.get(result.targetSocketId);
            if (opponentSocket) {
                socket.matchedPeerId = result.targetSocketId;
                opponentSocket.matchedPeerId = socket.id;
                
                // User2'ye bildir
                opponentSocket.emit('match_found', result.payload);
                console.log(`🎉 EŞLEŞME! ${socket.id} <-> ${result.targetSocketId}`);
            }
        } else {
            console.log('🛌 Kuyruğa alındı:', socket.id);
        }
    });

    // --- GAME MATCHMAKING ---
    socket.on('find_game_match', (data) => {
        if (!checkRateLimit(socket)) return;

        const gameId = data.gameId;
        if (gameMatchLocks[gameId]) return; // Race Condition kilidi
        gameMatchLocks[gameId] = true;

        try {
            if (gameWaitingPools[gameId] && gameWaitingPools[gameId] !== socket.id) {
                const opponentId = gameWaitingPools[gameId];
                if (!io.sockets.sockets.has(opponentId)) {
                    // Rakip kopmuş, yerine biz geçelim
                    gameWaitingPools[gameId] = socket.id;
                } else {
                    io.to(socket.id).emit('game_match_found', { opponentId, gameId, role: 'caller' });
                    io.to(opponentId).emit('game_match_found', { opponentId: socket.id, gameId, role: 'callee' });
                    
                    // Güvenlik: Sinyalleşme yetkilendirmesi
                    const opponentSocket = io.sockets.sockets.get(opponentId);
                    if (opponentSocket) {
                        socket.matchedPeerId = opponentId;
                        opponentSocket.matchedPeerId = socket.id;
                    }

                    gameWaitingPools[gameId] = null;
                    activeGameCounts[gameId]++;
                    
                    socket.activeGameId = gameId;
                    const oppSocket = io.sockets.sockets.get(opponentId);
                    if (oppSocket) oppSocket.activeGameId = gameId;
                }
            } else {
                gameWaitingPools[gameId] = socket.id;
            }
            broadcastGamesInfo();
        } finally {
            gameMatchLocks[gameId] = false;
        }
    });

    // --- ROOMS ---
    socket.on('join_room', async (data) => {
        if (!checkRateLimit(socket)) return;
        
        const { roomId, username, avatarUrl } = data;
        const decodedUser = socket.decoded;
        const def = roomDefs[roomId];
        if (!def) return;

        // 1. VIP/Kredi Kontrolü (Sunucu Taraflı - Veritabanı Doğrulaması)
        // VIP check (Güvenli DB Sorgusu)
        let userGold = 0;
        try {
            const dbUser = await UserRepository.getUserById(decodedUser.id);
            if (dbUser) userGold = dbUser.gold_balance || 0;
        } catch (e) {
            console.error("Gold check error:", e);
        }

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
        
        const finalAvatar = isValidUrl(data.avatarUrl) ? sanitizeString(data.avatarUrl) : '';
        const user = { 
            id: socket.id, 
            userId: decodedUser.id, 
            username: decodedUser.username, 
            avatarUrl: decodedUser.avatarUrl || finalAvatar 
        };
        
        rooms[roomId].push(user);
        socket.join(roomId);
        
        socket.emit('room_participants', rooms[roomId]);
        socket.to(roomId).emit('room_user_joined', user);
        broadcastRoomsInfo();
    });

    socket.on('send_room_message', (data) => {
        if (!checkRateLimit(socket)) return;
        if (!data || !data.roomId || !data.text) return;
        
        // Spam/DoS Koruması: Mesaj uzunluğu max 500 karakter
        const safeText = String(data.text).substring(0, 500);
        
        io.to(data.roomId).emit('receive_room_message', { 
            text: safeText, 
            username: socket.decoded.username, 
            senderId: socket.id,
            msgId: data.msgId 
        });
    });

    socket.on('leave_room', (data) => leaveRoom(socket, data.roomId));

    // --- FRIEND SYSTEM (Madde 20 & 23 Fix) ---
    socket.on('friend_request', (data) => {
        if (!checkRateLimit(socket)) return;
        if (!data || !data.targetId) return;
        
        // Kendine istek atmayı engelle
        if (data.targetId === socket.id) return;
        
        // Güvenlik: Gönderen bilgileri istemciden değil, doğrulanmış Token'dan alınır
        const decodedUser = socket.decoded;
        const targetSocket = io.sockets.sockets.get(data.targetId);
        
        if (targetSocket && targetSocket.decoded) {
            const targetUserId = targetSocket.decoded.id;
            if (!pendingFriendRequests.has(targetUserId)) {
                pendingFriendRequests.set(targetUserId, new Set());
            }
            pendingFriendRequests.get(targetUserId).add(decodedUser.id);
            
            io.to(data.targetId).emit('friend_request_received', {
                senderId: socket.id,
                senderUserId: decodedUser.id, // DB ID eklendi (Aşama 24)
                senderName: decodedUser.username,
                senderAvatar: decodedUser.avatarUrl || ''
            });
        }
    });

    socket.on('update_preference', async (data) => {
        // Madde 15 & 16: Whitelist ve Input Validation
        const validPrefs = ['mixed', 'same_gender', 'same_region'];
        if (!data || !validPrefs.includes(data.matchPref)) return;
        
        const decodedUser = socket.decoded;
        if (decodedUser) {
            try {
                await UserRepository.updateUserPreference(decodedUser.id, data.matchPref);
                console.log(`⚙️ Tercih güncellendi ve kaydedildi: ${decodedUser.username} → ${data.matchPref}`);
            } catch (e) {
                console.error("Preference update error:", e);
            }
        }
    });

    // --- REPORTING SYSTEM (Madde 20) ---
    socket.on('submit_report', async (data) => {
        if (!checkRateLimit(socket)) return;
        if (!data || !data.reportedId || !data.reason) return;
        
        const decodedUser = socket.decoded;
        if (decodedUser) {
            // Madde 4 Fix: UUID Format Kontrolü (Postgres Crash Prevention)
            if (!isValidUUID(data.reportedId)) {
                console.warn(`🚨 [Security] Geçersiz UUID ile rapor denemesi: ${data.reportedId}`);
                return;
            }

            try {
                // Madde 2 DoS Fix: submitReport -> reportUser (database.js ile uyumlu hale getirildi)
                await UserRepository.reportUser(decodedUser.id, data.reportedId, data.reason);
                console.log(`🚨 [Report] ${decodedUser.username} rapor gönderdi: -> ${data.reportedId}`);
                socket.emit('report_success', { msg: 'Raporunuz başarıyla iletildi. İnceleme başlatılacaktır.' });
            } catch (e) {
                console.error("Report submission error:", e);
            }
        }
    });

    // --- FRIEND SYSTEM PERSISTENCE (Madde 23 & 3 Fix) ---
    socket.on('accept_friend_request', async (data) => {
        if (!checkRateLimit(socket)) return;
        // Madde 4 Fix: friendId -> friendUserId ve UUID Kontrolü
        if (!data || !data.friendUserId || !isValidUUID(data.friendUserId)) return; 
        
        const decodedUser = socket.decoded;
        if (decodedUser) {
            // Madde 3: Yetkilendirme Kontrolü (Handshake Verification)
            const myPendingRequests = pendingFriendRequests.get(decodedUser.id);
            if (!myPendingRequests || !myPendingRequests.has(data.friendUserId)) {
                console.warn(`🚨 [Security] Yetkisiz Arkadaşlık Kabul Denemesi: ${decodedUser.username} -> ${data.friendUserId}`);
                return;
            }

            try {
                await UserRepository.addFriend(decodedUser.id, data.friendUserId);
                myPendingRequests.delete(data.friendUserId); // İstek işlendi, temizle
                console.log(`🤝 [Social] Arkadaşlık doğrulandı ve kuruldu: ${decodedUser.username} <-> ${data.friendUserId}`);
            } catch (e) {
                console.error("Add friend error:", e);
            }
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const decodedUser = socket.decoded;
        if (decodedUser) {
            clearUserFromAllRooms(decodedUser.id, socket);
            console.log(`❌ [Zırhlı] Kullanıcı bağlantısı koptu. (ID: ${socket.id})`);
        } else {
            console.log('❌ [Zırhlı] Koptu (Bilinmeyen):', socket.id);
        }

        // Güvenlik: Eşleşme bilgisini temizle
        if (socket.matchedPeerId) {
            const peer = io.sockets.sockets.get(socket.matchedPeerId);
            if (peer) delete peer.matchedPeerId;
            delete socket.matchedPeerId;
        }

        // MatchmakerService havuz temizliği (tek havuz)
        if (MatchmakerService && typeof MatchmakerService.handleDisconnect === 'function') {
            MatchmakerService.handleDisconnect(socket.id);
        }

        // Game pool temizliği
        for (const id in gameWaitingPools) {
            if (gameWaitingPools[id] === socket.id) gameWaitingPools[id] = null;
        }
        
        // Aktif oyun düşümü
        if (socket.activeGameId && activeGameCounts[socket.activeGameId] > 0) {
            activeGameCounts[socket.activeGameId]--;
            broadcastGamesInfo();
        }

        // Rate limit temizliği
        rateLimitMap.delete(socket.id);
    });
});

// ==================== ERROR MONITORING ====================
process.on('uncaughtException', (err) => {
    console.error('💥 [CRITICAL] Yakalanmamış Hata:', err.message);
    console.error(err.stack);
    // Güvenlik: Bozuk state ile devam eden sunucu hack'lenebilir. Zorunlu çıkış yap.
    process.exit(1);
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
        console.log('🔒 HTTPS Notu: Render/Heroku üzerinde TLS otomatik sağlanır.');
        console.log('   Yerel testlerde mikrofon izni için "localhost" kullanın veya HTTPS proxy kurun.');
        console.log('======================================================\n');
    });
}

startServer();
