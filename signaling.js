/**
 * 🚀 PROJECT: OZDER NEXT-GEN
 * Modül: WebRTC Sinyalleşme (Signaling)
 * 
 * server.js'den ayrıştırılmış, bağımsız sinyal modülü.
 * 1-on-1 eşleşme, oda içi ses ve özel arama sinyallerini yönetir.
 */

const { UserRepository } = require('./database');

function setupSignaling(io) {
    // Bu fonksiyon io.on('connection') callback'i içinde çağrılır
    // Her socket için sinyal eventlerini bağlar
    return {
        /**
         * Socket'e tüm WebRTC sinyal eventlerini bağla
         */
        attachToSocket(socket, io, checkRateLimit, sanitizeString) {
            // --- 1-ON-1 WEBRTC SIGNALING ---
            socket.on("webrtc_offer", (p) => {
                if (!p || !p.targetId) return;
                if (p.targetId !== socket.matchedPeerId) return; // Güvenlik: Yetkisiz Sinyal Engelleme
                io.to(p.targetId).emit("webrtc_offer", { senderId: socket.id, sdp: p.sdp });
            });

            socket.on("webrtc_answer", (p) => {
                if (!p || !p.targetId) return;
                if (p.targetId !== socket.matchedPeerId) return;
                io.to(p.targetId).emit("webrtc_answer", { senderId: socket.id, sdp: p.sdp });
            });

            socket.on("webrtc_ice_candidate", (p) => {
                if (!p || !p.targetId) return;
                if (p.targetId !== socket.matchedPeerId) return;
                io.to(p.targetId).emit("webrtc_ice_candidate", { senderId: socket.id, candidate: p.candidate });
            });

            socket.on('end_call', (p) => {
                if (!p || !p.targetId) return;
                io.to(p.targetId).emit('peer_disconnected', { msg: 'Disconnected' });
            });

            // --- ROOM WEBRTC SIGNALING (Madde 11: Common Room Check) ---
            const checkCommonRoom = (targetId) => {
                const targetSocket = io.sockets.sockets.get(targetId);
                if (!targetSocket) return false;
                // Her iki socket'in ortak bir odada (room_*) olup olmadığını kontrol et
                const myRooms = Array.from(socket.rooms).filter(r => r.startsWith('room_'));
                return myRooms.some(r => targetSocket.rooms.has(r));
            };

            socket.on("room_webrtc_offer", (p) => {
                if (!p || !p.targetId || !checkCommonRoom(p.targetId)) return;
                io.to(p.targetId).emit("room_webrtc_offer", { senderId: socket.id, sdp: p.sdp });
            });

            socket.on("room_webrtc_answer", (p) => {
                if (!p || !p.targetId || !checkCommonRoom(p.targetId)) return;
                io.to(p.targetId).emit("room_webrtc_answer", { senderId: socket.id, sdp: p.sdp });
            });

            socket.on("room_webrtc_ice_candidate", (p) => {
                if (!p || !p.targetId || !checkCommonRoom(p.targetId)) return;
                io.to(p.targetId).emit("room_webrtc_ice_candidate", { senderId: socket.id, candidate: p.candidate });
            });

            // --- PRIVATE CALL SIGNALING (DM - Madde 8 & 9 Fix) ---
            socket.on('private_call_init', async (data) => {
                if (!checkRateLimit(socket)) return;
                if (!data || !data.targetId) return;
                if (data.targetId === socket.id) return; // Kendini arama

                const decodedUser = socket.decoded;
                const targetSocket = io.sockets.sockets.get(data.targetId);
                
                if (targetSocket && targetSocket.decoded) {
                    // Madde 8 Fix: Arkadaşlık kontrolü (Peer Check)
                    const areFriends = await UserRepository.isFriends(decodedUser.id, targetSocket.decoded.id);
                    if (!areFriends) {
                        console.warn(`🚨 [Security] Yetkisiz Arama Denemesi: ${decodedUser.username} -> ${targetSocket.decoded.id}`);
                        socket.emit('call_error', { msg: 'Sadece arkadaşlarınızı arayabilirsiniz.' });
                        return;
                    }

                    io.to(data.targetId).emit('private_call_incoming', {
                        callerId: socket.id,
                        type: data.type,
                        callerName: sanitizeString(decodedUser.username),
                        callerAvatar: sanitizeString(socket.currentAvatar || '') // Madde 8 Fix
                    });
                }
            });

            socket.on('private_call_accept', async (data) => {
                if (!data || !data.targetId) return;
                
                const decodedUser = socket.decoded;
                const targetSocket = io.sockets.sockets.get(data.targetId);
                if (targetSocket) {
                    // Madde 22 & 23: Güvenlik - Sadece arkadaşlar arayabilir (Doğrulama)
                    const isFriends = await UserRepository.isFriends(socket.decoded.id, targetSocket.decoded.id);
                    if (!isFriends) {
                        socket.emit('private_call_error', { msg: 'Sadece arkadaşlarınızla arama yapabilirsiniz.' });
                        return;
                    }

                    socket.matchedPeerId = data.targetId;
                    targetSocket.matchedPeerId = socket.id;
                    
                    io.to(data.targetId).emit('private_call_accepted', {
                        responderId: socket.id
                    });
                } else {
                    // Madde 23 Fix: Karşı taraf düştüyse bildir (UX)
                    socket.emit('private_call_error', { msg: 'Arayan kişi bağlantısını kopardı.' });
                }
            });

            socket.on('private_call_signal', (data) => {
                if (!data || !data.targetId) return;
                // Güvenlik: Sadece doğrulanmış (accepted) peer ile sinyalleş
                if (data.targetId !== socket.matchedPeerId) return;
                
                io.to(data.targetId).emit('private_call_signal', {
                    senderId: socket.id,
                    signal: data.signal
                });
            });

            socket.on('private_call_reject', (data) => {
                if (!data || !data.targetId) return;
                io.to(data.targetId).emit('private_call_rejected', {
                    responderId: socket.id
                });
                // Bağlantıyı temizle
                if (socket.matchedPeerId === data.targetId) socket.matchedPeerId = null;
            });

            socket.on('private_call_hangup', (data) => {
                if (!data || !data.targetId) return;
                if (data.targetId !== socket.matchedPeerId) return;
                io.to(data.targetId).emit('private_call_finished', { senderId: socket.id });
                if (socket.matchedPeerId === data.targetId) socket.matchedPeerId = null;
            });

            // --- GAME SIGNALING ---
            socket.on('game_move', (p) => {
                if (!p || !p.targetId) return;
                if (p.targetId !== socket.matchedPeerId) return;
                io.to(p.targetId).emit('game_move', { senderId: socket.id, move: p.moveData });
            });

            socket.on('game_score', (p) => {
                if (!p || !p.targetId) return;
                if (p.targetId !== socket.matchedPeerId) return;
                io.to(p.targetId).emit('game_score', { senderId: socket.id, score: p.score });
            });

            // --- DM MESSAGING ---
            socket.on('send_message', (data) => {
                if (!data || !data.targetId) return;
                
                // Güvenlik: Maksimum Payload Boyutu (Memory DoS Koruması - 2MB)
                const payloadSize = JSON.stringify(data).length;
                if (payloadSize > 2000000) {
                    console.warn(`⚠️ [Güvenlik] Aşırı büyük DM engellendi. Gönderen: ${socket.id}`);
                    return;
                }

                // Madde 4 & 14: Photo/Audio için spesifik dize limitleri ve format doğrulaması
                if (data.photoData) {
                    if (data.photoData.length > 700000) return; 
                    // SVG XSS ve beacon koruması: Sadece güvenli görsel formatları
                    if (!data.photoData.startsWith('data:image/jpeg') && 
                        !data.photoData.startsWith('data:image/png') && 
                        !data.photoData.startsWith('data:image/webp')) return;
                }
                
                if (data.audioData) {
                    if (data.audioData.length > 700000) return;
                    if (!data.audioData.startsWith('data:audio/')) return;
                }

                io.to(data.targetId).emit('receive_message', {
                    text: data.text ? String(data.text).substring(0, 1000) : '',
                    senderId: socket.id,
                    type: data.type || 'text',
                    photoData: data.photoData,
                    audioData: data.audioData,
                    ephemeral: data.ephemeral
                });
            });

            // --- MIC STATUS (Madde 10: Peer Check) ---
            socket.on('mic_status_change', (data) => {
                if (!data || !data.targetId) return;
                // Güvenlik: Sadece eşleşmiş peer'a mikrofon durumunu ilet
                if (data.targetId !== socket.matchedPeerId) return;
                io.to(data.targetId).emit('mic_status_change', { senderId: socket.id, isMuted: data.isMuted });
            });
        }
    };
}

module.exports = setupSignaling;