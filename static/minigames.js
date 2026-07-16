// Lightweight canvas mini-games shown in the matchmaking lobby.
// Both games are self-contained, theme-aware (read CSS vars), and clean up
// their own timers/listeners via .destroy() so switching tabs never leaks loops.

function themeColor(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return v && v.trim() ? v.trim() : fallback;
}

// ---------------------------------------------------------------------
// SNAKE
// ---------------------------------------------------------------------
function createSnakeGame(canvas, opts) {
  const ctx = canvas.getContext("2d");
  const cell = 20;
  const cols = Math.floor(canvas.width / cell);
  const rows = Math.floor(canvas.height / cell);
  let snake, dir, nextDir, food, score, alive, started, tickHandle;
  const TICK_MS = 140;

  function reset() {
    snake = [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    alive = true;
    placeFood();
  }

  function placeFood() {
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
    } while (snake.some((s) => s.x === pos.x && s.y === pos.y));
    food = pos;
  }

  function tick() {
    if (!alive) return;
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows ||
        snake.some((s) => s.x === head.x && s.y === head.y)) {
      alive = false;
      opts.onGameOver && opts.onGameOver(score);
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 1;
      opts.onScore && opts.onScore(score);
      placeFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = themeColor("--surface-soft", "#f3f9ff");
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // food
    ctx.fillStyle = themeColor("--danger", "#e0603f");
    ctx.beginPath();
    ctx.arc(food.x * cell + cell / 2, food.y * cell + cell / 2, cell * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // snake
    const primary = themeColor("--primary", "#2f8fe0");
    const primaryDark = themeColor("--primary-dark", "#1c6fc2");
    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? primaryDark : primary;
      const pad = 2;
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, 5)
        : ctx.rect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2);
      ctx.fill();
    });
  }

  function setDir(x, y) {
    // ignore direct reversal
    if (dir.x === -x && dir.y === -y) return;
    nextDir = { x, y };
  }

  function keyHandler(e) {
    const map = {
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
      ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
      ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    };
    if (map[e.key]) {
      e.preventDefault();
      setDir(map[e.key][0], map[e.key][1]);
    }
  }

  let touchStart = null;
  function touchStartHandler(e) {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }
  function touchEndHandler(e) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      setDir(dx > 0 ? 1 : -1, 0);
    } else if (Math.abs(dy) > 10) {
      setDir(0, dy > 0 ? 1 : -1);
    }
    touchStart = null;
  }

  return {
    start() {
      // Defensive cleanup: if a previous interval/listeners are still around
      // (e.g. restarting after game over), clear them first so speed never stacks.
      this.stop();
      reset();
      started = true;
      draw();
      tickHandle = setInterval(tick, TICK_MS);
      window.addEventListener("keydown", keyHandler);
      canvas.addEventListener("touchstart", touchStartHandler, { passive: true });
      canvas.addEventListener("touchend", touchEndHandler, { passive: true });
    },
    stop() {
      clearInterval(tickHandle);
      tickHandle = null;
      window.removeEventListener("keydown", keyHandler);
      canvas.removeEventListener("touchstart", touchStartHandler);
      canvas.removeEventListener("touchend", touchEndHandler);
    },
    destroy() {
      this.stop();
    },
    render() {
      if (snake) draw();
    },
  };
}

// ---------------------------------------------------------------------
// DINO RUN (Chrome offline dino, simplified)
// ---------------------------------------------------------------------
function createDinoGame(canvas, opts) {
  const ctx = canvas.getContext("2d");
  const groundY = canvas.height - 30;
  const dinoW = 26, dinoH = 30;
  let dinoY, vy, gravity, jumpForce, onGround;
  let obstacles, speed, distance, alive, rafHandle, lastTs, spawnTimer;

  function reset() {
    dinoY = groundY - dinoH;
    vy = 0;
    gravity = 1400; // px/s^2
    jumpForce = -560; // px/s
    onGround = true;
    obstacles = [];
    speed = 220; // px/s, increases over time
    distance = 0;
    alive = true;
    spawnTimer = 0;
    lastTs = null;
  }

  function jump() {
    if (onGround && alive) {
      vy = jumpForce;
      onGround = false;
    }
  }

  function spawnObstacle() {
    const h = 24 + Math.random() * 20;
    obstacles.push({ x: canvas.width + 10, w: 16 + Math.random() * 10, h });
  }

  function loop(ts) {
    if (!alive) return;
    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    // physics
    vy += gravity * dt;
    dinoY += vy * dt;
    if (dinoY >= groundY - dinoH) {
      dinoY = groundY - dinoH;
      vy = 0;
      onGround = true;
    }

    // speed & distance
    speed += 4 * dt;
    distance += speed * dt;
    const score = Math.floor(distance / 10);
    opts.onScore && opts.onScore(score);

    // obstacles
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = 1.1 + Math.random() * 1.1;
    }
    obstacles.forEach((o) => (o.x -= speed * dt));
    obstacles = obstacles.filter((o) => o.x + o.w > -5);

    // collision (AABB, small inset for fairness)
    const dinoBox = { x: 30 + 4, y: dinoY + 4, w: dinoW - 8, h: dinoH - 8 };
    for (const o of obstacles) {
      const obBox = { x: o.x, y: groundY - o.h, w: o.w, h: o.h };
      if (dinoBox.x < obBox.x + obBox.w && dinoBox.x + dinoBox.w > obBox.x &&
          dinoBox.y < obBox.y + obBox.h && dinoBox.y + dinoBox.h > obBox.y) {
        alive = false;
        opts.onGameOver && opts.onGameOver(score);
        draw();
        return;
      }
    }

    draw();
    rafHandle = requestAnimationFrame(loop);
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = themeColor("--surface-soft", "#f3f9ff");
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ground
    ctx.strokeStyle = themeColor("--line", "#dcebf9");
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 0.5);
    ctx.lineTo(canvas.width, groundY + 0.5);
    ctx.stroke();

    // dino
    ctx.fillStyle = themeColor("--primary-dark", "#1c6fc2");
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(30, dinoY, dinoW, dinoH, 6); else ctx.rect(30, dinoY, dinoW, dinoH);
    ctx.fill();

    // obstacles
    ctx.fillStyle = themeColor("--danger", "#e0603f");
    obstacles.forEach((o) => {
      ctx.beginPath();
      const y = groundY - o.h;
      if (ctx.roundRect) ctx.roundRect(o.x, y, o.w, o.h, 3); else ctx.rect(o.x, y, o.w, o.h);
      ctx.fill();
    });
  }

  function keyHandler(e) {
    if (e.code === "Space" || e.key === " " || e.key === "ArrowUp") {
      e.preventDefault();
      jump();
    }
  }
  function tapHandler() {
    jump();
  }

  return {
    start() {
      // Defensive cleanup so a restart never stacks a second physics loop.
      this.stop();
      reset();
      draw();
      window.addEventListener("keydown", keyHandler);
      canvas.addEventListener("touchstart", tapHandler, { passive: true });
      canvas.addEventListener("mousedown", tapHandler);
      rafHandle = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
      window.removeEventListener("keydown", keyHandler);
      canvas.removeEventListener("touchstart", tapHandler);
      canvas.removeEventListener("mousedown", tapHandler);
    },
    destroy() {
      this.stop();
    },
    render() {
      if (obstacles) draw();
    },
  };
}

window.MiniGames = {
  snake: createSnakeGame,
  dino: createDinoGame,
};
