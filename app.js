"use strict";

// ---- GLOBAL PLAYER & DATA (File-level access) ----
const radioPlayer = new Audio();
radioPlayer.volume = 0.5;

const fallbackRadios = {
    'radio_metro': { name: '📻 Metro FM', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM.mp3' },
    'radio_joy': { name: '📻 Joy FM', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_FM_ITUNES.mp3' },
    'radio_joy_turk': { name: '📻 Joy Türk', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_ITUNES.mp3' },
    'radio_capital': { name: '📻 Capital FM', stream: 'https://ice-sov.musicradio.com/CapitalMP3' }
};

let currentRoomsData = {};
let globalSocket = null;

document.addEventListener('DOMContentLoaded', () => {
    // ---- DOM & DATA ----
    const authScreen = document.getElementById('auth-screen');
    const screensContainer = document.getElementById('screens-container');
    const mainNav = document.getElementById('main-nav');

    let usersDB = JSON.parse(localStorage.getItem('blindIdUsers')) || {};
    let currentUser = JSON.parse(localStorage.getItem('blindIdSession')) || null;
    let liteMode = JSON.parse(localStorage.getItem('blindIdLiteMode')) || false;
    let statsChart = null;

    // Girişte izni sadece mikrofon için istiyoruz (Blind ID standardı)
    function requestPermissions() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => console.log("Giriş izni hatası (normal):", e));
        }
    }

    // ---- INIT APP ----
    window.initApp = function () {
        if (!currentUser) {
            if (authScreen) { authScreen.classList.remove('hidden'); setTimeout(() => authScreen.classList.add('active'), 10); }
            if (screensContainer) screensContainer.classList.add('hidden');
            if (mainNav) mainNav.style.display = 'none';
        } else {
            // Apply gamification defaults
            if (currentUser.gold === undefined) currentUser.gold = 100;
            if (currentUser.hasRenamed === undefined) currentUser.hasRenamed = false;
            if (!currentUser.avatarUrl) currentUser.avatarUrl = "https://api.dicebear.com/7.x/avataaars/svg?seed=Me&backgroundColor=222";
            if (currentUser.level === undefined) currentUser.level = 1;
            if (currentUser.xp === undefined) currentUser.xp = 0;
            if (!currentUser.history) currentUser.history = [];

            if (authScreen) { authScreen.classList.remove('active'); setTimeout(() => authScreen.classList.add('hidden'), 300); }
            if (screensContainer) screensContainer.classList.remove('hidden');
            if (mainNav) mainNav.style.display = 'flex';

            applyLiteMode();
            updateProfileUI();
            updateStatsUI();
            renderHistory();
            requestPermissions();
        }
    }

    function saveUser() {
        usersDB[currentUser.username] = currentUser;
        localStorage.setItem('blindIdUsers', JSON.stringify(usersDB));
        localStorage.setItem('blindIdSession', JSON.stringify(currentUser));
        updateProfileUI();
    }

    function updateProfileUI() {
        if (!currentUser) return;
        const uText = document.getElementById('profile-username-text');
        const bioText = document.getElementById('profile-bio-text');
        const xpText = document.getElementById('user-xp');
        const progressFill = document.getElementById('xp-fill');
        const avatarImg = document.getElementById('user-avatar-img');

        if (uText) uText.innerText = currentUser.username;
        if (bioText) {
            const age = currentUser.age || 'Gizli';
            const ht = currentUser.height ? currentUser.height + 'cm' : 'Gizli';
            const wt = currentUser.weight ? currentUser.weight + 'kg' : 'Gizli';
            bioText.innerHTML = `Yaş: ${age} | Boy: ${ht} | Kilo: ${wt}<br>${currentUser.bio || 'Henüz bir bio eklenmemiş...'}`;
        }

        if (avatarImg) {
            avatarImg.src = currentUser.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.username}`;
        }

        // Level System
        const currentXP = currentUser.xp || 0;
        const level = Math.floor(currentXP / 1000) + 1;
        const xpInLevel = currentXP % 1000;

        if (document.getElementById('user-level')) document.getElementById('user-level').innerText = level;
        if (xpText) xpText.innerText = xpInLevel;
        if (progressFill) progressFill.style.width = `${(xpInLevel / 1000) * 100}%`;
    }

    window.addXP = function (amt) {
        currentUser.xp = (currentUser.xp || 0) + amt;
        saveUser();
        updateProfileUI();
    }

    function renderHistory() {
        const container = document.getElementById('recent-matches-container');
        if (!container) return;
        container.innerHTML = '';

        const validHistory = (currentUser.history || []).filter(h => h.name && h.name !== 'Anonim');

        if (validHistory.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';

        validHistory.slice(-3).forEach(h => {
            container.innerHTML += `
            <div class="history-item" onclick="premiumAlert('Geçmiş eşleşmeye tekrar bağlanmak VIP özelliğidir.')">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${h.name}&backgroundColor=111">
                <span>${h.name}</span> <i class="fa-solid fa-phone"></i>
            </div>`;
        });
    }

    window.premiumAlert = function (msg) {
        alert("💎 VIP PREMIUM: " + msg);
    }

    window.attemptRegionFilter = function () {
        if (!currentUser) return;
        const today = new Date().toDateString();
        if (currentUser.lastFreeRegionDate !== today) {
            alert("🎁 Hediyen: Günlük 1 Ücretsiz Bölge Eşleşme HAKKINI kullandın! Bölgen: " + currentUser.region);
            currentUser.lastFreeRegionDate = today;
            saveUser();
        } else {
            premiumAlert('Günlük ücretsiz hakkın bitti! Bölge filtrelemeye devam etmek için VIP olmalısın.');
        }
    }

    // ---- LITE MODE ----
    window.toggleLiteMode = function () {
        liteMode = !liteMode;
        localStorage.setItem('blindIdLiteMode', JSON.stringify(liteMode));
        applyLiteMode();
    }
    function applyLiteMode() {
        const t = document.getElementById('lite-mode-toggle');
        if (t) t.checked = liteMode;
        if (liteMode) document.body.classList.add('lite-mode');
        else document.body.classList.remove('lite-mode');
    }

    // ---- AUTH ACTIONS ----
    window.switchAuthTab = function (tab) {
        const loginForm = document.getElementById('login-form'), regForm = document.getElementById('register-form');
        const tabLogin = document.getElementById('tab-login'), tabReg = document.getElementById('tab-register');
        if (tab === 'login') {
            loginForm.classList.remove('hidden'); regForm.classList.add('hidden');
            tabLogin.classList.add('active'); tabReg.classList.remove('active');
        } else {
            loginForm.classList.add('hidden'); regForm.classList.remove('hidden');
            tabLogin.classList.remove('active'); tabReg.classList.add('active');
        }
    };
    window.doGoogleLogin = function () {
        const gUser = "Elite_" + Math.floor(Math.random() * 10000);
        if (!usersDB[gUser]) {
            usersDB[gUser] = { username: gUser, password: 'g', age: '', height: '', weight: '', region: 'Marmara', gender: 'erkek', zodiac: '', gold: 100, hasRenamed: false, avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Me", level: 1, xp: 0, history: [], dislikes: 0 };
            localStorage.setItem('blindIdUsers', JSON.stringify(usersDB));
        }
        currentUser = usersDB[gUser]; localStorage.setItem('blindIdSession', JSON.stringify(currentUser));
        initApp();
    };
    window.doRegister = function () {
        const u = document.getElementById('reg-username').value.trim(); const p = document.getElementById('reg-password').value.trim(); const r = document.getElementById('reg-region').value;
        if (!u || !p || !r) { alert('Ad, Parola ve Bölge zorunlu!'); return; }
        if (usersDB[u]) { alert('Bu isim alınmış!'); return; }

        const genderEl = document.querySelector('input[name="reg-gender"]:checked');
        if (!genderEl) { alert('Cinsiyet seçimi zorunludur!'); return; }

        const ageVal = document.getElementById('reg-age').value;
        if (ageVal && parseInt(ageVal) < 18) { alert('Hata: Topluluk kuralları gereği yaşınız 18 veya üzeri olmalıdır (+18).'); return; }

        const zodiac = document.getElementById('reg-zodiac')?.value || '';

        currentUser = {
            username: u, password: p, age: ageVal, height: document.getElementById('reg-height').value, weight: document.getElementById('reg-weight').value, region: r, gender: genderEl.value, zodiac: zodiac, gold: 100, hasRenamed: false, avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Me", level: 1, xp: 0, history: [], lastFreeRegionDate: null, dislikes: 0
        };
        saveUser(); initApp();
    };
    window.doLogin = function () {
        const u = document.getElementById('login-username').value.trim(), p = document.getElementById('login-password').value.trim();
        if (!u || !p) return;
        if (!usersDB[u] || usersDB[u].password !== p) { alert('Hatalı giriş!'); return; }
        currentUser = usersDB[u]; localStorage.setItem('blindIdSession', JSON.stringify(currentUser)); initApp();
    };
    window.doLogout = function () {
        currentUser = null;
        localStorage.removeItem('blindIdSession');
        window.location.reload();
    };

    // ---- STATS / BAN ----
    let stats = JSON.parse(localStorage.getItem('blindIdStats')) || { totalCalls: 0, talkTimeSeconds: 0, likes: 0, skips: 0, reports: 0, dislikes: 0, banStatus: null };
    if (stats.dislikes === undefined) stats.dislikes = 0;
    function saveStats() {
        localStorage.setItem('blindIdStats', JSON.stringify(stats));
        if (typeof checkBanLogic === 'function') checkBanLogic();
        updateStatsUI();
    }
    function checkBanLogic() {
        if (stats.totalCalls < 100 || stats.banStatus === 'perma') return;
        const rr = (stats.reports / stats.totalCalls) * 100;
        if (rr >= 50) { stats.banStatus = 'perma'; showBanScreen(); }
        else if (rr >= 30 && stats.banStatus !== '1w') { stats.banStatus = '1w'; showBanScreen(); }
    }
    function showBanScreen() {
        if (!currentUser) return;
        document.getElementById('ban-screen')?.classList.remove('hidden');
        document.getElementById('ban-screen')?.classList.add('active');
    }
    window.addMockStats = function () {
        stats.totalCalls += 10; stats.talkTimeSeconds += Math.floor(Math.random() * 500) + 100;
        for (let i = 0; i < 10; i++) { const r = Math.random(); if (r < 0.5) stats.likes++; else if (r < 0.8) stats.skips++; else stats.reports++; }
        stats.reports += 1; saveStats();
    };

    // ---- NAVIGATION ----
    let navHistory = ['home-screen'];
    window.navHistory = navHistory;

    window.updateBackBtnVisibility = function () {
        const backBtns = document.querySelectorAll('.global-back-btn');
        const show = navHistory.length > 1;
        backBtns.forEach(btn => btn.style.display = show ? 'flex' : 'none');
    };

    window.goBack = function () {
        // If an overlay is open, close it first
        const activeOverlay = overlayScreens.find(s => s && s.classList.contains('active'));
        if (activeOverlay) {
            hideOverlays();
            return;
        }

        if (navHistory.length > 1) {
            navHistory.pop();
            const prevTabId = navHistory[navHistory.length - 1];
            showTab(prevTabId, true);
        }
    };

    function showTab(targetId, isGoingBack = false) {
        // Ensure overlays are closed when switching tabs
        hideOverlays();

        const navItem = document.querySelector(`.nav-item[data-target="${targetId}"]`);
        if (!navItem) return;

        if (!isGoingBack) {
            if (navHistory[navHistory.length - 1] !== targetId) {
                navHistory.push(targetId);
            }
        }
        updateBackBtnVisibility();

        navItems.forEach(ni => ni.classList.remove('active'));
        navItem.classList.add('active');

        if (!navItem.classList.contains('brand-logo')) {
            navItems.forEach(ni => { if (!ni.classList.contains('brand-logo')) ni.style.color = '#555'; });
            navItem.style.color = 'var(--gold)';
        }

        const targetScreen = document.getElementById(targetId);
        if (targetScreen) {
            if (targetId === 'rooms-screen' && globalSocket) {
                globalSocket.emit('get_rooms_info');
            }
            if (targetId === 'profile-screen') {
                updateProfileUI();
                initDailyQuests();
                switchProfileTab('genel');
            }
            allScreens.forEach(s => { if (s) { s.classList.remove('active'); s.classList.add('hidden'); } });
            document.getElementById('menu-screen').classList.add('hidden');
            targetScreen.classList.remove('hidden');
            setTimeout(() => targetScreen.classList.add('active'), 10);
        }
    }

    const navItems = document.querySelectorAll('.nav-item');
    const allScreens = [document.getElementById('home-screen'), document.getElementById('rooms-screen'), document.getElementById('menu-screen'), document.getElementById('messages-screen'), document.getElementById('profile-screen')];

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.getAttribute('data-target');
            showTab(targetId);
        });
    });

    const overlayScreens = [document.getElementById('matching-screen'), document.getElementById('incall-screen'), document.getElementById('rating-screen'), document.getElementById('room-inner-screen'), document.getElementById('active-chat-screen'), document.getElementById('game-matching-screen'), document.getElementById('game-screen')];
    function showOverlay(screenToShow) {
        overlayScreens.forEach(screen => {
            if (screen) { screen.classList.remove('active'); setTimeout(() => { if (!screen.classList.contains('active')) screen.classList.add('hidden'); }, 300); }
        });
        if (screenToShow) {
            if (mainNav) mainNav.style.display = 'none';
            // Rating ekranı açıldığında yüzdeleri güncelle
            if (screenToShow.id === 'rating-screen') {
                updateRatingDisplay();
            }
            setTimeout(() => { screenToShow.classList.remove('hidden'); setTimeout(() => { screenToShow.classList.add('active'); }, 10); }, 300);
        } else {
            if (mainNav && !stats.banStatus && currentUser) mainNav.style.display = 'flex';
        }
    }
    window.hideOverlays = function () { showOverlay(null); };

    // ---- ICE BREAKER ----
    const iceBreakers = [
        "Sence en iyi pizza malzemesi nedir?", "Issız adada yanına alacağın 3 şey?", "Zaman yolculuğu mu, görünmezlik mi?", "Son izlediğin dizi neydi?", "En sevdiğin yemek nedir?"
    ];

    // ---- CALL TIMERS & MATCHING (WEBRTC INTEGRATION) ----
    let matchingInterval, activeTimerInterval, globalTimeLeft = 0, currentCallStart = 0;
    let opponentName = "Anonim";
    let webrtcClient = null;
    let roomClient = null; // Mesh Room Audio
    let lastMatchData = null;
    let matchGenderPref = 'mixed'; // Default to mixed for better match rate
    let matchRegionFilter = false;

    // Match filter functions
    window.setMatchPref = function (pref) {
        matchGenderPref = pref;
        const oppBtn = document.getElementById('filter-opposite');
        const mixBtn = document.getElementById('filter-mixed');
        if (oppBtn) oppBtn.classList.toggle('active', pref === 'opposite');
        if (mixBtn) mixBtn.classList.toggle('active', pref === 'mixed');
    }
    window.toggleRegionFilter = function () {
        matchRegionFilter = !matchRegionFilter;
        document.getElementById('filter-region').classList.toggle('active', matchRegionFilter);
        document.getElementById('filter-label-region').innerText = matchRegionFilter ? 'Bölge: Açık ✓' : 'Bölge: Kapalı';
    }

    // Sunucu adresi: Deployment'ta (Render/Railway) kendi adresini otomatik alır.
    if (window.io) {
        const srvUrl = (window.location.protocol === 'file:') ? 'http://localhost:3000' : window.location.origin;
        globalSocket = io(srvUrl, { transports: ['websocket', 'polling'], reconnection: true });

        // Initialize WebRTC Clients (Global & Ready to listen)
        webrtcClient = new AudioChatClient(globalSocket, document.getElementById('remote-audio'), () => {
            showOverlay(document.getElementById('rating-screen'));
            stopGlobalTimer();
        });

        roomClient = new RoomAudioClient(globalSocket, document.getElementById('audio-container'), {
            onParticipants: (users) => {
                window.activeRoomParticipants = users;
                updateParticipantsUI();
            },
            onUserJoined: (user) => {
                // webrtc_client.js handle's the signal, we just update UI
                updateParticipantsUI();
            },
            onUserLeft: (data) => {
                // webrtc_client.js handle's the removal, we update UI
                updateParticipantsUI();
            }
        });
        // Mesaj Alma (Soket üzerinden)
        globalSocket.on('receive_message', (data) => {
            const container = document.getElementById('chat-messages-container');
            if (container) {
                container.innerHTML += `<div class="chat-bubble them"><span>${data.text}</span></div>`;
                container.scrollTop = container.scrollHeight;
            }
        });

        // Oda Mesajlarını Al
        globalSocket.on('receive_room_message', (data) => {
            // Eğer mesaj benden geliyorsa ve zaten ekranda varsa ekleme (Local Echo çakışması önleme)
            if (data.senderId === globalSocket.id && document.getElementById(`msg-${data.msgId}`)) return;
            addRoomMessage(data);
        });

        // Mesaj Ekleme Yardımcısı (Like/Report Butonları ile)
        window.addRoomMessage = function (data) {
            const container = document.getElementById('room-messages-container');
            if (!container) return;
            const isMe = data.senderId === globalSocket.id;
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const msgId = data.msgId || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

            const msgHtml = `
                <div class="chat-bubble ${isMe ? 'me' : 'them'}" id="${msgId}">
                    <div style="font-size:0.6rem; font-weight:800; opacity:0.6; margin-bottom:2px; display:flex; justify-content:space-between;">
                        <span>${data.username} • ${timeStr}</span>
                        ${!isMe ? `<div class="chat-actions">
                            <button class="action-btn like" onclick="likeMessage(this)"><i class="fa-solid fa-heart"></i></button>
                            <button class="action-btn report" onclick="reportMessage('${data.username}')"><i class="fa-solid fa-triangle-exclamation"></i></button>
                        </div>` : ''}
                    </div>
                    <span>${data.text}</span>
                </div>
            `;
            container.innerHTML += msgHtml;
            container.scrollTop = container.scrollHeight;
        };

        // --- PARTICIPANTS LOGIC ---
        window.activeRoomParticipants = [];

        window.updateParticipantsUI = function () {
            const countEl = document.getElementById('room-users-count');
            const listContainer = document.getElementById('participants-container');
            const gridContainer = document.getElementById('room-participants-grid');

            const participants = window.activeRoomParticipants || [];

            if (countEl) countEl.innerText = participants.length;

            // Update Side List (Standard)
            if (listContainer) {
                listContainer.innerHTML = '';
                if (participants.length === 0) {
                    listContainer.innerHTML = '<div style="padding:10px; font-size:0.7rem; color:#aaa; text-align:center;">Kimse yok.</div>';
                } else {
                    participants.forEach(p => {
                        const avatar = p.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.username}`;
                        listContainer.innerHTML += `
                            <div class="participant-item">
                                <img src="${avatar}">
                                <span>${p.username} ${p.id === globalSocket.id ? '(Sen)' : ''}</span>
                            </div>
                        `;
                    });
                }
            }

            // Update Grid Layer (Premium)
            if (gridContainer) {
                gridContainer.innerHTML = '';
                participants.forEach(p => {
                    const avatar = p.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.username}`;
                    gridContainer.innerHTML += `
                        <div style="text-align:center;">
                            <img src="${avatar}" class="speaker-avatar-${p.id}" style="width:45px; height:45px; border-radius:50%; border:2px solid ${p.id === globalSocket.id ? 'var(--gold)' : 'rgba(255,255,255,0.2)'}; transition: all 0.3s;" onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${p.username}'">
                            <div style="font-size:0.6rem; color:white; margin-top:5px; max-width:50px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.username}</div>
                        </div>
                    `;
                });
            }
        };

        window.toggleParticipantsList = function () {
            const panel = document.getElementById('participants-list-panel');
            if (panel) panel.classList.toggle('hidden');
        };

        // Mesaj Etkileşimleri
        window.likeMessage = function (btn) {
            btn.style.color = '#ff4757';
            btn.classList.add('fa-beat');
            setTimeout(() => btn.classList.remove('fa-beat'), 500);
        };
        window.reportMessage = function (user) {
            if (confirm(`${user} kullanıcısını şikayet etmek istiyor musunuz?`)) {
                alert("Şikayetiniz modaratörlere iletildi. Teşekkürler.");
            }
        };

        // Saatlik Mesaj Temizliği (Hafıza Dostu)
        setInterval(() => {
            const container = document.getElementById('room-messages-container');
            if (container) {
                container.innerHTML = '<div class="chat-bubble them"><span>Sistem: Mesaj geçmişi temizlendi (Hafıza Tasarrufu).</span></div>';
            }
        }, 3600000); // 1 Saat (3600*1000)
        // --- ROOM & GAME INFO LISTENERS ---

        globalSocket.on('receive_rooms_info', (data) => {
            currentRoomsData = data;
            // Odaların yanındaki toplam sayıları da güncelle
            for (const rId in data) {
                const countEl = document.getElementById(`room-count-${rId}`);
                if (countEl) countEl.innerText = data[rId].userCount;
            }
            console.log("Oda bilgileri alındı (Detaylı):", data);
            const radioList = document.getElementById('radio-rooms-list');
            const vipList = document.getElementById('vip-rooms-list');
            const normalList = document.getElementById('normal-rooms-list');

            if (!radioList || !vipList || !normalList) return;

            radioList.innerHTML = '';
            vipList.innerHTML = '';
            normalList.innerHTML = '';

            const roomEntries = Object.entries(data);
            if (roomEntries.length === 0) {
                const emptyMsg = '<div style="text-align:center; padding:50px; color:#666; font-weight:700;">Henüz aktif oda bulunamadı veya sunucuya bağlanılamadı.</div>';
                radioList.innerHTML = emptyMsg;
                vipList.innerHTML = emptyMsg;
                normalList.innerHTML = emptyMsg;
                return;
            }

            roomEntries.forEach(([id, room]) => {
                const card = document.createElement('div');
                card.className = "room-card";
                card.setAttribute('data-name', room.name.toLowerCase());

                if (room.vip) card.style.borderLeft = "4px solid var(--gold)";
                else if (room.radio) card.style.borderLeft = "4px solid var(--primary)";

                card.innerHTML = `
                    <div class="room-info">
                        <h3>${room.name}</h3>
                        <p>${room.vip ? '🏅 VIP Odası' : (room.radio ? '📻 Müzik & Sohbet' : '👥 Genel Sohbet')}</p>
                    </div>
                    <div class="room-stats">
                        <div class="member-count"><span id="room-count-${id}">${room.userCount || 0}</span>/${room.cap} <i class="fa-solid fa-user"></i></div>
                    </div>
                `;

                if (room.radio) {
                    card.onclick = () => joinRadioRoom(id);
                    radioList.appendChild(card);
                } else if (room.vip) {
                    card.onclick = () => joinVipRoom(id);
                    vipList.appendChild(card);
                } else {
                    card.onclick = () => joinRoom(id);
                    normalList.appendChild(card);
                }
            });
            console.log(`${roomEntries.length} adet oda başarıyla yüklendi.`);
        });

        window.filterRooms = function (val) {
            const query = val.toLowerCase();
            document.querySelectorAll('.room-card').forEach(card => {
                const name = card.getAttribute('data-name') || '';
                card.style.display = name.includes(query) ? 'flex' : 'none';
            });
        }

        globalSocket.on('games_info_update', (gamesInfo) => {
            for (const gId in gamesInfo) {
                const countEl = document.getElementById(`game-count-${gId}`);
                if (countEl) countEl.innerText = `${gamesInfo[gId].active * 2 + gamesInfo[gId].waiting} Aktif`;
            }
        });

        globalSocket.on('connect', () => {
            console.log('Soket Bağlandı! ID:', globalSocket.id);
            globalSocket.emit('get_rooms_info');
        });

        // Gerçek Sunucudan "Eşleşme Bulundu" Sinyali Geldiğinde:
        globalSocket.on('match_found', (data) => {
            console.log("Sunucudan eşleşme geldi! Hedef:", data.opponentId);
            lastMatchData = data;
            clearTimeout(matchingInterval);
            if (window.busyTimeout) clearTimeout(window.busyTimeout);

            // Arama sesini durdur
            const ringing = document.getElementById('dial-ringing');
            if (ringing) { ringing.pause(); ringing.currentTime = 0; }

            // 5 Saniye Geri Sayım Arayüzü
            const statusText = document.getElementById('match-status-text');
            const countdownEl = document.getElementById('connect-countdown');
            const matchAvatar = document.getElementById('match-avatar');
            const matchUser = document.getElementById('match-username');

            if (matchAvatar) matchAvatar.parentElement.style.display = 'block';
            if (matchUser) {
                matchUser.style.display = 'block';
                matchUser.innerText = "Gizli Kullanıcı"; // Veya data.username
            }

            // Butonları göster
            const skipBtn = document.getElementById('skip-btn');
            const acceptBtn = document.getElementById('accept-btn');
            if (skipBtn) skipBtn.parentElement.style.display = 'block';
            if (acceptBtn) acceptBtn.parentElement.style.display = 'block';

            if (statusText) statusText.innerText = "Eşleşme Bulundu!";

            // Görşme kartında bilgi göster
            if (matchUser) {
                let infoText = data.oppUsername || 'Gizli Kullanıcı';
                if (data.oppAge) infoText += ` | ${data.oppAge} yaş`;
                if (data.oppRegion) infoText += ` | ${data.oppRegion}`;
                if (data.oppZodiac) infoText += ` | ${data.oppZodiac}`;
                matchUser.innerText = infoText;
            }
            if (countdownEl) {
                countdownEl.classList.remove('hidden');
                let matchCount = 5;
                countdownEl.innerText = matchCount;

                if (window.matchInterval) clearInterval(window.matchInterval);
                window.matchInterval = setInterval(() => {
                    matchCount--;
                    countdownEl.innerText = matchCount;
                    if (matchCount <= 0) {
                        clearInterval(window.matchInterval);
                        countdownEl.classList.add('hidden');
                        enterInCall(data);
                    }
                }, 1000);
            } else {
                enterInCall(data);
            }
        });

        // 5s Eşleşme Ekranı Butonları
        document.getElementById('accept-btn')?.addEventListener('click', () => {
            if (window.matchInterval) {
                clearInterval(window.matchInterval);
                document.getElementById('connect-countdown')?.classList.add('hidden');
                // Hemen gir (Beklemeyi atla)
                if (lastMatchData) enterInCall(lastMatchData);
            }
        });

        document.getElementById('skip-btn')?.addEventListener('click', () => {
            if (window.matchInterval) clearInterval(window.matchInterval);
            if (webrtcClient) webrtcClient.hangUp();
            hideOverlays();
            location.reload();
        });

        async function enterInCall(data) {
            console.log("🚀 Görüşmeye giriliyor...", data.role);
            showOverlay(document.getElementById('incall-screen'));
            currentCallStart = Date.now();

            // Kritik: Mikrofonu her iki taraf için de uyandır
            if (webrtcClient) {
                const micOk = await webrtcClient.requestMicrophone();
                if (!micOk) {
                    console.error("❌ Mikrofon alınamadı, görüşme sessiz geçebilir.");
                }

                if (data.role === 'caller') {
                    console.log("📞 Arayan rolü: startCall başlatılıyor.");
                    webrtcClient.startCall(data.opponentId);
                } else {
                    console.log("👂 Aranan rolü: Teklif (Offer) bekleniyor.");
                    webrtcClient.targetId = data.opponentId;
                }
            }

            const ibBox = document.getElementById('ice-breaker-box');
            const ibText = document.getElementById('ice-breaker-text');
            if (ibBox && ibText && !liteMode) {
                ibText.innerText = data.iceBreaker || iceBreakers[Math.floor(Math.random() * iceBreakers.length)];
                ibBox.classList.remove('hidden');
                setTimeout(() => { ibBox.classList.add('hidden'); }, 15000);
            }

            const opponentName = data.oppUsername || "Kullanici_" + Math.floor(Math.random() * 900);
            let callInfo = opponentName;
            if (data.oppAge) callInfo += ` | ${data.oppAge}`;
            if (data.oppRegion) callInfo += ` | ${data.oppRegion}`;
            if (data.oppZodiac) callInfo += ` | ${data.oppZodiac}`;

            const nameEl = document.getElementById('incall-username-text');
            if (nameEl) nameEl.innerText = callInfo;

            const avatarEl = document.getElementById('incall-avatar');
            if (avatarEl && data.oppAvatar) avatarEl.src = data.oppAvatar;

            startGlobalTimer(120, 'active-countdown');
        }

        // --- GÖRÜŞME İÇİ KONTROLLER ---
        document.getElementById('call-skip-btn')?.addEventListener('click', () => {
            if (webrtcClient) webrtcClient.hangUp();
            showOverlay(document.getElementById('rating-screen')); // Puanlama ekranına git
            stopGlobalTimer();
        });

        document.getElementById('call-accept-btn')?.addEventListener('click', async () => {
            // "Onayla" butonu - Bağı kurar, süreyi dondurabilir veya arkadaşlık isteği atabilir
            const btn = document.getElementById('call-accept-btn');
            btn.style.color = 'var(--green)';
            btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
            alert("Bağlantı Onaylandı! Harika gidiyorsun.");
            // webrtcClient zaten globalde tanımlı ve hazır.
            const ok = await webrtcClient.requestMicrophone();
        });


        document.getElementById('start-call-btn')?.addEventListener('click', async () => {
            try {
                if (webrtcClient) {
                    // Odayı kapat ki çakışma olmasın
                    if (window.activeRoomId) leaveRoom();

                    const micAccess = await webrtcClient.requestMicrophone();
                    if (!micAccess) return;
                } else {
                    alert("Hata: Ses sistemi hazır değil. Sayfayı yenileyin.");
                    return;
                }

                showOverlay(document.getElementById('matching-screen'));
                document.getElementById('match-status-text').innerText = "Sinyal Aranıyor...";
                document.getElementById('connect-countdown').classList.add('hidden');

                // Arayana kadar avatar, isim ve butonları gizle
                document.getElementById('match-avatar').parentElement.style.display = 'none';
                document.getElementById('match-username').style.display = 'none';
                document.getElementById('accept-btn').parentElement.style.display = 'none';
                document.getElementById('skip-btn').parentElement.style.display = 'none';

                // Sunucuya kuyruğa girme isteği at (cinsiyet, bölge, tercih bilgileriyle)
                globalSocket.emit('find_match', {
                    gender: currentUser?.gender || 'erkek',
                    region: currentUser?.region || 'Marmara',
                    preference: matchGenderPref,
                    regionFilter: matchRegionFilter,
                    age: currentUser?.age || '',
                    username: currentUser?.username || 'Anonim',
                    zodiac: currentUser?.zodiac || ''
                });

                // Arama sesini çal
                const ringing = document.getElementById('dial-ringing');
                if (ringing) ringing.play().catch(e => console.log("Ses oynatılamadı."));

                // 10 Saniye Bekleme ve Meşgul Mesajı
                if (window.busyTimeout) clearTimeout(window.busyTimeout);
                window.busyTimeout = setTimeout(() => {
                    const el = document.getElementById('match-status-text');
                    if (el && el.innerText.includes("Aranıyor")) {
                        el.innerText = "Kullanıcılar meşgul, aranıyor...";
                    }
                }, 10000);

                clearInterval(matchingInterval);
                matchingInterval = setTimeout(() => {
                    if (globalSocket.connected) {
                        // Still searching
                    } else {
                        document.getElementById('connect-countdown').innerText = "Sunucuya bağlanılamadı!";
                    }
                }, 5000);
            } catch (e) {
                alert("Arama başlatılırken kritik bir hata oluştu: " + e.message);
            }
        });

        // Eski mock skip/accept eski listener'lar kaldırıldı - yenileri satır 343-398 arasında

        function startGlobalTimer(seconds, elementId) {
            globalTimeLeft = seconds; let el = document.getElementById(elementId);
            if (el) el.innerText = globalTimeLeft;
            const circle = document.querySelector('.progress-ring__circle'); let circ = circle ? circle.r.baseVal.value * 2 * Math.PI : 0;
            if (circle) { circle.style.strokeDasharray = `${circ} ${circ}`; circle.style.strokeDashoffset = circ; }

            clearInterval(activeTimerInterval);
            activeTimerInterval = setInterval(() => {
                globalTimeLeft--; if (el) el.innerText = globalTimeLeft;
                if (circle && elementId === 'active-countdown') { circle.style.strokeDashoffset = circ - ((globalTimeLeft / 120) * circ); }
                if (globalTimeLeft <= 0) { clearInterval(activeTimerInterval); finishCall(Math.floor((Date.now() - currentCallStart) / 1000)); }
            }, 1000);
        }

        window.addTimeGlobally = function () { if (globalTimeLeft > 0) { globalTimeLeft += 120; alert("+120 Saniye uzatıldı!"); } }

        // Voice Filter Mock
        const voiceFilters = ['Normal', 'Helyum', 'Robot', 'Kalın Ses'];
        let vFilterIdx = 0;
        window.toggleVoiceFilter = function () {
            vFilterIdx = (vFilterIdx + 1) % voiceFilters.length;
            alert(`Ses Filtresi Değişti: ${voiceFilters[vFilterIdx]}`);
        }

        document.getElementById('hangup-btn')?.addEventListener('click', () => { finishCall(Math.floor((Date.now() - currentCallStart) / 1000)); });

        function finishCall(talkedDuration) {
            clearInterval(activeTimerInterval);
            // Ses bağlantısını tamamen kes
            if (webrtcClient) webrtcClient.hangUp();

            showOverlay(document.getElementById('rating-screen'));
            stats.totalCalls++; stats.talkTimeSeconds += talkedDuration;

            currentUser.xp += 50;
            if (currentUser.xp >= currentUser.level * 1000) { currentUser.xp = 0; currentUser.level++; alert("SEVİYE ATLADIN! Seviye: " + currentUser.level); }

            // Add to history
            currentUser.history.push({ name: opponentName, duration: talkedDuration });
            saveUser(); renderHistory();

            updateRatingDisplay();
            saveStats();
        }

        function updateRatingDisplay() {
            const total = (stats.likes || 0) + (stats.skips || 0);
            const likePct = total === 0 ? 0 : Math.round((stats.likes / total) * 100);
            const dislikePct = total === 0 ? 0 : Math.round((stats.skips / total) * 100);

            const lpEl = document.getElementById('rating-like-pct');
            const dpEl = document.getElementById('rating-dislike-pct');
            if (lpEl) lpEl.innerText = `%${likePct}`;
            if (dpEl) dpEl.innerText = `%${dislikePct}`;
        }

        window.rateLike = function () {
            stats.likes++;
            saveStats();
            alert("Geri bildiriminiz için teşekkürler! Harika bir eşleşmeydi. 😊");
            hideOverlays();
        }

        window.rateDislike = function () {
            stats.skips++;
            saveStats();
            alert("Üzüldük ama bir dahaki sefere daha iyisini bulacağız! 🤝");
            hideOverlays();
        }

        window.addFriend = function () {
            alert("Arkadaşlık isteği gönderildi! Profilden takip edebilirsin.");
        }

        window.showReportOptions = function () {
            const modal = document.getElementById('report-modal');
            if (modal) modal.classList.remove('hidden');
        }

        window.closeReportOptions = function () {
            const modal = document.getElementById('report-modal');
            if (modal) modal.classList.add('hidden');
        }

        window.submitReport = function (reason) {
            stats.reports++;
            saveStats();
            alert(`Raporunuz iletildi: "${reason}". Teşekkürler.`);
            closeReportOptions();
            hideOverlays();
        }

        // Call Again & Skip listeners
        document.getElementById('call-again-btn')?.addEventListener('click', () => {
            hideOverlays();
            document.getElementById('start-call-btn')?.click();
        });

        document.getElementById('skip-rating-btn')?.addEventListener('click', () => {
            hideOverlays();
        });

        function stopGlobalTimer() {
            clearInterval(activeTimerInterval);
        }

        // ---- USER AVATAR & METADATA ----
        window.showAvatarModal = function () { document.getElementById('avatar-modal').classList.remove('hidden'); }
        window.closeAvatarModal = function () { document.getElementById('avatar-modal').classList.add('hidden'); }
        let tempAvatar = "";
        window.selectAvatar = function (imgEl, seed) {
            document.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
            imgEl.classList.add('selected');
            tempAvatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`;
        }
        window.saveAvatar = function () {
            if (tempAvatar) {
                currentUser.avatarUrl = tempAvatar;
                saveUser();
                document.getElementById('user-avatar-img').src = tempAvatar;
            }
            closeAvatarModal();
        }

        // --- DAILY QUESTS SYSTEM ---
        const questPool = [
            { id: 'q1', text: "1 Eşleşme Yap", reward: 50 },
            { id: 'q2', text: "Bir Odaya Gir", reward: 20 },
            { id: 'q3', text: "Odaya Mesaj At", reward: 30 },
            { id: 'q4', text: "Süre Uzatımı Yap", reward: 100 },
            { id: 'q5', text: "Profilini Güncelle", reward: 40 },
            { id: 'q6', text: "1 Dakika Konuş", reward: 60 }
        ];

        window.initDailyQuests = function () {
            const today = new Date().toDateString();
            let savedQuests = JSON.parse(localStorage.getItem('ozder_quests') || '{}');

            if (savedQuests.date !== today) {
                // New day, new quests
                const scattered = questPool.sort(() => 0.5 - Math.random()).slice(0, 3);
                savedQuests = {
                    date: today,
                    items: scattered.map(q => ({ ...q, completed: false, claimed: false }))
                };
                localStorage.setItem('ozder_quests', JSON.stringify(savedQuests));
            }
            renderQuests(savedQuests.items);
        }

        function renderQuests(items) {
            const container = document.getElementById('quest-list');
            if (!container) return;
            container.innerHTML = '';
            items.forEach((q, idx) => {
                const div = document.createElement('div');
                div.className = 'quest-item';
                div.innerHTML = `
                <span>${q.text} (${q.completed ? '1/1' : '0/1'})</span>
                <button class="cheat-btn ${q.claimed ? 'bg-grey' : 'bg-green'}" 
                        ${!q.completed || q.claimed ? 'disabled' : ''} 
                        onclick="claimQuest(${idx})">
                    ${q.claimed ? 'Alındı' : (q.completed ? `Al (+${q.reward} \uD83E\uDE99)` : 'Kilitli')}
                </button>
            `;
                container.appendChild(div);
            });
        }

        window.claimQuest = function (idx) {
            let savedQuests = JSON.parse(localStorage.getItem('ozder_quests'));
            const q = savedQuests.items[idx];
            if (q.completed && !q.claimed) {
                q.claimed = true;
                currentUser.gold += q.reward;
                saveUser();
                localStorage.setItem('ozder_quests', JSON.stringify(savedQuests));
                renderQuests(savedQuests.items);
                alert(`Tebrikler! ${q.reward} Altın kazandınız! 💰`);
            }
        }

        window.changeUsername = function () {
            if (currentUser.hasRenamed && currentUser.gold < 100) { alert('İsim değiştirmek için 100 Altın gerekiyor!'); return; }
            const newName = prompt(currentUser.hasRenamed ? "Yeni adını gir (100 Altın):" : "İlk isim değişimi ücretsiz:");
            if (newName && newName.trim()) {
                if (usersDB[newName]) { alert('Alınmış!'); return; }
                if (currentUser.hasRenamed) currentUser.gold -= 100;
                currentUser.hasRenamed = true; delete usersDB[currentUser.username]; currentUser.username = newName.trim(); saveUser();
            }
        }

        // --- MODAL CONTROLS ---
        window.openModal = function (id) {
            const modal = document.getElementById(id);
            if (modal) {
                modal.classList.remove('hidden');
                if (id === 'edit-profile-modal') {
                    document.getElementById('edit-bio').value = currentUser.bio || "";
                    document.getElementById('edit-age').value = currentUser.age || "";
                    document.getElementById('edit-height').value = currentUser.height || "";
                    document.getElementById('edit-weight').value = currentUser.weight || "";
                }
            }
        }
        window.closeModal = function (id) {
            const modal = document.getElementById(id);
            if (modal) modal.classList.add('hidden');
        }

        window.saveProfileChanges = function () {
            if (!currentUser) return;

            const newUsername = document.getElementById('edit-username').value.trim();
            const bio = document.getElementById('edit-bio').value;
            const age = document.getElementById('edit-age').value;
            const height = document.getElementById('edit-height').value;
            const weight = document.getElementById('edit-weight').value;

            // Username Change Logic (First free, then 100 Gold)
            if (newUsername && newUsername !== currentUser.username) {
                const changes = currentUser.usernameChanges || 0;
                if (changes > 0) {
                    if (currentUser.gold < 100) {
                        alert("Kullanıcı adını tekrar değiştirmek için 100 Altın gerekiyor!");
                        return;
                    }
                    currentUser.gold -= 100;
                    alert("Kullanıcı adı 100 Altın karşılığında başarıyla güncellendi!");
                } else {
                    alert("Kullanıcı adın ilk sefer için ücretsiz olarak güncellendi!");
                }
                currentUser.username = newUsername;
                currentUser.usernameChanges = (changes + 1);
            }

            currentUser.bio = bio;
            currentUser.age = age;
            currentUser.height = height;
            currentUser.weight = weight;

            saveUser();
            updateProfileUI();
            updateGoldUI();
            closeModal('edit-profile-modal');
            alert("Profil başarıyla güncellendi! ✨");
        }

        window.saveNewPassword = function () {
            const oldP = document.getElementById('old-pass').value;
            const newP = document.getElementById('new-pass').value;
            if (oldP !== currentUser.password) { alert("Mevcut şifre yanlış!"); return; }
            if (newP.length < 4) { alert("Yeni şifre en az 4 karakter olmalı!"); return; }
            currentUser.password = newP;
            saveUser();
            closeModal('password-modal');
            alert("Şifre başarıyla güncellendi! 🔐");
        }

        window.doLogout = function () {
            if (confirm("Çıkış yapmak istediğinize emin misiniz?")) {
                localStorage.removeItem('blindIdSession');
                location.reload();
            }
        }

        window.deleteAccount = function () {
            if (confirm("DİKKAT! Hesabınızı tamamen silmek üzeresiniz. Bu işlem GERİ ALINAMAZ. Onaylıyor musunuz?")) {
                delete usersDB[currentUser.username];
                localStorage.setItem('blindIdUsers', JSON.stringify(usersDB));
                localStorage.removeItem('blindIdSession');
                alert("Hesabınız silindi. Görüşmek üzere.");
                location.reload();
            }
        }

        function updateProfileUI() {
            if (!currentUser) return;
            const uText = document.getElementById('profile-username-text');
            const bioText = document.getElementById('profile-bio-text');
            const ageText = document.getElementById('profile-age-text');
            const heightText = document.getElementById('profile-height-text');
            const weightText = document.getElementById('profile-weight-text');
            const regionText = document.getElementById('profile-region-text');
            const avatarImg = document.getElementById('user-avatar-img');

            if (uText) uText.innerText = currentUser.username;
            if (bioText) bioText.innerText = currentUser.bio || "Henüz bir bio eklenmemiş...";
            if (ageText) ageText.innerText = `Yaş: ${currentUser.age || 'Gizli'}`;
            if (heightText) heightText.innerText = `Boy: ${currentUser.height ? currentUser.height + ' cm' : 'Gizli'}`;
            if (weightText) weightText.innerText = `Kilo: ${currentUser.weight ? currentUser.weight + ' kg' : 'Gizli'}`;
            if (regionText) regionText.innerText = currentUser.region || 'Marmara';

            if (avatarImg) {
                avatarImg.src = currentUser.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.username}`;
                avatarImg.onerror = function () {
                    this.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.username}`;
                };
            }
        }
        window.updateProfileUI = updateProfileUI;
        window.addFriend = function () {
            if (!lastMatchData) {
                alert("Eklenecek kullanıcı bulunamadı.");
                return;
            }
            if (!currentUser.friends) currentUser.friends = [];

            const friendName = lastMatchData.oppUsername || "Anonim Kullanıcı";
            if (currentUser.friends.some(f => f.name === friendName)) {
                alert("Bu kullanıcı zaten arkadaş listenizde.");
                return;
            }

            currentUser.friends.push({
                name: friendName,
                avatar: lastMatchData.oppAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${friendName}`,
                lastSeen: new Date().toLocaleDateString()
            });

            saveUser();
            alert(`${friendName} arkadaş listenize eklendi! ✨`);
            renderFriendsInMessages();
        }

        function renderFriendsInMessages() {
            const container = document.querySelector('.message-list');
            if (!container || !currentUser.friends) return;

            // Keep existing static demo messages but prepend new friends
            const friendsHtml = currentUser.friends.map(f => `
            <div class="message-item" onclick="openDirectChat('${f.name}', 'Merhaba!')">
                <img src="${f.avatar}" alt="User">
                <div class="msg-content">
                    <div class="msg-top"><h4>${f.name}</h4><span class="time">${f.lastSeen}</span></div>
                    <p>Artık arkadaşsınız, selam de!</p>
                </div>
            </div>
        `).join('');

            // For now, let's keep the static ones too for a "full" look
            const staticItems = `
             <div class="message-item unread" onclick="openDirectChat('Gizem', 'Aynen dünkü konuşma çok iyiydi :D')">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Gizem" alt="User">
                <div class="msg-content">
                    <div class="msg-top"><h4>gizemesr</h4><span class="time">10 dk</span></div>
                    <p>Aynen dünkü konuşma çok iyiydi :D</p>
                </div>
                <div class="unread-badge">1</div>
            </div>
        `;
            container.innerHTML = friendsHtml + staticItems;
        }
        // Real updateStatsUI is at the end of the file.

        document.getElementById('skip-rating-btn')?.addEventListener('click', () => {
            hideOverlays();
            showTab('home-screen');
        });
        document.getElementById('call-again-btn')?.addEventListener('click', () => { alert("Son konuştuğun kişiyle eşleşmek (Geri Dön) VIP bir özelliktir!"); });

        // --- ROOM TABS LOGIC ---
        window.switchRoomTab = function (tabId) {
            // Toggle Buttons
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(`tab-btn-${tabId}`).classList.add('active');

            // Toggle Content
            document.querySelectorAll('.room-tab-content').forEach(content => content.classList.add('hidden'));
            document.getElementById(`tab-content-${tabId}`).classList.remove('hidden');

            // Refresh info if needed
            if (globalSocket) globalSocket.emit('get_rooms_info');
        }

        // ---- ROOMS & AUDIO MANAGEMENT ----
        // ---- ROOMS & AUDIO MANAGEMENT (WebRTC Mesh) ----
        window.activeRoomParticipants = [];
        window.activeRoomId = null;

        roomClient = null;
        window.roomMicMode = 'ptt'; // 'open' or 'ptt' - Varsayılan PTT olsun

        window.toggleRoomMicMode = function () {
            const btn = document.getElementById('room-mic-mode');
            const pttBtn = document.getElementById('ptt-button');
            const muteBtn = document.getElementById('room-mic-mute');

            if (window.roomMicMode === 'open') {
                window.roomMicMode = 'ptt';
                btn.innerText = 'Mod: Bas-Konuş';
                if (pttBtn) pttBtn.classList.remove('hidden');
                if (muteBtn) muteBtn.classList.add('hidden');
                if (roomClient) roomClient.setMuteState(true);
            } else {
                window.roomMicMode = 'open';
                btn.innerText = 'Mode: Open Mic';
                if (pttBtn) pttBtn.classList.add('hidden');
                if (muteBtn) muteBtn.classList.remove('hidden');
                if (roomClient) roomClient.setMuteState(false);
            }
        }

        // Uygulama yüklendiğinde UI'ı varsayılan moda (PTT) getir
        const modeBtn = document.getElementById('room-mic-mode');
        if (modeBtn) modeBtn.innerText = 'Mod: Bas-Konuş';
        const pttBtn = document.getElementById('ptt-button');
        if (pttBtn) pttBtn.classList.remove('hidden');
        const muteBtn = document.getElementById('room-mic-mute');
        if (muteBtn) muteBtn.classList.add('hidden');

        // PTT Listener'larını başlat
        setTimeout(() => initPTTListeners(), 500);

        // PTT Button Events
        function initPTTListeners() {
            const pttBtn = document.getElementById('ptt-button');
            if (!pttBtn) return;

            const startTalk = (e) => {
                e.preventDefault();
                if (window.roomMicMode !== 'ptt') return;
                if (roomClient) {
                    roomClient.setMuteState(false);
                    pttBtn.style.background = 'var(--primary)';
                    pttBtn.innerHTML = '🎤 TALKING...';
                    pttBtn.style.boxShadow = '0 0 30px var(--primary)';
                }
            };

            const stopTalk = (e) => {
                e.preventDefault();
                if (window.roomMicMode !== 'ptt') return;
                if (roomClient) {
                    roomClient.setMuteState(true);
                    pttBtn.style.background = 'var(--gold)';
                    pttBtn.innerHTML = '🎤 HOLD TO TALK';
                    pttBtn.style.boxShadow = '0 5px 20px rgba(186, 148, 91, 0.3)';
                }
            };

            pttBtn.addEventListener('mousedown', startTalk);
            pttBtn.addEventListener('mouseup', stopTalk);
            pttBtn.addEventListener('mouseleave', stopTalk);

            pttBtn.addEventListener('touchstart', startTalk, { passive: false });
            pttBtn.addEventListener('touchend', stopTalk, { passive: false });
        }

        window.toggleMuteUI = function (btn) {
            if (!webrtcClient) return;
            const isNowOn = webrtcClient.toggleMute();
            btn.innerHTML = isNowOn ? `<i class="fa-solid fa-microphone"></i>` : `<i class="fa-solid fa-microphone-slash"></i>`;
            btn.style.color = isNowOn ? 'var(--gold)' : 'var(--red)';
        }

        window.joinVipRoom = function (roomId) {
            if (!currentUser || (currentUser.gold || 0) < 500) {
                alert('👑 Bu oda VIP üyelere özeldir! VIP olmak için 500+ altın gerekiyor.');
                return;
            }
            joinRoom(roomId);
        }

        const officialRadios = {
            'radio_joy': { name: 'Joy FM', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_FM_SC', art: 'https://api.dicebear.com/7.x/shapes/svg?seed=joy' },
            'radio_joy_turk': { name: 'Joy Türk', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_SC', art: 'https://api.dicebear.com/7.x/shapes/svg?seed=joyturk' },
            'radio_metro': { name: 'Metro FM', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM_SC', art: 'https://api.dicebear.com/7.x/shapes/svg?seed=metro' },
            'radio_capital': { name: 'Capital FM', url: 'https://media-ice.musicradio.com/CapitalMP3', art: 'https://api.dicebear.com/7.x/shapes/svg?seed=capital' }
        };

        window.joinRadioRoom = function (radioId) {
            if (!globalSocket) return;
            const radio = officialRadios[radioId];
            if (!radio) return;

            joinRoom(radioId, true); // true = noVoice

            // UI Reset
            document.getElementById('radio-now-playing').classList.remove('hidden');
            document.getElementById('radio-player-widget').classList.remove('hidden');
            document.getElementById('room-participants-grid').classList.remove('hidden');

            document.getElementById('radio-song-title').innerText = radio.name;
            document.getElementById('radio-artist-name').innerText = 'Canlı Yayın';
            document.getElementById('radio-now-playing').innerText = `📻 ${radio.name} Bağlanıyor...`;

            // Hide microphone controls
            const micBtn = document.getElementById('room-mic-mute');
            const modeBtn = document.getElementById('room-mic-mode');
            const pttBtn = document.getElementById('ptt-button');
            if (micBtn) micBtn.classList.add('hidden');
            if (modeBtn) modeBtn.classList.add('hidden');
            if (pttBtn) pttBtn.classList.add('hidden');

            // Start Stream
            initRadioAudio(radio.url, radio.name);
        }

        function initRadioAudio(url, name) {
            let radioAudio = document.getElementById('radio-stream');
            if (!radioAudio) {
                radioAudio = document.createElement('audio');
                radioAudio.id = 'radio-stream';
                document.body.appendChild(radioAudio);
            }

            // Stop previous if any
            radioAudio.pause();
            radioAudio.src = url;
            radioAudio.load();
            radioAudio.volume = document.getElementById('radio-volume-slider').value;

            const playBtn = document.getElementById('radio-play-trigger');
            const statusText = document.getElementById('radio-now-playing');

            playBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; // Loading state

            radioAudio.play().then(() => {
                playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
                statusText.innerText = `📻 ${name} Dinleniyor...`;
            }).catch(e => {
                console.log("Autoplay blocked, user interaction needed");
                playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                statusText.innerText = `📻 ${name} (Oynat'a Basın)`;
            });

            // Error handling
            radioAudio.onerror = () => {
                statusText.innerText = `❌ Yayın hatası! Başka kanal deneyin.`;
                playBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            };
        }

        window.toggleRadioPlay = function () {
            const audio = document.getElementById('radio-stream');
            const btn = document.getElementById('radio-play-trigger');
            if (!audio) return;
            if (audio.paused) {
                audio.play();
                btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            } else {
                audio.pause();
                btn.innerHTML = '<i class="fa-solid fa-play"></i>';
            }
        }

        window.updateRadioVolume = function (val) {
            const audio = document.getElementById('radio-stream');
            if (audio) audio.volume = val;
        }


        window.joinRoom = function (roomId, noVoice = false) {
            if (!globalSocket) return;

            // Önceki eşleşme (matching) çağrılarını temizle ki mic çakışmasın
            if (webrtcClient) webrtcClient.hangUp();

            window.activeRoomId = roomId; // Mesaj gönderimi için sakla

            // Clean Room Name for Display
            let cleanName = roomId.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
            if (officialRadios[roomId]) cleanName = officialRadios[roomId].name;

            document.getElementById('room-title').innerText = cleanName;
            document.getElementById('room-participants-grid').innerHTML = '';
            const msgContainers = document.querySelectorAll('#room-messages-container');
            msgContainers.forEach(c => c.innerHTML = '');

            // Reset UI if voice was previously disabled
            const micBtn = document.getElementById('room-mic-mute');
            const modeBtn = document.getElementById('room-mic-mode');
            if (!noVoice) {
                if (micBtn) micBtn.classList.remove('hidden');
                if (modeBtn) modeBtn.classList.remove('hidden');
            }

            window.currentRoomUsers = [];

            // Önceki oda varsa temizle
            if (roomClient) {
                roomClient.leave();
                roomClient = null;
            }

            // Oda UI callback'lerini tanımla (RoomAudioClient'e geçirilecek)
            const onParticipants = (users) => {
                window.activeRoomParticipants = users;
                updateParticipantsUI();
            };
            const onUserJoined = (user) => {
                // Already handled by RoomAudioClient inner listeners
            };
            const onUserLeft = (data) => {
                // Already handled by RoomAudioClient inner listeners
            };

            if (!noVoice) {
                roomClient = new RoomAudioClient(globalSocket, document.getElementById('room-audio-container'), {
                    onParticipants,
                    onUserJoined,
                    onUserLeft
                });

                // Katılmadan ÖNCE susturma durumunu set et (Leakage önleme)
                if (window.roomMicMode === 'ptt') {
                    roomClient.setMuteState(true);
                }

                roomClient.join(roomId, { username: currentUser.username, avatarUrl: currentUser.avatarUrl, gold: currentUser.gold || 0 });
            } else {
                // Normal oda katılımı (Ses kapalıysa, örn: Radyo)
                globalSocket.emit('join_room', {
                    roomId,
                    username: currentUser.username,
                    avatarUrl: currentUser.avatarUrl,
                    gold: currentUser.gold || 0
                });
            }

            showOverlay(document.getElementById('room-inner-screen'));
        }

        window.leaveRoom = function () {
            if (roomClient) roomClient.leave();
            roomClient = null;
            // Radyo / Müzik durdur
            const radioEl = document.getElementById('radio-stream');
            if (radioEl) { radioEl.pause(); }
            if (window.radioProgressInterval) clearInterval(window.radioProgressInterval);

            document.getElementById('radio-now-playing').classList.add('hidden');
            document.getElementById('radio-player-widget').classList.add('hidden');
            document.getElementById('room-participants-grid').classList.remove('hidden');

            hideOverlays();
        }


        function addRoomSystemMessage(text) {
            const container = document.getElementById('room-messages-container');
            if (!container) return;
            const div = document.createElement('div');
            div.style.textAlign = 'center';
            div.style.margin = '10px 0';
            div.style.fontSize = '0.7rem';
            div.style.color = 'var(--gold)';
            div.style.opacity = '0.7';
            div.innerText = `— ${text} —`;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        // --- EKSİK UI FONKSİYONLARI (ReferenceError Düzeltmeleri) ---
        window.updateParticipantsUI = function () {
            const grid = document.getElementById('room-participants-grid');
            const countBadge = document.getElementById('room-users-count');
            if (!grid) return;

            grid.innerHTML = '';
            const participants = window.activeRoomParticipants || [];

            if (countBadge) countBadge.innerText = participants.length;

            participants.forEach(user => {
                const wrap = document.createElement('div');
                wrap.className = 'participant-avatar-wrap';
                wrap.innerHTML = `
                    <img src="${user.avatarUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.username}" alt="${user.username}">
                    <div class="participant-name">${user.username}</div>
                `;
                grid.appendChild(wrap);
            });
        }

        window.updateGoldUI = function () {
            if (!currentUser) return;
            const goldElements = document.querySelectorAll('.user-gold-val');
            goldElements.forEach(el => {
                el.innerText = currentUser.gold || 0;
            });
        }



        // ---- MINI GAMES SYSTEM ----
        let activeGame = null;
        let gameTimer = null;
        let gameTimeLeft = 200;
        let gameOpponentId = null;

        window.startGameMatching = function (gameId) {
            if (!globalSocket) return;
            showOverlay(document.getElementById('game-matching-screen'));
            const statusEl = document.getElementById('game-match-status');
            if (statusEl) statusEl.innerText = `${gameId.toUpperCase()} Aranıyor...`;

            // Remove busy timeout/alerts and handle everything in-app
            globalSocket.emit('find_game_match', { gameId });
        }

        window.cancelGameSearch = function () {
            hideOverlays();
            if (globalSocket) globalSocket.emit('cancel_game_match');
            showTab('home-screen');
        }

        globalSocket.on('game_match_found', (data) => {
            gameOpponentId = data.opponentId;
            console.log("Oyun eşleşmesi bulundu! Rakip:", gameOpponentId);

            hideOverlays();
            showOverlay(document.getElementById('game-screen'));

            const isCaller = data.role === 'caller';
            initGameInstance(data.gameId, isCaller);
            startGameTimer();

            // Start Voice Chat for Game
            if (webrtcClient) {
                if (isCaller) webrtcClient.startCall(gameOpponentId);
                else webrtcClient.targetId = gameOpponentId;
            }
        });

        function initGameInstance(gameId, isCaller) {
            document.getElementById('game-title-header').innerText = `${gameId.toUpperCase()} Kapışması`;
            document.getElementById('xox-board-wrapper').classList.add('hidden');
            document.getElementById('tetris-board-wrapper').classList.add('hidden');

            if (gameId === 'xox') {
                document.getElementById('xox-board-wrapper').classList.remove('hidden');
                activeGame = new XOXGame('xox-board-wrapper', isCaller, (moveIndex) => {
                    globalSocket.emit('game_move', { targetId: gameOpponentId, moveData: moveIndex, gameId: 'xox' });
                });
            } else if (gameId === 'tetris') {
                document.getElementById('tetris-board-wrapper').classList.remove('hidden');
                activeGame = new TetrisGame('tetris-canvas', 'opp-tetris-canvas', (score) => {
                    document.getElementById('my-tetris-score').innerText = score;
                    globalSocket.emit('game_score', { targetId: gameOpponentId, score: score });
                }, (trashCount) => {
                    // Send trash to opponent
                    globalSocket.emit('game_move', { targetId: gameOpponentId, moveData: { type: 'trash', count: trashCount }, gameId: 'tetris' });
                });
                activeGame.update();
            }
        }

        globalSocket.on('game_move', (data) => {
            if (!activeGame) return;
            if (activeGame instanceof XOXGame) {
                activeGame.makeMove(data.moveData, activeGame.isPlayer1 ? 'O' : 'X');
            } else if (activeGame instanceof TetrisGame) {
                if (data.moveData.type === 'trash') {
                    activeGame.addTrash(data.moveData.count);
                }
            }
        });

        globalSocket.on('game_score', (data) => {
            if (activeGame instanceof TetrisGame) {
                document.getElementById('opp-tetris-score').innerText = data.score;
                // Optionally update opponent visual board here if we want high-fidelity
            }
        });

        function startGameTimer() {
            gameTimeLeft = 200;
            clearInterval(gameTimer);
            gameTimer = setInterval(() => {
                gameTimeLeft--;
                document.getElementById('game-timer').innerText = `${gameTimeLeft}s`;
                if (gameTimeLeft <= 0) {
                    clearInterval(gameTimer);
                    quitGame();
                }
            }, 1000);
        }

        window.quitGame = function () {
            if (globalSocket && gameOpponentId) {
                globalSocket.emit('end_call', { targetId: gameOpponentId });
            }
            activeGame = null;
            clearInterval(gameTimer);
            hideOverlays();
            location.reload(); // Clean state
        }

        // ---- GOLD STORE ----
        window.openGoldStore = function () { document.getElementById('gold-store-modal').classList.remove('hidden'); }
        window.closeGoldStore = function () { document.getElementById('gold-store-modal').classList.add('hidden'); }
        window.buyGold = function (amount) {
            currentUser.gold += amount;
            alert(`${amount} Altın hesabınıza tanımlandı! Yeni bakiye: ${currentUser.gold}`);
            saveUser();
            closeGoldStore();
        }

        // ---- LEGAL MODAL ----
        window.openLegalModal = function () { document.getElementById('legal-modal').classList.remove('hidden'); }

        // ---- MESSAGING ----
        window.openDirectChat = function (name, firstMsg) {
            document.getElementById('chat-header-title').innerText = name;
            document.getElementById('chat-first-msg').innerText = firstMsg;
            showOverlay(document.getElementById('active-chat-screen'));
        }
        window.closeDirectChat = function () { hideOverlays(); }
        window.sendChatMessage = function () {
            const input = document.getElementById('chat-input-box');
            if (!input || !input.value.trim()) return;
            const msg = input.value.trim();
            const container = document.getElementById('chat-messages-container');
            container.innerHTML += `<div class="chat-bubble me"><span>${msg}</span></div>`;
            input.value = '';
            container.scrollTop = container.scrollHeight;

            if (globalSocket && webrtcClient && webrtcClient.targetId) {
                globalSocket.emit('send_message', { targetId: webrtcClient.targetId, text: msg, type: 'text' });
            }
        }

        // --- SESLI MESAJ ---
        let mediaRecorder = null;
        let audioChunks = [];
        window.startVoiceMsg = function (btn) {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
                mediaRecorder.onstop = () => {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const container = document.getElementById('chat-messages-container');
                        container.innerHTML += `<div class="chat-bubble me"><audio controls src="${reader.result}" style="max-width:200px;"></audio></div>`;
                        container.scrollTop = container.scrollHeight;
                        if (globalSocket && webrtcClient && webrtcClient.targetId) {
                            globalSocket.emit('send_message', { targetId: webrtcClient.targetId, type: 'audio', audioData: reader.result });
                        }
                    };
                    reader.readAsDataURL(blob);
                    stream.getTracks().forEach(t => t.stop());
                };
                mediaRecorder.start();
                btn.style.color = 'var(--red)';
                btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
                btn.onclick = function () { stopVoiceMsg(btn); };
            });
        }
        window.stopVoiceMsg = function (btn) {
            if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
            btn.style.color = '';
            btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
            btn.onclick = function () { startVoiceMsg(btn); };
        }

        // --- FOTOĞRAF GÖNDERME ---
        window.sendPhoto = function (ephemeral) {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onloadend = () => {
                    const container = document.getElementById('chat-messages-container');
                    const label = ephemeral ? '<div style="font-size:0.6rem; color:#ff7675; margin-bottom:3px;">🔒 Tek Kullanımlık</div>' : '';
                    container.innerHTML += `<div class="chat-bubble me">${label}<img src="${reader.result}" style="max-width:200px; border-radius:10px;"></div>`;
                    container.scrollTop = container.scrollHeight;
                    if (globalSocket && webrtcClient && webrtcClient.targetId) {
                        globalSocket.emit('send_message', { targetId: webrtcClient.targetId, type: 'photo', photoData: reader.result, ephemeral });
                    }
                };
                reader.readAsDataURL(file);
            };
            input.click();
        }

        // --- GELEN MESAJLARI İŞLE ---
        if (globalSocket) {
            globalSocket.on('receive_message', (data) => {
                const container = document.getElementById('chat-messages-container');
                if (!container) return;
                if (data.type === 'audio') {
                    container.innerHTML += `<div class="chat-bubble them"><audio controls src="${data.audioData}" style="max-width:200px;"></audio></div>`;
                } else if (data.type === 'photo') {
                    if (data.ephemeral) {
                        // Tek kullanımlık: ekran koruma + 5s sonra sil
                        const id = 'eph-' + Date.now();
                        container.innerHTML += `<div class="chat-bubble them" id="${id}" style="position:relative;"><div style="font-size:0.6rem; color:#ff7675; margin-bottom:3px;">🔒 Tek Kullanımlık - Ekran görüntüsü engellendi</div><img src="${data.photoData}" style="max-width:200px; border-radius:10px; -webkit-user-select:none; user-select:none; pointer-events:none;" oncontextmenu="return false;"><div class="ss-shield" style="position:absolute; top:0; left:0; width:100%; height:100%; background:transparent; z-index:5;"></div></div>`;
                        // 5 saniye sonra sil
                        setTimeout(() => {
                            const el = document.getElementById(id);
                            if (el) el.innerHTML = '<span style="color:#aaa; font-size:0.7rem;">🔒 Tek kullanımlık fotoğrafın süresi doldu</span>';
                        }, 5000);
                    } else {
                        container.innerHTML += `<div class="chat-bubble them"><img src="${data.photoData}" style="max-width:200px; border-radius:10px;"></div>`;
                    }
                } else {
                    container.innerHTML += `<div class="chat-bubble them"><span>${data.text}</span></div>`;
                }
                container.scrollTop = container.scrollHeight;
            });
        }

        // --- ÖZELDEN ARAMA / GÖRÜNTÜLÜ ---
        let privateCallClient = null;
        let currentCallTargetId = null;

        function initPrivateCallClient() {
            if (privateCallClient) return;
            const localV = document.getElementById('pcall-local-video');
            const remoteV = document.getElementById('pcall-remote-video');
            privateCallClient = new PrivateCallClient(globalSocket, localV, remoteV, {
                onHangup: () => {
                    document.getElementById('private-call-screen').classList.add('hidden');
                    document.getElementById('dial-ringing').pause();
                },
                onRemoteStream: (stream) => {
                    document.getElementById('pcall-status').innerText = 'Bağlandı';
                    document.getElementById('dial-ringing').pause();
                }
            });
        }


        // Incoming Call Handlers
        if (globalSocket) {
            globalSocket.on('private_call_incoming', (data) => {
                initPrivateCallClient();
                currentCallTargetId = data.callerId;
                document.getElementById('incall-p-username').innerText = data.callerName;
                document.getElementById('incall-p-avatar').src = data.callerAvatar;
                document.getElementById('incall-p-type').innerText = data.type === 'video' ? 'Görüntülü Arama' : 'Sesli Arama';
                document.getElementById('incoming-call-modal').classList.remove('hidden');
                document.getElementById('dial-ringing').play();
                privateCallClient.targetId = data.callerId; // Prepare listener
                privateCallClient.callType = data.type;
            });
        }

        window.acceptPrivateCall = function () {
            document.getElementById('incoming-call-modal').classList.add('hidden');
            document.getElementById('private-call-screen').classList.remove('hidden');
            document.getElementById('pcall-username').innerText = document.getElementById('incall-p-username').innerText;
            document.getElementById('pcall-status').innerText = 'Bağlanıyor...';

            if (privateCallClient.callType === 'video') {
                document.getElementById('pcall-video-container').classList.remove('hidden');
            } else {
                document.getElementById('pcall-video-container').classList.add('hidden');
            }

            privateCallClient.accept(currentCallTargetId, privateCallClient.callType);
        }

        window.rejectPrivateCall = function () {
            document.getElementById('incoming-call-modal').classList.add('hidden');
            document.getElementById('dial-ringing').pause();
            globalSocket.emit('private_call_reject', { targetId: currentCallTargetId });
        }

        window.hangupPrivateCall = function () {
            if (privateCallClient) privateCallClient.stop();
            document.getElementById('dial-ringing').pause();
        }

        window.refreshRooms = function (btn) {
            if (!globalSocket) return;
            btn.classList.add('fa-spin');
            globalSocket.emit('get_rooms_info');
            setTimeout(() => {
                btn.classList.remove('fa-spin');
            }, 1000);
        }

        window.dmVoiceCall = function () {
            if (!webrtcClient || !webrtcClient.targetId) {
                alert("Sohbet edilecek kullanıcı bulunamadı.");
                return;
            }
            initPrivateCallClient();
            currentCallTargetId = webrtcClient.targetId;

            document.getElementById('pcall-username').innerText = 'Sesli Arama...';
            document.getElementById('pcall-status').innerText = 'Aranıyor';
            document.getElementById('private-call-screen').classList.remove('hidden');
            document.getElementById('pcall-video-container').classList.add('hidden');
            document.getElementById('dial-ringing').play();

            globalSocket.emit('private_call_init', {
                targetId: currentCallTargetId,
                type: 'audio',
                callerName: currentUser.username,
                callerAvatar: currentUser.avatarUrl
            });
            privateCallClient.start(currentCallTargetId, 'audio');
        }

        window.dmVideoCall = function () {
            if (!webrtcClient || !webrtcClient.targetId) {
                alert("Sohbet edilecek kullanıcı bulunamadı.");
                return;
            }
            initPrivateCallClient();
            currentCallTargetId = webrtcClient.targetId;

            document.getElementById('pcall-username').innerText = 'Görüntülü Arama...';
            document.getElementById('pcall-status').innerText = 'Aranıyor';
            document.getElementById('private-call-screen').classList.remove('hidden');
            document.getElementById('pcall-video-container').classList.remove('hidden');
            document.getElementById('dial-ringing').play();

            globalSocket.emit('private_call_init', {
                targetId: currentCallTargetId,
                type: 'video',
                callerName: currentUser.username,
                callerAvatar: currentUser.avatarUrl
            });
            privateCallClient.start(currentCallTargetId, 'video');
        }


        window.switchProfileTab = function (tabName) {
            document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.add('hidden'));
            document.querySelectorAll('.p-tab-btn').forEach(b => b.classList.remove('active'));
                    const target = document.getElementById(`p-content-${tabName}`);
            const btn = document.getElementById(`p-tab-${tabName}`);

            if (target) target.classList.remove('hidden');
            if (btn) btn.classList.add('active');

            if (tabName === 'stats') {
                setTimeout(() => updateStatsUI(), 100);
            }
        }

        window.addMockStats = function () {
            stats.totalCalls += 10;
            stats.likes += 6;
            stats.dislikes += 2;
            stats.skips += 2;
            stats.talkTimeSeconds += 1200;
            saveStats();
            updateStatsUI();
            alert("Mock veriler pırıl pırıl eklendi! ✨");
        }

        let trendChart = null;
        let mixChart = null;
        let gaugeChart = null;

        function updateStatsUI() {
            if (!stats) return;
            if (typeof Chart === "undefined") return;

            const callCount = stats.totalCalls || 0;
            const totalInteraction = (stats.likes || 0) + (stats.dislikes || 0) + (stats.reports || 0);

            // Metrics
            const likePct = totalInteraction > 0 ? ((stats.likes / totalInteraction) * 100).toFixed(0) : 0;
            const completionPct = callCount > 0 ? 92 : 0; 
            const avgDuration = callCount > 0 ? Math.floor(stats.talkTimeSeconds / callCount) : 0;
            const reportPct = totalInteraction > 0 ? ((stats.reports / totalInteraction) * 100).toFixed(1) : 0;
            const trustScore = (100 - ((stats.reports || 0) * 8) - ((stats.dislikes || 0) * 0.5)).toFixed(0);

            // UI Elements
            const mapping = {
                'stat-like-ratio': `%${likePct} Beğeni`,
                'stat-completion': `%${completionPct} Tamamlama`,
                'stat-talk-time': `${avgDuration}s`,
                'stat-report-rate': `%${reportPct}`,
                'trust-score': `%${trustScore}`
            };

            for (const id in mapping) {
                const el = document.getElementById(id);
                if (el) el.innerText = mapping[id];
            }

            const bar = document.getElementById('trust-bar-fill');
            if (bar) bar.style.width = `${Math.max(10, trustScore)}%`;

            const statusChip = document.getElementById('stat-status-chip');
            if (statusChip) {
                if (parseFloat(reportPct) > 5) {
                    statusChip.innerText = "UYARI"; statusChip.style.color = "var(--red)"; statusChip.style.borderColor = "var(--red)";
                } else {
                    statusChip.innerText = "GÜVENLİ"; statusChip.style.color = "#00b894"; statusChip.style.borderColor = "#00b894";
                }
            }

            // Charts
            try {
                const trendCtx = document.getElementById('activityTrendChart');
                if (trendCtx) {
                    if (trendChart) trendChart.destroy();
                    trendChart = new Chart(trendCtx, {
                        type: 'line',
                        data: {
                            labels: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
                            datasets: [{
                                label: 'Görüşme',
                                data: [15, 25, 20, 35, 30, 45, 40],
                                borderColor: '#00d2ff', backgroundColor: 'rgba(0, 210, 255, 0.1)',
                                fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                                   scales: { x: { grid: { display:false }, ticks:{ color:'#888', font:{size:9} } }, y:{ display:false } } }
                    });
                }
                const mixCtx = document.getElementById('interactionMixChart');
                if (mixCtx) {
                    if (mixChart) mixChart.destroy();
                    mixChart = new Chart(mixCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['Like', 'Dislike', 'Report'],
                            datasets: [{
                                data: [stats.likes||1, stats.dislikes||0, stats.reports||0],
                                backgroundColor: ['#BA945B', '#444', '#ff4757'],
                                borderWidth: 0, cutout: '75%'
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                    });
                }
                const gaugeCtx = document.getElementById('completionGaugeChart');
                if (gaugeCtx) {
                    if (gaugeChart) gaugeChart.destroy();
                    gaugeChart = new Chart(gaugeCtx, {
                        type: 'doughnut',
                        data: {
                            datasets: [{
                                data: [completionPct, 100 - completionPct],
                                backgroundColor: ['#00b894', 'rgba(255,255,255,0.05)'],
                                borderWidth: 0, circumference: 180, rotation: 270, cutout: '85%'
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                    });
                }
            } catch (e) { console.error("Chart Error:", e); }
        }

        window.togglePCallMute = function (btn) {
            if (privateCallClient && privateCallClient.localStream) {
                const track = privateCallClient.localStream.getAudioTracks()[0];
                track.enabled = !track.enabled;
                btn.innerHTML = track.enabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
                btn.style.color = track.enabled ? '' : 'var(--red)';
            }
        }

        window.togglePCallVideo = function (btn) {
            if (privateCallClient && privateCallClient.localStream) {
                const track = privateCallClient.localStream.getVideoTracks()[0];
                if (track) {
                    track.enabled = !track.enabled;
                    btn.innerHTML = track.enabled ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
                    btn.style.color = track.enabled ? '' : 'var(--red)';
                }
            }
        }

        // --- USER INTERACTIONS ---

        window.setMatchPref = function (pref) {
            currentUser.matchPref = pref;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            if (pref === 'opposite') {
                document.getElementById('filter-opposite').classList.add('active');
            } else {
                document.getElementById('filter-mixed').classList.add('active');
            }
            localStorage.setItem('blindIdSession', JSON.stringify(currentUser));
            if (globalSocket) globalSocket.emit('update_preference', { matchPref: pref });
        }

        window.toggleRegionFilter = function () {
            currentUser.regionFilter = !currentUser.regionFilter;
            const lbl = document.getElementById('filter-label-region');
            if (lbl) lbl.innerText = `Bölge: ${currentUser.regionFilter ? 'Açık' : 'Kapalı'}`;
            document.getElementById('filter-region').classList.toggle('active', currentUser.regionFilter);
            localStorage.setItem('blindIdSession', JSON.stringify(currentUser));
        }

        window.startVisualSearch = function () {
            const overlay = document.getElementById('visual-search-overlay');
            const status = document.getElementById('scan-status-text');
            const log = document.getElementById('scan-log-text');

            if (!overlay) return;
            overlay.classList.remove('hidden');

            const phases = [
                "Biyometrik Veriler Analiz Ediliyor...",
                "Elite Veritabanı Sorgulanıyor...",
                "Yüz Hatları Eşleştiriliyor (AI)...",
                "Optimal Partner Bulundu!"
            ];

            let i = 0;
            const interval = setInterval(() => {
                status.innerText = phases[i];
                log.innerHTML += `SCAN_LOG: ID_${Math.random().toString(36).substr(2, 5).toUpperCase()} MATCHED...<br>`;
                i++;
                if (i >= phases.length) {
                    clearInterval(interval);
                    setTimeout(() => {
                        overlay.classList.add('hidden');
                        log.innerHTML = "";
                        // Simüle bir eşleşme profili aç
                        currentUser.xp += 50; // XP ödülü
                        saveUser();
                        alert("🔍 Görsel Analiz Tamamlandı! \nSana en uygun Elite üye bulundu. Profiline yönlendiriliyorsun...");
                        // Burada başka birinin profilini açabiliriz:
                        // window.viewProfile('Elite_Expert');
                    }, 1000);
                }
            }, 1200);
        }
        window.sendRoomMessage = function () {

            const input = document.getElementById('room-input-box');
            if (!input || !input.value.trim()) return;
            const msg = input.value.trim();

            // Sunucuya gönder - Mevcut oda ID'sini kullan
            const rId = window.activeRoomId || (roomClient ? roomClient.roomId : null);

            if (globalSocket && rId) {
                const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                const payload = {
                    roomId: rId,
                    text: msg,
                    username: currentUser.username,
                    msgId: msgId
                };

                // Local Echo: Sunucudan önce ekrana bas
                addRoomMessage({
                    senderId: globalSocket.id,
                    text: msg,
                    username: currentUser.username,
                    msgId: msgId
                });

                globalSocket.emit('send_room_message', payload);
            } else {
                alert("Bağlantı hatası: Sunucuya bağlanılamadı.");
            }

            input.value = '';
        }
    } // end window.io

    initApp();
    initPTTListeners();
});

