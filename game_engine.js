/**
 * OZDER Gamified Game Engine
 * Handles XOX (Tic Tac Toe) and Tetris for PvP matches.
 */

class XOXGame {
    constructor(canvasId, isPlayer1, onMove, onScoreUpdate) {
        this.board = Array(9).fill(null);
        this.isPlayer1 = isPlayer1; 
        this.mySymbol = isPlayer1 ? 'X' : 'O';
        this.currentTurn = 'X';
        this.onMove = onMove;
        this.onScoreUpdate = onScoreUpdate; // Callback for score changes
        this.isGameOver = false;
        this.scores = { 'X': 0, 'O': 0 };

        this.initUI(canvasId);
    }

    initUI(containerId) {
        this.containerId = containerId;
        const container = document.getElementById(containerId);
        container.innerHTML = `
            <div class="xox-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; width:280px; margin:0 auto;">
                ${this.board.map((_, i) => `<div class="xox-cell" data-index="${i}" style="aspect-ratio:1; background:rgba(255,255,255,0.1); border:2px solid var(--gold); border-radius:10px; display:flex; justify-content:center; align-items:center; font-size:2.5rem; font-weight:900; color:white; cursor:pointer; transition:all 0.3s;"></div>`).join('')}
            </div>
            <div id="xox-status" style="text-align:center; margin-top:15px; font-weight:800; color:var(--gold); min-height:1.5rem;">Sıra Bekleniyor...</div>
        `;

        container.querySelectorAll('.xox-cell').forEach(cell => {
            cell.addEventListener('click', () => this.handleCellClick(parseInt(cell.dataset.index)));
        });
        this.updateStatus();
    }

    handleCellClick(index) {
        if (this.isGameOver || this.board[index] || this.currentTurn !== this.mySymbol) return;
        this.makeMove(index, this.mySymbol);
        this.onMove(index);
    }

    makeMove(index, symbol) {
        if (this.board[index]) return;
        this.board[index] = symbol;
        const cell = document.querySelector(`.xox-cell[data-index="${index}"]`);
        if (cell) {
            cell.innerText = symbol;
            cell.style.color = symbol === 'X' ? '#ff7675' : '#74b9ff';
            cell.style.boxShadow = `0 0 15px ${symbol === 'X' ? '#ff7675' : '#74b9ff'}`;
            cell.style.background = "rgba(255,255,255,0.2)";
        }

        if (this.checkWin(symbol)) {
            this.handleRoundEnd(`${symbol} Kazandı!`, symbol);
        } else if (this.board.every(cell => cell !== null)) {
            this.handleRoundEnd("Berabere!", null);
        } else {
            this.currentTurn = (this.currentTurn === 'X') ? 'O' : 'X';
            this.updateStatus();
        }
    }

    updateStatus() {
        const status = document.getElementById('xox-status');
        if (this.isGameOver) return;
        status.innerText = (this.currentTurn === this.mySymbol) ? "Senin Sıran!" : "Rakip Bekleniyor...";
    }

    checkWin(s) {
        const p = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        return p.some(range => range.every(i => this.board[i] === s));
    }

    handleRoundEnd(msg, winner) {
        this.isGameOver = true;
        const status = document.getElementById('xox-status');
        status.innerText = msg;
        status.style.fontSize = '1.5rem';
        status.style.color = winner ? (winner === 'X' ? '#ff7675' : '#74b9ff') : 'var(--gold)';

        if (winner) {
            this.scores[winner]++;
            if (this.onScoreUpdate) this.onScoreUpdate(this.scores);
        }

        // 1.5 saniye sonra raundu sıfırla
        setTimeout(() => this.resetRound(), 1500);
    }

    resetRound() {
        this.board = Array(9).fill(null);
        this.isGameOver = false;
        this.currentTurn = 'X'; // Her raunda X başlar
        this.initUI(this.containerId);
    }

    forceEnd() {
        this.isGameOver = true;
    }
}

class TetrisGame {
    constructor(canvasId, opponentCanvasId, onScoreUpdate, onTrashSend) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.oppCanvas = document.getElementById(opponentCanvasId);
        this.oppCtx = this.oppCanvas.getContext('2d');

        this.gridSize = 20;
        this.cols = 10;
        this.rows = 20;
        this.board = this.createBoard();
        this.oppBoard = this.createBoard();
        
        this.score = 0;
        this.onScoreUpdate = onScoreUpdate;
        this.onTrashSend = onTrashSend;

        this.pieces = 'IJLOSTZ';
        this.currentPiece = this.createPiece();
        this.nextPiece = this.createPiece();

        this.dropCounter = 0;
        this.dropInterval = 800; // ms
        this.lastTime = 0;

        this.isGameOver = false;

        this.initControls();
    }

    createBoard() {
        return Array.from({length: this.rows}, () => Array(this.cols).fill(0));
    }

    createPiece() {
        const type = this.pieces[Math.floor(Math.random() * this.pieces.length)];
        const pieces = {
            'I': [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
            'L': [[0,1,0],[0,1,0],[0,1,1]],
            'J': [[0,1,0],[0,1,0],[1,1,0]],
            'O': [[1,1],[1,1]],
            'Z': [[1,1,0],[0,1,1],[0,0,0]],
            'S': [[0,1,1],[1,1,0],[0,0,0]],
            'T': [[0,1,0],[1,1,1],[0,0,0]]
        };
        const colors = { 'I': '#00d2ff', 'L': '#ff9f43', 'J': '#54a0ff', 'O': '#feca57', 'Z': '#ff6b6b', 'S': '#1dd1a1', 'T': '#a29bfe' };
        
        return {
            pos: { x: 3, y: 0 },
            matrix: pieces[type],
            color: colors[type]
        };
    }

    draw() {
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawMatrix(this.board, {x:0, y:0}, this.ctx);
        this.drawMatrix(this.currentPiece.matrix, this.currentPiece.pos, this.ctx, this.currentPiece.color);
        
        // Opponent visual (shrunk)
        this.oppCtx.fillStyle = '#1e293b';
        this.oppCtx.fillRect(0, 0, this.oppCanvas.width, this.oppCanvas.height);
        this.drawMatrix(this.oppBoard, {x:0, y:0}, this.oppCtx, '#444', 0.5);
    }

    drawMatrix(matrix, offset, ctx, color = '#fff', scale = 1) {
        const size = this.gridSize * scale;
        matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    ctx.fillStyle = color === '#fff' ? '#5f27cd' : color;
                    if (value === 8) ctx.fillStyle = '#636e72'; // Trash
                    ctx.fillRect((x + offset.x) * size, (y + offset.y) * size, size - 1, size - 1);
                }
            });
        });
    }

    move(dir) {
        this.currentPiece.pos.x += dir;
        if (this.collide()) this.currentPiece.pos.x -= dir;
    }

    rotate() {
        const m = this.currentPiece.matrix;
        for (let y = 0; y < m.length; ++y) {
            for (let x = 0; x < y; ++x) {
                [m[x][y], m[y][x]] = [m[y][x], m[x][y]];
            }
        }
        m.forEach(row => row.reverse());
        if (this.collide()) m.forEach(row => row.reverse()); // Rough revert
    }

    drop() {
        this.currentPiece.pos.y++;
        if (this.collide()) {
            this.currentPiece.pos.y--;
            this.merge();
            this.resetPiece();
            this.sweep();
        }
        this.dropCounter = 0;
    }

    collide() {
        const [m, o] = [this.currentPiece.matrix, this.currentPiece.pos];
        for (let y = 0; y < m.length; ++y) {
            for (let x = 0; x < m[y].length; ++x) {
                if (m[y][x] !== 0 && (this.board[y + o.y] && this.board[y + o.y][x + o.x]) !== 0) return true;
            }
        }
        return false;
    }

    merge() {
        this.currentPiece.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) this.board[y + this.currentPiece.pos.y][x + this.currentPiece.pos.x] = value;
            });
        });
    }

    resetPiece() {
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.createPiece();
        if (this.collide()) {
            this.isGameOver = true;
            alert("OYUN BİTTİ! Skorun: " + this.score);
        }
    }

    sweep() {
        let linesRemoved = 0;
        outer: for (let y = this.rows - 1; y >= 0; --y) {
            for (let x = 0; x < this.cols; ++x) {
                if (this.board[y][x] === 0) continue outer;
            }
            const row = this.board.splice(y, 1)[0].fill(0);
            this.board.unshift(row);
            ++y;
            linesRemoved++;
        }
        if (linesRemoved > 0) {
            this.score += linesRemoved * 10;
            this.onScoreUpdate(this.score);
            if (linesRemoved >= 2) this.onTrashSend(linesRemoved - 1);
        }
    }

    addTrash(count) {
        for(let i=0; i<count; i++) {
            this.board.shift();
            const trashRow = Array(this.cols).fill(8);
            trashRow[Math.floor(Math.random() * this.cols)] = 0;
            this.board.push(trashRow);
        }
    }

    updateOpponentBoard(newBoard) {
        this.oppBoard = newBoard;
    }

    initControls() {
        // Bound handler referanslarını tutalım ki silerken kullanabilelim
        this._keydownHandler = this._handleKeydown.bind(this);
        this._touchStartHandler = this._handleTouchStart.bind(this);
        this._touchEndHandler = this._handleTouchEnd.bind(this);

        // Klavye kontrolleri
        document.addEventListener('keydown', this._keydownHandler);

        // Mobil Touch Kontrolleri (Swipe)
        this.touchStartX = 0; 
        this.touchStartY = 0; 
        this.touchStartTime = 0;

        this.canvas.addEventListener('touchstart', this._touchStartHandler, { passive: false });
        this.canvas.addEventListener('touchend', this._touchEndHandler, { passive: false });
    }

    _handleKeydown(e) {
        if (this.isGameOver) return;
        if (e.key === 'ArrowLeft') this.move(-1);
        if (e.key === 'ArrowRight') this.move(1);
        if (e.key === 'ArrowDown') this.drop();
        if (e.key === 'ArrowUp') this.rotate();
    }

    _handleTouchStart(e) {
        if (this.isGameOver) return;
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
        e.preventDefault();
    }

    _handleTouchEnd(e) {
        if (this.isGameOver) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - this.touchStartX;
        const dy = touch.clientY - this.touchStartY;
        const dt = Date.now() - this.touchStartTime;
        const minSwipe = 30; // Minimum swipe mesafesi (px)

        // Hızlı dokunma = döndür
        if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe && dt < 200) {
            this.rotate();
            return;
        }

        // Yatay kaydırma → sola/sağa
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > minSwipe) {
            this.move(dx > 0 ? 1 : -1);
        }
        // Dikey kaydırma aşağı → hızlı düşür
        else if (dy > minSwipe) {
            this.drop();
        }
        e.preventDefault();
    }

    update(time = 0) {
        if (this.isGameOver) return;
        const deltaTime = time - this.lastTime;
        this.lastTime = time;
        this.dropCounter += deltaTime;
        if (this.dropCounter > this.dropInterval) this.drop();
        this.draw();
        this.animationFrameId = requestAnimationFrame((t) => this.update(t));
    }

    forceEnd() {
        this.isGameOver = true;
        
        // Listener'ları temizle
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        if (this._touchStartHandler) {
            this.canvas.removeEventListener('touchstart', this._touchStartHandler);
            this._touchStartHandler = null;
        }
        if (this._touchEndHandler) {
            this.canvas.removeEventListener('touchend', this._touchEndHandler);
            this._touchEndHandler = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Temizle ki iç içe geçmesin
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.oppCtx.clearRect(0, 0, this.oppCanvas.width, this.oppCanvas.height);
    }
}