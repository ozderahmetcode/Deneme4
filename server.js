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
const pathModule = require('path'); // Madde 106 Fix: Çakışmayı önlemek için pathModule olarak değiştirildi
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// --- Modül İmportları ---
const setupSignaling = require('./signaling');
const MatchmakerService = require('./matchmaker_service_');
const { initDB, UserRepository } = require('./database');

// --- GLOBAL STATE & SECURITY MAPS ---
const rateLimitMap = new Map(); // Madde 16: clientIp -> { count, resetTime }
const loginAttempts = new Map(); // Madde 17: IP_username -> { count, lockUntil, lastAttempt }
const blacklistedTokens = new Map(); // Madde 17 & 73: Logout yapılan tokenlar (token -> expiresAt)
const friendRequestSpamMap = new Map(); // Madde 10: senderId -> Map<targetUserId, timestamp>
const pendingFriendRequests = new Map(); // Madde 3: In-memory handshake (Stateless fallback added)

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : '*'; // Production'da kendi origin'in ile çakışmaması için open default
// NOT: Production'da güvenlik için Render dashboard'dan ALLOWED_ORIGINS env değişkenini ayarlayın
// Örnek: ALLOWED_ORIGINS=https://deneme4-p5kx.onrender.com,https://senin-domain.com

const app = express();
app.set('trust proxy', 1); // Render/Heroku arkasındaki gerçek IP'yi tanı (Madde 12)
const server = http.createServer(app);

// Güvenlik Middleware'leri
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.socket.io", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"], // Madde 108 Fix: Satır içi (onclick) JS'e izin ver
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https://api.dicebear.com", "https://assets.mixkit.co", "https://www.transparenttextures.com"], // Madde 108 Fix: UI dokuları eklendi
            connectSrc: ["'self'", "wss:", "https://cdn.socket.io", "https://*.streamtheworld.com", "https://*.musicradio.com"], 
            mediaSrc: ["'self'", "blob:", "data:", "https://assets.mixkit.co", "https://*.streamtheworld.com", "https://*.musicradio.com"], // Madde 108 Fix: Medya kaynakları eklendi
            frameAncestors: ["'none'"], 
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    frameguard: { action: "deny" } // Madde 24 Fix: Modern Helmet uyumluluğu
}));
// CORS — '*' iken credentials true olamaz, dinamik origin kullan
app.use(cors({ 
    origin: (origin, callback) => {
        // origin yok (mobile app, curl, same-origin) → izin ver
        if (!origin) return callback(null, true);
        // Wildcard mode
        if (ALLOWED_ORIGINS === '*' || (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes('*'))) {
            return callback(null, true);
        }
        // Whitelist mode
        if (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('CORS reddedildi: ' + origin));
    },
    credentials: true 
}));

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

const io = new Server(server, { 
    cors: { 
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (ALLOWED_ORIGINS === '*' || (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes('*'))) {
                return callback(null, true);
            }
            if (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin)) {
                return callback(null, true);
            }
            callback(new Error('Socket.io CORS reddedildi: ' + origin));
        },
        credentials: true
    } 
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("❌ KRİTİK HATA: JWT_SECRET ortam değişkeni bulunamadı. Sunucu güvenliği için başlatılmıyor.");
    process.exit(1);
}

// Madde 105 & 106 Fix: Render/Linux uyumlu statik dosya sunumu (Namespace Isolation)
app.use(express.static(pathModule.join(__dirname, '.')));
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
    try {
        if (!storedHash || !storedHash.includes(':')) return false; // Madde 8 Fix: Format kontrolü
        const [salt, key] = storedHash.split(':');
        const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex');
        
        const keyBuffer = Buffer.from(key, 'hex');
        const hashBuffer = Buffer.from(hash, 'hex');
        
        // Madde 8 Fix: timingSafeEqual farklı uzunluklarda throw eder
        if (keyBuffer.length !== hashBuffer.length) return false;
        
        return crypto.timingSafeEqual(keyBuffer, hashBuffer);
    } catch (e) {
        console.error("🚨 [Security] Password verification error (Malformed hash?):", e.message);
        return false;
    }
}

// UUID Doğrulama (PostgreSQL format hatalarını önlemek için)
function isValidUUID(uuid) {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
}

// IP Maskeleme (Privacy & GDPR/KVKK Compliance)
function maskIP(ip) {
    if (!ip) return 'unknown';
    // Sadece son okteti/blok bilgisini gizle veya hashle
    return crypto.createHash('sha256').update(ip + process.env.JWT_SECRET).digest('hex').substring(0, 10);
}

// --- AUTH HELPERS ---
async function generateTokens(user) {
    const accessToken = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '1h' } // Madde 29 Fix: Short-lived access token
    );
    
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 gün
    
    await UserRepository.saveRefreshToken(user.id, refreshToken, expiresAt);
    
    return { accessToken, refreshToken };
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
        
        const { accessToken, refreshToken } = await generateTokens(newUser);
        res.json({ success: true, token: accessToken, refreshToken, user: userPayload });
    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ success: false, error: "Kayıt olurken bir hata oluştu." });
    }
});


// Madde 12: Memory Leak Koruması (Periyodik Temizlik)
setInterval(() => {
    const now = Date.now();
    for (const [user, attempt] of loginAttempts) {
        // Madde 17 Fix: Kilit süresi geçmiş VEYA 1 saattir işlem görmemiş kayıtları sil
        if (now > attempt.lockUntil || (now - attempt.lastAttempt > 3600000)) {
            loginAttempts.delete(user);
        }
    }
    // Madde 7 & 67 Fix: Arkadaşlık spam havuzunu akıllıca temizle (24 saatten eski kayıtlar)
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    for (const [senderId, targets] of friendRequestSpamMap) {
        for (const [targetId, timestamp] of targets) {
            if (timestamp < twentyFourHoursAgo) {
                targets.delete(targetId);
            }
        }
        if (targets.size === 0) friendRequestSpamMap.delete(senderId);
    }

    // Madde 16 Fix: Rate Limit haritasını temizle (Memory Leak Prevention)
    const resetTime = now - (10 * 1000); // 10 saniyelik pencere
    for (const [key, entry] of rateLimitMap) {
        if (now > entry.resetTime) {
            rateLimitMap.delete(key);
        }
    }
    // Madde 17 & 73 Fix: Blacklist havuzunu temizle (Süresi dolan tokenları çıkar)
    for (const [token, expiresAt] of blacklistedTokens) {
        if (now > expiresAt) {
            blacklistedTokens.delete(token);
        }
    }

    // Madde 21 & 99 Fix: Yetkilendirme Map'ini temizle (Bellek Sızıntısı Koruması)
    // Sadece şu an aktif bağlantısı olmayan kullanıcıları temizle
    const connectedUserIds = new Set();
    io.sockets.sockets.forEach(s => {
        if (s.decoded) connectedUserIds.add(s.decoded.id);
    });

    for (const [userId, requesters] of pendingFriendRequests) {
        if (!connectedUserIds.has(userId)) {
            pendingFriendRequests.delete(userId);
        }
    }
}, 15 * 60000); // 15 dakikada bir temizle

// Madde 3: Arkadaşlık İstekleri Yetkilendirme Map'i (targetUserId -> Set of requesterUserIds)

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: "Kullanıcı adı ve şifre gereklidir." });
    }

    // Madde 26: Lockout DoS Koruması (IP + Username bazlı kilit)
    const lockKey = `${req.ip}_${username}`;
    const attempt = loginAttempts.get(lockKey) || { count: 0, lockUntil: 0, lastAttempt: Date.now() };
    if (Date.now() < attempt.lockUntil) {
        const remainingMin = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
        return res.status(429).json({ success: false, error: `Çok fazla başarısız deneme. Lütfen ${remainingMin} dakika bekleyin.` });
    }

    try {
        const user = await UserRepository.getUserByUsername(username);
        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            console.warn(`🚨 [Audit] Başarısız Giriş: ${username} (IP: ${maskIP(req.ip)})`);
            attempt.count++;
            if (attempt.count >= 5) {
                attempt.lockUntil = Date.now() + 5 * 60000;
                attempt.count = 0;
            }
            attempt.lastAttempt = Date.now(); // Madde 17 Fix: Son deneme zamanını güncelle
            loginAttempts.set(lockKey, attempt);
            return res.status(401).json({ success: false, error: "Hatalı kullanıcı adı veya şifre." });
        }

        // Başarılı giriş: Denemeleri sıfırla
        loginAttempts.delete(lockKey);

        const { accessToken, refreshToken } = await generateTokens(user);
        
        res.json({ 
            success: true, 
            token: accessToken, 
            refreshToken,
            user: { id: user.id, username: user.username, avatarUrl: user.avatar_url || '' } 
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ success: false, error: "Giriş yapılırken bir hata oluştu." });
    }
});

app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false });

    try {
        // Madde 11 Fix: Atomic Consumption (Verify + Delete in one step)
        const userId = await UserRepository.consumeRefreshToken(refreshToken);
        if (!userId) return res.status(403).json({ success: false, error: "Geçersiz, kullanılmış veya süresi dolmuş token." });

        const user = await UserRepository.getUserById(userId);
        if (!user || user.is_banned) return res.status(403).json({ success: false });

        // Yeni token seti üret
        const tokens = await generateTokens(user);
        res.json({ success: true, ...tokens });
    } catch (err) {
        console.error("Refresh error:", err);
        res.status(500).json({ success: false });
    }
});

// Socket.io Middleware: Her bağlantıda Token ve Ban kontrolü
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: No token provided"));
    
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return next(new Error("Authentication error: Invalid token"));
        
        // Madde 17: Blacklist kontrolü
        // Madde 17 & 73 Fix: Blacklist kontrolü
        if (blacklistedTokens.has(token)) {
            return next(new Error("Authentication error: Token is revoked (logged out)"));
        }

        try {
            // Güvenlik (Token Revocation): Kullanıcının banlı olup olmadığını anlık kontrol et
            const dbUser = await UserRepository.getUserById(decoded.id);
            if (!dbUser) return next(new Error("Authentication error: User not found"));
            if (dbUser.is_banned) return next(new Error("Authentication error: User is banned"));
            
            socket.decoded = decoded;
            // Madde 7 Fix: JWT'deki eski avatar yerine DB'den taze avatarı socket'e bağla
            socket.currentAvatar = dbUser.avatar_url || '';

            socket.currentAvatar = dbUser.avatar_url || '';
            next();
        } catch (dbErr) {
            console.error("Token verification DB error:", dbErr);
            next(new Error("Authentication error: Internal DB error"));
        }
    });
});

// ==================== RATE LIMITING ====================
const RATE_LIMIT = { maxRequests: 30, windowMs: 10000 }; // 30 istek / 10 saniye

function checkRateLimit(socket) {
    const now = Date.now();
    // Güvenlik: Proxy güveni sonrası gerçek IP (Madde 9 Fix: Sadece ilk IP'yi al)
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address; 
    const userId = socket.decoded ? socket.decoded.id : 'anon';
    const limitKey = `${userId}_${clientIp}`;
    
    let entry = rateLimitMap.get(limitKey);
    
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + RATE_LIMIT.windowMs };
        rateLimitMap.set(limitKey, entry);
    }
    
    entry.count++;
    if (entry.count > RATE_LIMIT.maxRequests) {
        console.warn(`🚨 [Audit] Socket Rate Limit İhlali: ${userId} (IP: ${maskIP(clientIp)})`);
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
            name: sanitizeString(roomDefs[id].name), // Madde 15 Fix: XSS Protection
            stream: roomDefs[id].stream,
            avatars: rooms[id].slice(0, 3).map(u => sanitizeString(u.avatarUrl || '')) 
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

    // Madde 7 & 12 & 65 Fix: Bekleyen Arkadaşlık İsteklerini Gönder (Timing & Offline Delivery)
    if (socket.decoded) {
        UserRepository.getPendingFriendRequests(socket.decoded.id).then(pendingReqs => {
            if (pendingReqs && pendingReqs.length > 0) {
                // Madde 6 Fix: DB (snake_case) formatını Client (camelCase) formatına eşle
                const mappedReqs = pendingReqs.map(r => ({
                    senderUserId: r.sender_id,
                    senderName: sanitizeString(r.sender_name),
                    senderAvatar: sanitizeString(r.sender_avatar || '')
                }));
                socket.emit('pending_friend_requests', mappedReqs);

                // Sunucu tarafındaki yetkilendirme Map'ine de ekle
                if (!pendingFriendRequests.has(socket.decoded.id)) {
                    pendingFriendRequests.set(socket.decoded.id, new Set());
                }
                mappedReqs.forEach(req => {
                    pendingFriendRequests.get(socket.decoded.id).add(req.senderUserId);
                });
            }
        }).catch(e => console.error("Pending sync error:", e));
    }

    // --- Attach all signaling events from module ---
    signaling.attachToSocket(socket, io, checkRateLimit, sanitizeString); // sanitizeString eklendi (Madde 8 Fix)

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
        if (!checkRateLimit(socket)) {
            socket.emit('rate_limited', { msg: 'Çok hızlı istek gönderiyorsunuz. Lütfen bekleyin.' });
            return;
        }

        const result = await MatchmakerService.handleFindMatch(socket, data, sanitizeString);
        
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
            username: sanitizeString(decodedUser.username), 
            avatarUrl: sanitizeString(socket.currentAvatar || finalAvatar) // Madde 13 Fix: Deep Sanitization
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
    socket.on('friend_request', async (data) => {
        try {
            if (!checkRateLimit(socket)) return;
            if (!data || !data.targetId) return;
            
            // Kendine istek atmayı engelle (Aynı socket veya aynı kullanıcı - farklı tab)
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (!targetSocket || !targetSocket.decoded) return;
            
            const decodedUser = socket.decoded;
            const targetUserId = targetSocket.decoded.id;

            // Madde 16 & 95 Fix: Gerçek Zamanlı Ban Kontrolü (Hedef Kullanıcı)
            const targetDbUser = await UserRepository.getUserById(targetUserId);
            if (!targetDbUser || targetDbUser.is_banned) {
                socket.emit('friend_error', { msg: 'Bu kullanıcı şu an istek kabul etmiyor.' });
                return;
            }

            // Madde 22 & 100 Fix: Map Referans Optimizasyonu (Performans & Kod Kalitesi)
            let senderRequests = friendRequestSpamMap.get(decodedUser.id);
            if (!senderRequests) {
                senderRequests = new Map();
                friendRequestSpamMap.set(decodedUser.id, senderRequests);
            }
            
            const lastRequestTime = senderRequests.get(targetUserId) || 0;
            const now = Date.now();
            
            if (now - lastRequestTime < 1 * 60 * 60 * 1000) {
                socket.emit('friend_error', { msg: 'Bu kullanıcıya çok sık istek gönderiyorsunuz. Lütfen bir süre bekleyin.' });
                return;
            }
            senderRequests.set(targetUserId, now);
            
            if (targetUserId === decodedUser.id) {
                console.warn(`🚨 [Security] Kendine arkadaşlık isteği engellendi: ${decodedUser.username}`);
                return;
            }

            // Spam Koruması: Zaten bekleyen bir istek var mı?
            const targetPending = pendingFriendRequests.get(targetUserId);
            if (targetPending && targetPending.has(decodedUser.id)) {
                socket.emit('friend_error', { msg: 'Bu kullanıcıya zaten bir isteğiniz bulunuyor.' });
                return;
            }
            
            if (!pendingFriendRequests.has(targetUserId)) {
                pendingFriendRequests.set(targetUserId, new Set());
            }
            pendingFriendRequests.get(targetUserId).add(decodedUser.id);
            
            // Madde 12 Fix: Kalıcı Kayıt (DB) - Non-blocking (Madde 18 tarzı)
            UserRepository.sendFriendRequest(decodedUser.id, targetUserId).catch(e => console.error("🚨 [DB] Friend request error:", e.message));
            
            io.to(data.targetId).emit('friend_request_received', {
                senderId: socket.id,
                senderUserId: decodedUser.id,
                senderName: sanitizeString(decodedUser.username),
                senderAvatar: sanitizeString(decodedUser.avatarUrl || socket.currentAvatar || '') // Madde 8 Fix
            });

            socket.emit('friend_info', { msg: 'Arkadaşlık isteği gönderildi.' });
        } catch (e) {
            console.error("🚨 [Handler] Friend request processing error:", e);
            socket.emit('friend_error', { msg: 'İşlem sırasında bir hata oluştu.' });
        }
    });

    socket.on('update_preference', async (data) => {
        if (!checkRateLimit(socket)) return;
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
                const result = await UserRepository.reportUser(decodedUser.id, data.reportedId, data.reason);
                if (result) {
                    console.log(`🚨 [Report] ${decodedUser.username} rapor gönderdi: -> ${data.reportedId}`);
                    socket.emit('report_success', { msg: 'Raporunuz başarıyla iletildi. İnceleme başlatılacaktır.' });
                } else {
                    socket.emit('report_error', { msg: 'Bu kullanıcıyı zaten raporladınız. Lütfen 24 saat bekleyin.' });
                }
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
            // Madde 6 Fix: Dağıtık sistem uyumluluğu - Map'te yoksa DB'den kontrol et
            const myPendingRequests = pendingFriendRequests.get(decodedUser.id);
            const inMemoryMatch = myPendingRequests && myPendingRequests.has(data.friendUserId);
            
            if (!inMemoryMatch) {
                const inDbMatch = await UserRepository.hasPendingFriendRequest(data.friendUserId, decodedUser.id);
                if (!inDbMatch) {
                    console.warn(`🚨 [Security] Yetkisiz Arkadaşlık Kabul Denemesi: ${decodedUser.username} -> ${data.friendUserId}`);
                    return;
                }
            }

            try {
                await UserRepository.addFriend(decodedUser.id, data.friendUserId);
                // Madde 2 & 5 Fix: Tam Tutarlılık - Güvenli silme (Null check)
                if (pendingFriendRequests.has(decodedUser.id)) {
                    pendingFriendRequests.get(decodedUser.id).delete(data.friendUserId);
                }
                console.log(`🤝 [Social] Arkadaşlık doğrulandı ve kuruldu: ${decodedUser.username} <-> ${data.friendUserId}`);
                socket.emit('friend_success', { msg: 'Arkadaşlık isteği kabul edildi.' });
            } catch (e) {
                console.error("Add friend error:", e);
            }
        }
    });

    socket.on('reject_friend_request', async (data) => {
        if (!data || !data.friendUserId || !isValidUUID(data.friendUserId)) return;
        const decodedUser = socket.decoded;
        if (decodedUser) {
            try {
                await UserRepository.rejectFriendRequest(decodedUser.id, data.friendUserId);
                if (pendingFriendRequests.has(decodedUser.id)) {
                    pendingFriendRequests.get(decodedUser.id).delete(data.friendUserId);
                }
                socket.emit('friend_info', { msg: 'İstek reddedildi.' });
            } catch (e) {
                console.error("Reject friend error:", e);
            }
        }
    });

    socket.on('remove_friend', async (data) => {
        if (!data || !data.friendUserId || !isValidUUID(data.friendUserId)) return;
        const decodedUser = socket.decoded;
        if (decodedUser) {
            try {
                await UserRepository.removeFriend(decodedUser.id, data.friendUserId);
                socket.emit('friend_info', { msg: 'Arkadaş listenizden çıkarıldı.' });
            } catch (e) {
                console.error("Remove friend error:", e);
            }
        }
    });

    // --- LOGOUT / TOKEN REVOCATION (Madde 15 & 17) ---
    socket.on('logout', async (data) => {
        const handshakeToken = socket.handshake.auth.token;
        const currentToken = data && data.token;
        const decodedUser = socket.decoded;
        
        // Madde 15 & 94 Fix: Hem el sıkışma (Handshake) hem de güncel token'ı yasakla
        if (handshakeToken) blacklistedTokens.set(handshakeToken, Date.now() + 3600000);
        if (currentToken && currentToken !== handshakeToken) {
            blacklistedTokens.set(currentToken, Date.now() + 3600000);
        }
        
        if (decodedUser) {
            console.log(`🚪 [Auth] Kullanıcı çıkış yaptı, session sonlandırıldı: ${decodedUser.username}`);
            try {
                // Madde 29 & 70 Fix: Tüm refresh token'ları veritabanından sil
                await UserRepository.deleteUserRefreshTokens(decodedUser.id);
            } catch (e) {
                console.error("Logout DB cleanup error:", e);
            }
        }
        
        socket.disconnect();
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const decodedUser = socket.decoded;
        if (decodedUser) {
            // Madde 16 Fix: rateLimitMap.delete(socket.id) silindi (Hem yanlış key, hem bypass riski)
            console.log('❌ Ayrıldı:', socket.id, `(${decodedUser.username})`);
            clearUserFromAllRooms(decodedUser.id, socket);
            
            // Madde 21 Fix: Bellek temizliği (Memory Leak Prevention)
            pendingFriendRequests.delete(decodedUser.id);
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

        // Rate limit temizliği (Madde 16 Fix: Artık periyodik cleanup tarafından yapılıyor)
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