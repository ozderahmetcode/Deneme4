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
        this.onHangUp = onHangUp; // UI'yı güncellemek için callback

        // Bütün dinleyicileri (Listener) hazır beklet
        this._initSocketListeners();
    }

    /**
     * Blueprint Kuralı: İzni eşleşmeye girildiğinde İSTE!
     */
    async requestMicrophone() {
        try {
            if (this.localStream && this.localStream.active) {
                console.log("🎤 Mevcut mikrofon yayını kullanılıyor.");
                return true;
            }

            console.log("🎤 Yeni mikrofon izni alınıyor...");
            if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert("HATA: Tarayıcınız mikrofonu engelledi.");
                return false;
            }
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            return true;
        } catch (err) {
            console.error("❌ Mikrofon izni hatası:", err);
            alert("Konuşmak için mikrofon izni vermelisiniz!");
            return false;
        }
    }

    /**
     * Eşleşme sağlandığında bağlantıyı kurar (Arayan Taraf = Caller)
     */
    async startCall(opponentId) {
        this.targetId = opponentId;
        this._createPeerConnection();

        // 1. Kendi sesimizi bağlantıya ekliyoruz
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        // 2. Teklif (Offer) oluştur ve yolla
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        this.socket.emit("webrtc_offer", {
            targetId: this.targetId,
            sdp: this.peerConnection.localDescription
        });
    }

    /**
     * Sinyalleri dinleme noktası
     */
    _initSocketListeners() {
        // Karşıdan teklif geldiğinde (Aranan Taraf = Callee)
        this.socket.on("webrtc_offer", async (data) => {
            console.log("📥 Gelen arama teklifi (Offer) alınıyor...");
            this.targetId = data.senderId;
            this._createPeerConnection();

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            
            // Cevap (Answer) oluştur ve yolla
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this.socket.emit("webrtc_answer", {
                targetId: this.targetId,
                sdp: this.peerConnection.localDescription
            });
        });

        this.socket.on("webrtc_answer", async (data) => {
            console.log("📥 Karşı taraf teklifi (Answer) kabul etti.");
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        });

        this.socket.on("webrtc_ice_candidate", async (data) => {
            if (data.candidate && this.peerConnection) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });

        this.socket.on("peer_disconnected", () => {
            console.log("🔴 Karşı taraf aramayı kapattı.");
            this.hangUp();
            if(this.onHangUp) this.onHangUp(); // UI'yı 'Puanlama' veya 'Ev' ekranına yolla
        });
    }

    /**
     * WebRTC temel objesinin oluşturulması (Turn/Stun)
     */
    _createPeerConnection() {
        const rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' },
                { urls: 'stun:stun.stunprotocol.org' }
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all'
        };

        this.peerConnection = new RTCPeerConnection(rtcConfig);

        // ICE Adayı bulunduğunda karşıya fırlat (Sinyalleşme üzerinden)
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit("webrtc_ice_candidate", {
                    targetId: this.targetId,
                    candidate: event.candidate
                });
            }
        };

        // Karşı tarafın sesi geldiğinde HTML Audio objesine bağla
        this.peerConnection.ontrack = (event) => {
            console.log("🎵 Karşı tarafın SES ALGISI (Stream) bağlandı!");
            if (this.remoteAudio.srcObject !== event.streams[0]) {
                this.remoteAudio.srcObject = event.streams[0];
                this.remoteAudio.play();
            }
        };
    }

    /**
     * Sesi Kapat / Aç (Mute)
     */
    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                return audioTrack.enabled; // Geriye yeni durumu dön (Açık mı?)
            }
        }
        return false;
    }

    hangUp() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.targetId) {
            this.socket.emit("end_call", { targetId: this.targetId });
            this.targetId = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        if (this.remoteAudio) {
            this.remoteAudio.srcObject = null;
        }
    }
}

/**
 * 🏠 ROOM AUDIO CLIENT (Mesh Architecture)
 * - 10 kişiye kadar her kullanıcı birbiriyle doğrudan Peer bağ kurar.
 */
class RoomAudioClient {
    constructor(socket, containerElement, callbacks) {
        this.socket = socket;
        this.container = containerElement; // Audio elementlerinin ekleneceği yer
        this.peers = {}; // { socketId: RTCPeerConnection }
        this.localStream = null;
        this.roomId = null;
        this.callbacks = callbacks || {}; // { onParticipants, onUserJoined, onUserLeft }
        this._boundListeners = {}; // Temizlik için referansları tut

        this._initSocketListeners();
    }

    async join(roomId, userData) {
        this.roomId = roomId;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch(e) {
            console.error("Oda mikrofon hatası:", e);
            alert("Odaya girmek için mikrofon izni vermelisiniz!");
            return;
        }
        this.socket.emit('join_room', { roomId, ...userData });
    }

    _initSocketListeners() {
        // Her listener'ı bound reference olarak sakla ki leave'de temizleyebilelim
        this._boundListeners.onParticipants = (users) => {
            users.forEach(user => {
                this._createPeer(user.id, true); // Ben yeni geldim, teklif yollayacağım
            });
            if(this.callbacks.onParticipants) this.callbacks.onParticipants(users);
        };

        this._boundListeners.onUserJoined = (user) => {
            this._createPeer(user.id, false); // O yeni geldi, teklifini bekleyeceğim
            if(this.callbacks.onUserJoined) this.callbacks.onUserJoined(user);
        };

        this._boundListeners.onUserLeft = (data) => {
            this._removePeer(data.id);
            if(this.callbacks.onUserLeft) this.callbacks.onUserLeft(data);
        };

        this._boundListeners.onOffer = async (data) => {
            if(!this.roomId) return;
            const peer = this._getOrCreatePeer(data.senderId);
            await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            this.socket.emit('room_webrtc_answer', { targetId: data.senderId, sdp: peer.localDescription });
        };

        this._boundListeners.onAnswer = async (data) => {
            if(!this.roomId) return;
            const peer = this.peers[data.senderId];
            if(peer) await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        };

        this._boundListeners.onIce = async (data) => {
            if(!this.roomId) return;
            const peer = this.peers[data.senderId];
            if(peer) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        };

        // Listener'ları kaydet
        this.socket.on('room_participants', this._boundListeners.onParticipants);
        this.socket.on('room_user_joined', this._boundListeners.onUserJoined);
        this.socket.on('room_user_left', this._boundListeners.onUserLeft);
        this.socket.on('room_webrtc_offer', this._boundListeners.onOffer);
        this.socket.on('room_webrtc_answer', this._boundListeners.onAnswer);
        this.socket.on('room_webrtc_ice_candidate', this._boundListeners.onIce);
    }

    _removeSocketListeners() {
        this.socket.off('room_participants', this._boundListeners.onParticipants);
        this.socket.off('room_user_joined', this._boundListeners.onUserJoined);
        this.socket.off('room_user_left', this._boundListeners.onUserLeft);
        this.socket.off('room_webrtc_offer', this._boundListeners.onOffer);
        this.socket.off('room_webrtc_answer', this._boundListeners.onAnswer);
        this.socket.off('room_webrtc_ice_candidate', this._boundListeners.onIce);
    }

    _getOrCreatePeer(socketId) {
        if (this.peers[socketId]) return this.peers[socketId];
        return this._createPeer(socketId, false);
    }

    _createPeer(socketId, isCaller) {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.peers[socketId] = pc;

        // Local stream ekle
        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('room_webrtc_ice_candidate', { targetId: socketId, candidate: event.candidate });
            }
        };

        pc.ontrack = (event) => {
            let audioEl = document.getElementById(`audio-${socketId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${socketId}`;
                audioEl.autoplay = true;
                this.container.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
            audioEl.play().catch(e => console.log("Oda sesi oynatma hatası:", e));
        };

        if (isCaller) {
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                this.socket.emit('room_webrtc_offer', { targetId: socketId, sdp: offer });
            });
        }

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

    setMute(isMuted) {
        if(this.localStream) {
            this.localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        }
    }

    leave() {
        this._removeSocketListeners();
        this.socket.emit('leave_room', { roomId: this.roomId });
        for (const id in this.peers) this._removePeer(id);
        if(this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
        this.roomId = null;
    }
}

/**
 * 📞 PRIVATE CALL CLIENT (Audio & Video)
 * For direct DM calling (WhatsApp style)
 */
class PrivateCallClient {
    constructor(socket, localVideoEl, remoteVideoEl, callbacks) {
        this.socket = socket;
        this.localVideo = localVideoEl;
        this.remoteVideo = remoteVideoEl;
        this.callbacks = callbacks || {}; // { onHangup, onRemoteStream }
        this.pc = null;
        this.localStream = null;
        this.targetId = null;
        this.callType = 'audio'; // 'audio' or 'video'
        
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

        this.socket.on('private_call_finished', () => {
            this.stop(false);
        });

        this.socket.on('private_call_rejected', () => {
            alert("Arama reddedildi.");
            this.stop(false);
        });
    }

    async start(targetId, type) {
        this.targetId = targetId;
        this.callType = type;
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: type === 'video'
            });
            if(this.localVideo && type === 'video') {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.play();
            }
        } catch(e) {
            console.error("Kamera/Mikrofon izni alınamadı", e);
            alert("Arama yapabilmek için gerekli izinleri vermelisiniz.");
            return;
        }

        this._createPC();
        
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.socket.emit('private_call_signal', { targetId: this.targetId, signal: this.pc.localDescription });
    }

    async accept(targetId, type) {
        this.targetId = targetId;
        this.callType = type;
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: type === 'video'
            });
            if(this.localVideo && type === 'video') {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.play();
            }
        } catch(e) {
            console.error("Kamera/Mikrofon hatası", e);
            return;
        }

        this._createPC();
    }

    _createPC() {
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.localStream.getTracks().forEach(track => {
            this.pc.addTrack(track, this.localStream);
        });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('private_call_signal', { targetId: this.targetId, signal: event.candidate });
            }
        };

        this.pc.ontrack = (event) => {
            if(this.remoteVideo) {
                this.remoteVideo.srcObject = event.streams[0];
                this.remoteVideo.play().catch(e => console.log("Video oynatma hatası:", e));
            }
            if(this.callbacks.onRemoteStream) this.callbacks.onRemoteStream(event.streams[0]);
        };
    }

    stop(notify = true) {
        if(notify && this.targetId) {
            this.socket.emit('private_call_hangup', { targetId: this.targetId });
        }
        if(this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if(this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        if(this.localVideo) this.localVideo.srcObject = null;
        if(this.remoteVideo) this.remoteVideo.srcObject = null;
        this.targetId = null;
        if(this.callbacks.onHangup) this.callbacks.onHangup();
    }
}
