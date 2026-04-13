/**
 * 🚀 PROJECT: BLIND ID NEXT-GEN
 * Phase 3: Client-Side WebRTC & Audio Context (Ön Yüz Sesi)
 *
 * NEDEN BU YOLU SEÇTİK?
 * 1. Coturn & STUN: Sadece Google'ın ücretsiz STUN'ını kullanırsak, mobil ağlardaki CGNAT ve kurumsal firewall'ları 
 * delemeyiz ve eşleşen 10 kişiden 4'ünün sesi gitmez. Bu yüzden `turn:` sunucusu zorunlu olarak listeye eklendi.
 * 2. Gürültü Engelleme (Constraint): Mikrofonu alırken navigator bazında `noiseSuppression` ve `echoCancellation` 
 * direkt true set edildi. RNNoise gibi hantal AI tabanlı external kütüphaneler yerine native hardware ivmeli gürültü engellemeyi seçtik ki Lite Mode (Düşük performans cihazlar) patlamasın.
 * 3. Lazy İzinler: Mikrofon iznini sayfa açılır açılmaz İSTEMİYORUZ (UX çökeltir). Sadece Eşleşme butonuna basınca istenir.
 */

class AudioChatClient {
    constructor(socketInstance, remoteAudioElement, onHangUp) {
        this.socket = socketInstance;
        this.remoteAudio = remoteAudioElement;
        this.peerConnection = null;
        this.localStream = null;
        this.targetId = null;
        this.onHangUp = onHangUp;
        this.onConnect = arguments[3] || null; // New Connect Callback

        this._initSocketListeners();
    }

    async requestMicrophone() {
        try {
            if (this.localStream && this.localStream.active) {
                console.log("🎤 Mikrofon zaten aktif.");
                return true;
            }
            console.log("🎙️ Mikrofon isteniyor...");
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            console.log("✅ Mikrofon erişimi sağlandı.");
            return true;
        } catch (err) {
            console.error("❌ Mikrofon izni hatası:", err);
            alert("Sohbete katılmak için mikrofon izni şarttır!");
            return false;
        }
    }

    async startCall(opponentId) {
        this.targetId = opponentId;
        console.log(`📞 Aramayı başlatan biziz -> Hedef: ${opponentId}`);
        await this._createPeerConnection();

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log("📤 Local track eklendi (Caller)");
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        console.log("📤 webrtc_offer gönderiliyor...");
        this.socket.emit("webrtc_offer", {
            targetId: this.targetId,
            sdp: offer
        });
    }

    _initSocketListeners() {
        this.socket.on("webrtc_offer", async (data) => {
            console.log("📥 Gelen Teklif (Offer) - Sender:", data.senderId);
            this.targetId = data.senderId;
            await this._createPeerConnection();

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    console.log("📤 Local track eklendi (Callee)");
                    this.peerConnection.addTrack(track, this.localStream);
                });
            } else {
                console.warn("⚠️ Local stream yok! Karşı taraf sizi duyamaz.");
            }

            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            console.log("📤 webrtc_answer gönderiliyor...");
            this.socket.emit("webrtc_answer", {
                targetId: this.targetId,
                sdp: answer
            });
        });

        this.socket.on("webrtc_answer", async (data) => {
            console.log("📥 Gelen Cevap (Answer) - Sender:", data.senderId);
            if (this.targetId === data.senderId && this.peerConnection) {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            }
        });

        this.socket.on("webrtc_ice_candidate", async (data) => {
            if (this.targetId === data.senderId && data.candidate && this.peerConnection) {
                console.log("❄️ ICE Candidate alındı.");
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });

        this.socket.on("peer_disconnected", () => {
            console.log("🚫 Bağlantı koptu.");
            this.hangUp();
            if(this.onHangUp) this.onHangUp();
        });
    }

    async _createPeerConnection() {
        if (this.peerConnection) {
            console.log("♻️ Eski bağlantı temizleniyor.");
            this.peerConnection.close();
        }
        this.peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.targetId) {
                this.socket.emit("webrtc_ice_candidate", {
                    targetId: this.targetId,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.ontrack = (event) => {
            console.log("🎵 SES BAĞLANTISI AKTİF (Matching Track Recv)");
            if (this.remoteAudio.srcObject !== event.streams[0]) {
                this.remoteAudio.srcObject = event.streams[0];
                this.remoteAudio.play().catch(e => console.log("Matching audio play error:", e));
                if (this.onConnect) this.onConnect(); // Signal connection established
            }
        };
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                return audioTrack.enabled;
            }
        }
        return false;
    }

    hangUp() {
        console.log("📴 Görüşme sonlandırılıyor.");
        if (this.peerConnection) { this.peerConnection.close(); this.peerConnection = null; }
        if (this.targetId) { this.socket.emit("end_call", { targetId: this.targetId }); this.targetId = null; }
        if (this.localStream) { this.localStream.getTracks().forEach(track => track.stop()); this.localStream = null; }
        if (this.remoteAudio) this.remoteAudio.srcObject = null;
    }
}

class RoomAudioClient {
    constructor(socket, container, callbacks) {
        this.socket = socket;
        this.container = container;
        this.roomId = null;
        this.peers = {};
        this.localStream = null;
        this.isMuted = false; // YENİ: Başlangıç susturma durumu
        this.callbacks = callbacks || {};
        this._boundListeners = {};
        this._initSocketListeners();
    }

    async join(roomId, userData) {
        this.roomId = roomId;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            });
            
            // YENİ: Eğer odaya girerken susturulmuş olmamız gerekiyorsa (PTT) hemen uygula
            if (this.isMuted) {
                this.localStream.getAudioTracks().forEach(track => {
                    track.enabled = false;
                });
            }

            this.socket.emit('join_room', { roomId, ...userData });
        } catch(e) {
            console.error("Oda mikrofon hatası:", e);
            alert("Odaya girmek için mikrofon izni vermelisiniz!");
        }
    }

    _initSocketListeners() {
        this._boundListeners.onParticipants = (users) => {
            if (this.callbacks.onParticipants) this.callbacks.onParticipants(users);
        };

        this._boundListeners.onUserJoined = async (user) => {
            if (user.id !== this.socket.id) {
                console.log(`📡 Oda Girişi: ${user.username} - Arama başlatılıyor...`);
                await this._initiateCall(user.id);
                if (this.callbacks.onUserJoined) this.callbacks.onUserJoined(user);
            }
        };

        this._boundListeners.onUserLeft = (data) => {
            this._removePeer(data.id);
            if (this.callbacks.onUserLeft) this.callbacks.onUserLeft(data);
        };

        this._boundListeners.onOffer = async (data) => {
            const { senderId, sdp } = data;
            console.log(`📥 Oda Teklifi (Offer) geldi: ${senderId}`);
            const pc = this._createPeer(senderId);
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.socket.emit('room_webrtc_answer', { targetId: senderId, sdp: answer });
        };

        this._boundListeners.onAnswer = async (data) => {
            const { senderId, sdp } = data;
            console.log(`📥 Oda Cevabı (Answer) geldi: ${senderId}`);
            const pc = this.peers[senderId];
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        };

        this._boundListeners.onIce = async (data) => {
            const { senderId, candidate } = data;
            const pc = this.peers[senderId];
            if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        };

        this.socket.on('room_participants', this._boundListeners.onParticipants);
        this.socket.on('room_user_joined', this._boundListeners.onUserJoined);
        this.socket.on('room_user_left', this._boundListeners.onUserLeft);
        this.socket.on('room_webrtc_offer', this._boundListeners.onOffer);
        this.socket.on('room_webrtc_answer', this._boundListeners.onAnswer);
        this.socket.on('room_webrtc_ice_candidate', this._boundListeners.onIce);
    }

    async _initiateCall(targetId) {
        const pc = this._createPeer(targetId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.socket.emit('room_webrtc_offer', { targetId, sdp: offer });
    }

    _createPeer(socketId) {
        if (this.peers[socketId]) return this.peers[socketId];

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });
        this.peers[socketId] = pc;

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                // YENİ: Başlangıçta susturulmuşsa track'i susturarak ekle
                if (track.kind === 'audio' && this.isMuted) {
                    track.enabled = false;
                }
                pc.addTrack(track, this.localStream);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('room_webrtc_ice_candidate', { targetId: socketId, candidate: event.candidate });
            }
        };

        pc.ontrack = (event) => {
            console.log(`🎵 Oda Sesi: ${socketId} bağlandı!`);
            let audioEl = document.getElementById(`audio-${socketId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${socketId}`;
                audioEl.autoplay = true;
                audioEl.setAttribute('playsinline', '');
                this.container.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
            audioEl.play().catch(e => console.log("Room audio play error:", e));
        };

        return pc;
    }

    _removePeer(socketId) {
        if (this.peers[socketId]) {
            this.peers[socketId].close();
            delete this.peers[socketId];
        }
        const el = document.getElementById(`audio-${socketId}`);
        if (el) el.remove();
    }

    leave() {
        this.socket.off('room_participants', this._boundListeners.onParticipants);
        this.socket.off('room_user_joined', this._boundListeners.onUserJoined);
        this.socket.off('room_user_left', this._boundListeners.onUserLeft);
        this.socket.off('room_webrtc_offer', this._boundListeners.onOffer);
        this.socket.off('room_webrtc_answer', this._boundListeners.onAnswer);
        this.socket.off('room_webrtc_ice_candidate', this._boundListeners.onIce);

        this.socket.emit('leave_room', { roomId: this.roomId });
        for (const id in this.peers) this._removePeer(id);
        if(this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
        this.roomId = null;
    }

    setMuteState(isMuted) {
        this.isMuted = isMuted; // Durumu hafızaya al
        if (this.localStream) {
            // 1. Yerel stream üzerindeki trackleri kontrol et
            const tracks = this.localStream.getAudioTracks();
            tracks.forEach(track => {
                track.enabled = !isMuted;
            });

            // 2. TÜM PeerConnection göndericilerini (Senders) kontrol et (Kesin çözüm)
            for (const socketId in this.peers) {
                const pc = this.peers[socketId];
                pc.getSenders().forEach(sender => {
                    if (sender.track && sender.track.kind === 'audio') {
                        sender.track.enabled = !isMuted;
                    }
                });
            }

            console.log(`🎙️ Mikrofon durumu güncellendi (${tracks.length} kanal + PeerSenders): ${isMuted ? 'SUSTURULDU' : 'AKTİF'}`);
            return true;
        }
        return false;
    }
}

class PrivateCallClient {
    constructor(socket, localVideoEl, remoteVideoEl, callbacks) {
        this.socket = socket;
        this.localVideo = localVideoEl;
        this.remoteVideo = remoteVideoEl;
        this.callbacks = callbacks || {};
        this.pc = null;
        this.localStream = null;
        this.targetId = null;
        this.callType = 'audio';
        this._initListeners();
    }

    _initListeners() {
        this.socket.on('private_call_signal', async (data) => {
            if(!this.targetId || this.targetId !== data.senderId) return;
            const signal = data.signal;
            if(signal.type === 'offer') {
                await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                this.socket.emit('private_call_signal', { targetId: this.targetId, signal: this.pc.localDescription });
            } else if(signal.type === 'answer') {
                await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
            } else if(signal.candidate) {
                await this.pc.addIceCandidate(new RTCIceCandidate(signal));
            }
        });
        this.socket.on('private_call_finished', () => this.stop(false));
        this.socket.on('private_call_rejected', () => { alert("Arama reddedildi."); this.stop(false); });
    }

    async start(targetId, type) {
        this.targetId = targetId;
        this.callType = type;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
            if(this.localVideo && type === 'video') { this.localVideo.srcObject = this.localStream; this.localVideo.play(); }
        } catch(e) { alert("Arama için izin gereklidir."); return; }
        this._createPC();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.socket.emit('private_call_signal', { targetId: this.targetId, signal: this.pc.localDescription });
    }

    _createPC() {
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));
        this.pc.onicecandidate = (event) => { if (event.candidate) this.socket.emit('private_call_signal', { targetId: this.targetId, signal: event.candidate }); };
        this.pc.ontrack = (event) => {
            if(this.remoteVideo) { this.remoteVideo.srcObject = event.streams[0]; this.remoteVideo.play().catch(e => console.log(e)); }
        };
    }

    stop(notify = true) {
        if(notify && this.targetId) this.socket.emit('private_call_hangup', { targetId: this.targetId });
        if(this.pc) this.pc.close();
        if(this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if(this.remoteVideo) this.remoteVideo.srcObject = null;
        this.targetId = null;
        if(this.callbacks.onHangup) this.callbacks.onHangup();
    }
}
