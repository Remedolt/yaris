/**
 * Kankinin Yarışı v1.0
 * OutRun / Lotus-style pseudo-3D racer.
 *
 * Tweak the CFG object first — every gameplay number lives there.
 * Projection math follows the classic "camera depth / z" raster road:
 * each track slice is a 3D segment projected to a screen quad.
 */
(function () {
  "use strict";

  // =====================================================================
  //  CONFIG — change these to retune the game without hunting through code
  // =====================================================================
  const CFG = {
    WIDTH: 960,                 // internal canvas resolution
    HEIGHT: 540,
    LANES: 3,                   // dashed lane count
    ROAD_WIDTH: 2000,           // world units (bigger = wider road on screen)
    SEGMENT_LENGTH: 200,        // z-length of one road slice
    RUMBLE_LENGTH: 3,           // slices per rumble / stripe cycle
    DRAW_DISTANCE: 280,         // how many slices to project (fog / pop-in)
    FIELD_OF_VIEW: 100,         // degrees — higher = more "wide angle"
    CAMERA_HEIGHT: 1000,        // world units above the road
    FOG_DENSITY: 8,             // higher = thicker distant haze

    // Speed is in world-units / second. MAX_SPEED is set so you never skip
    // a whole segment in one frame at 60fps (SEGMENT_LENGTH / dt).
    MAX_SPEED: (200 / (1 / 60)) * 0.85, // ~10200  →  displayed as ~480 km/h
    ACCEL: 2200,                // hold up/W
    BREAKING: -6800,            // hold down/S
    DECEL: -1600,               // coast
    OFF_ROAD_DECEL: -4200,      // extra drag in the desert
    OFF_ROAD_LIMIT: 3200,       // speed cap off asphalt
    CENTRIFUGAL: 0.28,          // how hard curves push you sideways
    STEER_MARGIN: 2.2,          // clamp |player.x| so you can't fly to infinity
    PLAYER_WIDTH: 0.22,         // collision width in "road halves" (1.0 = edge)
    CAR_WIDTH: 0.22,
    TRAFFIC_COUNT: 34,          // NPC araç (kamyon + araba)
    TOTAL_LAPS: 3,
    DAMAGE_PER_HIT: 14,         // percent added on a car collision
    HIT_SPEED_FACTOR: 0.38,     // speed kept after a crash
    INVULN_TIME: 0.85,          // seconds of grace after a hit
    FUEL_IDLE: 1.6,             // % / second at standstill
    FUEL_RACE: 3.4,             // extra % / second at MAX_SPEED
    FUEL_PICKUP: 22,            // kenardaki bidondan gelen benzin %
    FUEL_SPACING: 36,           // kaç segmentte bir bidon
    // Sprite size = pixelWidth * scale * (WIDTH/2) * SPRITE_SCALE * ROAD_WIDTH
    // 0.3 / referencePixelWidth — keep in lockstep with the largest sprite (~24px)
    SPRITE_SCALE: 0.3 / 24,
    BG_SKY_SPEED: 0.001,        // parallax multipliers vs curve * speed
    BG_MOUNTAIN_SPEED: 0.004,
    BG_CITY_SPEED: 0.007,
    KMH_MAX: 480,               // speedometer mapping at MAX_SPEED
  };

  const COLORS = {
    skyTop: "#1a0533",
    light: {
      road: "#2b2c34",
      grass: "#e07a2f",
      rumble: "#ff3d8a",
      lane: "#e8e8f0",
      shoulder: "#c45e22",
    },
    dark: {
      road: "#22232a",
      grass: "#c45e22",
      rumble: "#f4f0e8",
      lane: "#e8e8f0",
      shoulder: "#a84c18",
    },
  };

  // =====================================================================
  //  DOM
  // =====================================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayInner = document.getElementById("overlay-inner");
  const hud = document.getElementById("hud");
  const lapLabel = document.getElementById("lap-label");
  const lapFill = document.getElementById("lap-fill");
  const fuelFill = document.getElementById("fuel-fill");
  const damageFill = document.getElementById("damage-fill");
  const damagePct = document.getElementById("damage-pct");
  const speedLabel = document.getElementById("speed-label");
  const rpmFill = document.getElementById("rpm-fill");
  const pickupMsg = document.getElementById("pickup-msg");
  const stage = document.getElementById("stage");
  const pauseBtn = document.getElementById("pause-btn");
  const hitFlash = document.getElementById("hit-flash");
  const touchPad = document.getElementById("touch");

  canvas.width = CFG.WIDTH;
  canvas.height = CFG.HEIGHT;

  const cameraDepth = 1 / Math.tan(((CFG.FIELD_OF_VIEW / 2) * Math.PI) / 180);
  const playerZCam = CFG.CAMERA_HEIGHT * cameraDepth;

  // =====================================================================
  //  INPUT
  // =====================================================================
  const keys = { left: false, right: false, up: false, down: false };

  const KEYMAP = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    a: "left",
    d: "right",
    w: "up",
    s: "down",
    A: "left",
    D: "right",
    W: "up",
    S: "down",
  };

  function bindInput() {
    window.addEventListener("keydown", (e) => {
      const action = KEYMAP[e.key];
      if (action) {
        keys[action] = true;
        e.preventDefault();
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === "p" || e.key === "P") {
        togglePause();
      }
      if (e.key === "Escape") {
        if (mode === "playing") togglePause();
      }
    });
    window.addEventListener("keyup", (e) => {
      const action = KEYMAP[e.key];
      if (action) {
        keys[action] = false;
        e.preventDefault();
      }
    });

    overlay.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (mode === "paused") return;
      onConfirm();
    });

    if (pauseBtn) {
      pauseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePause();
      });
    }

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) {
      touchPad.classList.remove("hidden");
      touchPad.querySelectorAll("button").forEach((btn) => {
        const k = btn.dataset.key;
        const down = (ev) => {
          ev.preventDefault();
          keys[k] = true;
        };
        const up = (ev) => {
          ev.preventDefault();
          keys[k] = false;
        };
        btn.addEventListener("pointerdown", down);
        btn.addEventListener("pointerup", up);
        btn.addEventListener("pointerleave", up);
        btn.addEventListener("pointercancel", up);
      });
    }
  }

  // =====================================================================
  //  SPRITES — pixel maps (`.` = transparent)
  // =====================================================================
  const PAL = {
    K: [12, 8, 20],
    B: [45, 110, 255],
    L: [120, 190, 255],
    D: [20, 50, 140],
    W: [180, 220, 255],
    R: [255, 40, 70],
    Y: [255, 220, 40],
    O: [255, 120, 20],
    G: [70, 70, 82],
    N: [40, 240, 255],
    P: [255, 90, 180],
    T: [255, 200, 40],
    U: [40, 90, 210],
    C: [40, 160, 70],
    H: [20, 90, 40],
    S: [210, 140, 70],
    M: [160, 160, 175],
    F: [255, 250, 230],
    A: [90, 50, 30],
    V: [180, 70, 255],
    X: [30, 40, 70],
    E: [30, 220, 80],
  };

  function blit(art) {
    const rows = art.trim().split("\n").map((r) => r.replace(/\r/g, ""));
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = rows[y].padEnd(w, ".");
      for (let x = 0; x < w; x++) {
        const col = PAL[row[x]];
        if (!col) continue;
        const i = (y * w + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  const SPRITES = {};

  function buildSprites() {
    SPRITES.player = blit(`
..........KKKKKKKKKKKK..........
.........KBBBBBBBBBBBBK.........
........KBBWWWWWWWWWWBBK........
........KBBWWWWWWWWWWBBK........
.......KBBBBBBBBBBBBBBBBK.......
.......KBBBBBBBBBBBBBBBBK.......
.......KBBBBKKKKKKKKBBBBK.......
......KBBBBKRRRRRRRRKBBBBK......
......KBBBBBFFFFFFFFBBBBBK......
......KBBKGGGGK..KGGGGKBBK......
......KKKGGGGK....KGGGGKKK......
.........KKKK......KKKK.........
`);

    SPRITES.playerIdle = blit(`
..........KKKKKKKKKKKK..........
.........KBBBBBBBBBBBBK.........
........KBBWWWWWWWWWWBBK........
........KBBWWWWWWWWWWBBK........
.......KBBBBBBBBBBBBBBBBK.......
.......KBBBBBBBBBBBBBBBBK.......
.......KBBBBKKKKKKKKBBBBK.......
......KBBBBKRRRRRRRRKBBBBK......
......KBBBBBFFFFFFFFBBBBBK......
......KBBKGGGGK..KGGGGKBBK......
......KKKGGGGK....KGGGGKKK......
.........KKKK......KKKK.........
`);

    SPRITES.pink = blit(`
.........KKKKKKKKKK.........
........KPPPPPPPPPPK........
.......KPPWWWWWWWWPPK.......
.......KPPPPPPPPPPPPK.......
.......KPPPPKKKKPPPPK.......
......KPPPPKRRRRKPPPPK......
......KPPPPPFFFFFFPPPPK......
......KPPKGGGGKKGGGGKPPK.....
......KKKGGGGK..KGGGGKKK.....
.........KKKK....KKKK........
`);

    SPRITES.blue = blit(`
.........KKKKKKKKKK.........
........KUUUUUUUUUUK........
.......KUUWWWWWWWWUUK.......
.......KUUUUUUUUUUUUK.......
.......KUUUUKKKKUUUUK.......
......KUUUUKRRRRKUUUUK......
......KUUUUUFFFFFFUUUUK......
......KUUKGGGGKKGGGGKUUK.....
......KKKGGGGK..KGGGGKKK.....
.........KKKK....KKKK........
`);

    SPRITES.violet = blit(`
..........KKKKKKKK..........
.........KVVVVVVVVVK.........
........KVVWWWWWWVVVK........
........KVVVVVVVVVVVK........
........KVVVKKKKVVVVK........
.......KVVVVKRRRRKVVVVK......
.......KVVVVVFFFFFFVVVVK......
.......KVVKGGGGKKGGGGKVVK.....
.......KKKGGGGK..KGGGGKKK.....
..........KKKK....KKKK........
`);

    SPRITES.truck = blit(`
......KKKKKKKKKKKKKKKK......
......KTTTTTTTTTTTTTTK......
......KTTXXXXXXXXXXTTK......
......KTTTTTTTTTTTTTTK......
......KTTKKTTTTTTKKTTK......
.....KTTKNNKTTTTKNNKTTK.....
.....KTTKKKKTTTTKKKKTTK.....
.....KKFFFFFFFFFFFFFFKK.....
.....KTKGGGGK..KGGGGKTK.....
.....KKKGGGGK..KGGGGKKK.....
........KKKK....KKKK........
`);

    SPRITES.tanker = blit(`
.......KKKKKKKKKKKKKK.......
......KFFFFFFFFFFFFFFK......
......KFFNNNNNNNNNNFFK......
......KFFFFFFFFFFFFFFK......
......KOOOOOOOOOOOOOOK......
.....KOOEEEEEEEEEEEEOOK.....
.....KOOOOOOOOOOOOOOOOK.....
.....KKFFFFFFFFFFFFFFKK.....
.....KOKGGGGK..KGGGGKOK.....
.....KKKGGGGK..KGGGGKKK.....
........KKKK....KKKK........
`);

    SPRITES.fuel = blit(`
......YYYY......
.....YKKKKY.....
....YKNNNNKY....
....YKNNNNKY....
....YKKKKKKY....
.....YKKKKY.....
......YKKY......
....YYKKKKYY....
...YEEEEEEEY....
...YEFFFFFEY....
...YEEEEEEEY....
...YYKKKKKYY....
....Y....Y......
`);

    SPRITES.cactus = blit(`
......HH......
.....HCCCH....
.....HCCCH....
.HH..HCCCH..HH
HCCK.HCCCH.KCC
HCCCHHCCCHHCCC
.HCCCHCCCCHCC.
..KKHHCCCHHK..
.....HCCCH....
.....HCCCH....
.....HCCCH....
.....HAAAH....
`);

    SPRITES.palm = blit(`
......C.C.C.......
...C.CCCCCCC.C....
....CCCCCCCCC.....
..C.CCCCKCCCC.C...
.....CCCKCCC......
.......HKH........
.......HAH........
.......HAH........
.......HAH........
......HAAAH.......
`);

    SPRITES.lamp = blit(`
....NNN....
...NYYYNN..
....NKN....
.....K.....
.....K.....
.....K.....
.....K.....
....KKK....
`);

    SPRITES.pylon = blit(`
......M......
.....M.M.....
....M...M....
...M.MMM.M...
..M.M...M.M..
.M.M.....M.M.
M.M.......M.M
.M.M.....M.M.
..KK.....KK..
`);

    SPRITES.bush = blit(`
..CCHCC..
.CHCCCCC.
CHCCHCCC.
.HAAAHH..
`);

    SPRITES.sign = blit(`
.YYYYYYY.
YKKKKKKKY
YKFFFFFKY
YKFNYNFKY
YKFFFFFKY
YKKKKKKKY
.YYYKYYY.
....K....
....K....
...KKK...
`);

    SPRITES.billboard = blit(`
KKKKKKKKKKKKKKKK
KFFFFFFFFFFFFFFK
KFNNN.N..N.NNNFK
KFN...N..N.N..FK
KFNNN.N..N.NNNFK
KFN...N..N.N.NFK
KFN...NNNN.N..FK
KFFFFFFFFFFFFFFK
KKKKKKKKKKKKKKKK
.......KK.......
.......KK.......
`);
  }

  // =====================================================================
  //  BACKGROUNDS (sunset, mountains, city) — wide bitmaps for wrap-scroll
  // =====================================================================
  const BG = { sky: null, mountains: null, city: null };

  function buildBackgrounds() {
    BG.sky = document.createElement("canvas");
    BG.sky.width = CFG.WIDTH;
    BG.sky.height = 280;
    const sg = BG.sky.getContext("2d");
    const grad = sg.createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, "#140428");
    grad.addColorStop(0.28, "#4a1468");
    grad.addColorStop(0.5, "#c43c48");
    grad.addColorStop(0.72, "#ff7a18");
    grad.addColorStop(1, "#ffd36a");
    sg.fillStyle = grad;
    sg.fillRect(0, 0, CFG.WIDTH, 280);
    for (let y = 0; y < 280; y += 2) {
      sg.fillStyle = "rgba(0,0,0,0.07)";
      sg.fillRect(0, y, CFG.WIDTH, 1);
    }
    sg.fillStyle = "#fff6c8";
    for (let i = 0; i < 50; i++) {
      const x = (i * 97) % CFG.WIDTH;
      const y = (i * 53) % 90;
      sg.globalAlpha = 0.25 + (i % 5) * 0.1;
      sg.fillRect(x, y, 2, 2);
    }
    sg.globalAlpha = 1;
    sg.fillStyle = "#ffd36a";
    sg.beginPath();
    sg.arc(CFG.WIDTH * 0.62, 168, 38, 0, Math.PI * 2);
    sg.fill();
    sg.fillStyle = "rgba(255,180,60,0.25)";
    sg.beginPath();
    sg.arc(CFG.WIDTH * 0.62, 168, 58, 0, Math.PI * 2);
    sg.fill();
    sg.fillStyle = "rgba(200,210,220,0.35)";
    for (let i = 0; i < 8; i++) {
      const y = 18 + i * 22;
      sg.fillRect(40 + i * 90, y, 140 + (i % 3) * 40, 5);
    }

    BG.mountains = document.createElement("canvas");
    BG.mountains.width = 1920;
    BG.mountains.height = 140;
    const mg = BG.mountains.getContext("2d");
    function range(color, seed, h) {
      mg.fillStyle = color;
      mg.beginPath();
      mg.moveTo(0, 140);
      for (let x = 0; x <= 1920; x += 24) {
        const n = Math.sin((x + seed) * 0.01) * 0.5 + Math.sin((x + seed) * 0.023) * 0.5;
        mg.lineTo(x, 140 - h * (0.35 + n * 0.65));
      }
      mg.lineTo(1920, 140);
      mg.closePath();
      mg.fill();
    }
    range("#8a3a18", 40, 110);
    range("#c45e22", 220, 78);
    range("#e07a2f", 480, 48);

    BG.city = document.createElement("canvas");
    BG.city.width = 1920;
    BG.city.height = 150;
    const cg = BG.city.getContext("2d");
    const buildings = [
      { x: 40, w: 50, h: 90, c: "#1a3a5c" },
      { x: 100, w: 36, h: 70, c: "#224866" },
      { x: 150, w: 70, h: 120, c: "#16324c" },
      { x: 230, w: 28, h: 55, c: "#2a6a8a" },
      { x: 280, w: 90, h: 100, c: "#1a4058" },
      { x: 390, w: 44, h: 80, c: "#24506c" },
      { x: 450, w: 60, h: 130, c: "#123040" },
      { x: 530, w: 34, h: 64, c: "#2a6a8a" },
      { x: 580, w: 76, h: 88, c: "#1c4860" },
      { x: 670, w: 48, h: 110, c: "#16324c" },
      { x: 740, w: 100, h: 95, c: "#1a3a5c" },
      { x: 860, w: 30, h: 50, c: "#2a6a8a" },
      { x: 910, w: 66, h: 125, c: "#102838" },
      { x: 990, w: 40, h: 72, c: "#224866" },
      { x: 1050, w: 84, h: 108, c: "#1a4058" },
      { x: 1150, w: 28, h: 60, c: "#2a6a8a" },
      { x: 1190, w: 70, h: 92, c: "#16324c" },
      { x: 1280, w: 52, h: 78, c: "#1c4860" },
      { x: 1350, w: 96, h: 118, c: "#123040" },
      { x: 1460, w: 38, h: 66, c: "#224866" },
      { x: 1510, w: 80, h: 100, c: "#1a3a5c" },
      { x: 1600, w: 44, h: 84, c: "#24506c" },
      { x: 1660, w: 72, h: 70, c: "#1c4860" },
      { x: 1750, w: 90, h: 112, c: "#102838" },
    ];
    buildings.forEach((b, idx) => {
      cg.fillStyle = b.c;
      cg.fillRect(b.x, 150 - b.h, b.w, b.h);
      cg.fillStyle = idx % 3 === 0 ? "#ff7a18" : "#3ef0ff";
      for (let wy = 150 - b.h + 8; wy < 145; wy += 10) {
        for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += 8) {
          if ((wx + wy + idx) % 5 === 0) continue;
          cg.fillRect(wx, wy, 4, 5);
        }
      }
    });
    cg.fillStyle = "#3ef0ff";
    cg.font = "10px 'Press Start 2P', monospace";
    cg.fillText("YARIS", 158, 48);
    cg.fillText("YARIS", 922, 40);
    cg.fillStyle = "#ffd36a";
    cg.fillText("TR", 1370, 52);

    // lattice pylons along the city base
    cg.strokeStyle = "#6a4a9a";
    cg.lineWidth = 2;
    for (let x = 20; x < 1920; x += 140) {
      cg.beginPath();
      cg.moveTo(x, 150);
      cg.lineTo(x + 14, 90);
      cg.lineTo(x + 28, 150);
      cg.moveTo(x + 4, 130);
      cg.lineTo(x + 24, 130);
      cg.stroke();
    }
  }

  function drawParallax(img, offset, destY, destH) {
    const w = img.width;
    const srcX = ((offset % w) + w) % w;
    const slice = Math.min(w - srcX, w / 2);
    const destW = CFG.WIDTH * (slice / (w / 2));
    ctx.drawImage(img, srcX, 0, slice, img.height, 0, destY, destW, destH);
    if (slice < w / 2) {
      ctx.drawImage(
        img,
        0,
        0,
        w / 2 - slice,
        img.height,
        destW - 1,
        destY,
        CFG.WIDTH - destW + 1,
        destH
      );
    }
  }

  // =====================================================================
  //  TRACK
  // =====================================================================
  const segments = [];
  let trackLength = 0;
  const cars = [];
  const player = {
    x: 0,
    z: 0,
    y: 0,
    speed: 0,
    lap: 1,
    fuel: 100,
    pickupTimer: 0,
    damage: 0,
    invuln: 0,
    hitTimer: 0,
    finished: false,
  };
  const bgOff = { sky: 0, mountains: 0, city: 0 };

  let mode = "title"; // title | playing | paused | gameover | win
  let raceTime = 0;
  let lastLapZ = 0;

  function lastY() {
    return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
  }

  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n,
      p1: {
        world: { y: lastY(), z: n * CFG.SEGMENT_LENGTH },
        camera: {},
        screen: {},
      },
      p2: {
        world: { y: y, z: (n + 1) * CFG.SEGMENT_LENGTH },
        camera: {},
        screen: {},
      },
      curve: curve,
      sprites: [],
      cars: [],
      color: Math.floor(n / CFG.RUMBLE_LENGTH) % 2 ? COLORS.dark : COLORS.light,
      clip: CFG.HEIGHT,
    });
  }

  function addRoad(enter, hold, leave, curve, y) {
    const startY = lastY();
    const endY = startY + (y || 0);
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    }
    for (let n = 0; n < hold; n++) {
      addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    }
    for (let n = 0; n < leave; n++) {
      addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
    }
  }

  function addStraight(num, y) {
    addRoad(num, num, num, 0, y);
  }
  function addCurve(num, curve, y) {
    addRoad(num, num, num, curve, y);
  }
  function addHill(num, y) {
    addRoad(num, num, num, 0, y);
  }

  function easeIn(a, b, p) {
    return a + (b - a) * p * p;
  }
  function easeOut(a, b, p) {
    return a + (b - a) * (1 - (1 - p) * (1 - p));
  }
  function easeInOut(a, b, p) {
    return a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5);
  }
  function interpolate(a, b, p) {
    return a + (b - a) * p;
  }
  function percentRemaining(n, total) {
    return (n % total) / total;
  }

  function roadsideFor(segment, i) {
    const side = i % 2 === 0 ? -1 : 1;
    const far = 1.3 + (i % 5) * 0.25;
    if (i % 9 === 0) segment.sprites.push({ src: SPRITES.palm, offset: side * (1.5 + (i % 3) * 0.2) });
    else if (i % 7 === 0) segment.sprites.push({ src: SPRITES.pylon, offset: side * 1.85 });
    else if (i % 5 === 0) segment.sprites.push({ src: SPRITES.lamp, offset: side * 1.18 });
    else if (i % 4 === 0) segment.sprites.push({ src: SPRITES.cactus, offset: side * far });
    else if (i % 3 === 0) segment.sprites.push({ src: SPRITES.bush, offset: side * (1.4 + (i % 4) * 0.15) });
    if (i % 21 === 0) segment.sprites.push({ src: SPRITES.billboard, offset: side * 1.7 });
    if (i % 17 === 0) segment.sprites.push({ src: SPRITES.sign, offset: side * 1.22 });
  }

  function resetFuelPickups() {
    for (let i = 0; i < segments.length; i++) {
      segments[i].sprites = segments[i].sprites.filter(function (sp) {
        return !sp.pickup;
      });
    }
    let n = 0;
    for (let i = 48; i < segments.length - 20; i += CFG.FUEL_SPACING) {
      const side = n % 2 === 0 ? -1 : 1;
      segments[i].sprites.push({
        src: SPRITES.fuel,
        offset: side * 1.1,
        pickup: true,
      });
      n += 1;
    }
  }

  function buildTrack() {
    segments.length = 0;
    addStraight(25, 0);
    addHill(18, 420);
    addCurve(22, -4, 180);
    addStraight(12, -280);
    addCurve(18, 5, -80);
    addHill(16, -520);
    addCurve(26, 6, 280);
    addStraight(14, 0);
    addCurve(20, -6, 360);
    addHill(22, 640);
    addCurve(16, 3, -380);
    addStraight(18, -160);
    addCurve(28, -5, 120);
    addHill(14, 480);
    addCurve(22, 7, -220);
    addStraight(20, 0);
    addCurve(18, -3, 140);
    addHill(20, -580);
    addCurve(24, 4, 200);
    addStraight(30, 0);

    for (let i = 0; i < segments.length; i++) {
      if (i % 2 === 0) roadsideFor(segments[i], i);
    }

    trackLength = segments.length * CFG.SEGMENT_LENGTH;
    resetFuelPickups();
  }

  function findSegment(z) {
    const i = Math.floor(z / CFG.SEGMENT_LENGTH) % segments.length;
    return segments[(i + segments.length) % segments.length];
  }

  function isHeavy(sprite) {
    return sprite === SPRITES.truck || sprite === SPRITES.tanker;
  }

  function resetCars() {
    cars.length = 0;
    const kinds = [
      SPRITES.truck, SPRITES.pink, SPRITES.tanker, SPRITES.truck,
      SPRITES.blue, SPRITES.truck, SPRITES.violet, SPRITES.tanker,
    ];
    const laneOffsets = [-0.62, 0, 0.62];
    for (let i = 0; i < CFG.TRAFFIC_COUNT; i++) {
      const kind = kinds[i % kinds.length];
      const heavy = isHeavy(kind);
      const z = playerZCam + CFG.SEGMENT_LENGTH * 30 + (i * (trackLength - playerZCam - CFG.SEGMENT_LENGTH * 40)) / CFG.TRAFFIC_COUNT;
      cars.push({
        offset: laneOffsets[i % 3] + (Math.random() - 0.5) * 0.08,
        z: z % trackLength,
        sprite: kind,
        speed: CFG.MAX_SPEED * (heavy ? 0.2 + Math.random() * 0.22 : 0.32 + Math.random() * 0.45),
        width: kind === SPRITES.tanker ? 0.34 : heavy ? 0.3 : CFG.CAR_WIDTH,
      });
    }
  }

  // =====================================================================
  //  PROJECT / RENDER HELPERS
  // =====================================================================
  function project(p, camX, camY, camZ) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    p.screen.scale = cameraDepth / p.camera.z;
    p.screen.x = Math.round(CFG.WIDTH / 2 + p.screen.scale * p.camera.x * (CFG.WIDTH / 2));
    p.screen.y = Math.round(CFG.HEIGHT / 2 - p.screen.scale * p.camera.y * (CFG.HEIGHT / 2));
    p.screen.w = Math.round(p.screen.scale * CFG.ROAD_WIDTH * (CFG.WIDTH / 2));
  }

  function polygon(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  function rumbleWidth(projectedRoadWidth, lanes) {
    return projectedRoadWidth / Math.max(6, 2 * lanes);
  }
  function laneMarkerWidth(projectedRoadWidth, lanes) {
    return projectedRoadWidth / Math.max(32, 8 * lanes);
  }

  function fogAlpha(n) {
    return n / CFG.DRAW_DISTANCE;
  }

  function renderSegment(x1, y1, w1, x2, y2, w2, color) {
    const r1 = rumbleWidth(w1, CFG.LANES);
    const r2 = rumbleWidth(w2, CFG.LANES);
    const l1 = laneMarkerWidth(w1, CFG.LANES);
    const l2 = laneMarkerWidth(w2, CFG.LANES);

    ctx.fillStyle = color.grass;
    ctx.fillRect(0, y2, CFG.WIDTH, y1 - y2);

    polygon(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, color.shoulder);
    polygon(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, color.shoulder);
    polygon(x1 - w1 - r1, y1, x1 - w1 - r1 - r1, y1, x2 - w2 - r2 - r2, y2, x2 - w2 - r2, y2, color.rumble);
    polygon(x1 + w1 + r1, y1, x1 + w1 + r1 + r1, y1, x2 + w2 + r2 + r2, y2, x2 + w2 + r2, y2, color.rumble);
    polygon(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, color.road);

    // Dashes only on "light" slices so they flicker past like painted lane markers
    if (color === COLORS.light) {
      const laneW1 = (w1 * 2) / CFG.LANES;
      const laneW2 = (w2 * 2) / CFG.LANES;
      let lx1 = x1 - w1 + laneW1;
      let lx2 = x2 - w2 + laneW2;
      for (let lane = 1; lane < CFG.LANES; lx1 += laneW1, lx2 += laneW2, lane++) {
        polygon(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, color.lane);
      }
    }
  }

  function drawSprite(sprite, scale, destX, destY, offsetX, offsetY, clipY) {
    const destW = sprite.width * scale * (CFG.WIDTH / 2) * CFG.SPRITE_SCALE * CFG.ROAD_WIDTH;
    const destH = sprite.height * scale * (CFG.WIDTH / 2) * CFG.SPRITE_SCALE * CFG.ROAD_WIDTH;
    destX = destX + destW * (offsetX || 0);
    destY = destY + destH * (offsetY || 0);

    let clipH = clipY ? Math.max(0, destY + destH - clipY) : 0;
    if (clipH >= destH) return;

    ctx.imageSmoothingEnabled = false;
    if (clipH > 0) {
      const srcH = sprite.height * (1 - clipH / destH);
      ctx.drawImage(sprite, 0, 0, sprite.width, srcH, destX, destY, destW, destH - clipH);
    } else {
      ctx.drawImage(sprite, destX, destY, destW, destH);
    }
  }

  function exponentialFog(distance, density) {
    return 1 / Math.pow(Math.E, distance * distance * density);
  }

  // =====================================================================
  //  UPDATE
  // =====================================================================
  function overlap(x1, w1, x2, w2, percent) {
    const half = (percent || 1) / 2;
    const min1 = x1 - w1 * half;
    const max1 = x1 + w1 * half;
    const min2 = x2 - w2 * half;
    const max2 = x2 + w2 * half;
    return !(max1 < min2 || min1 > max2);
  }

  function increase(start, increment, max) {
    let result = start + increment;
    while (result >= max) result -= max;
    while (result < 0) result += max;
    return result;
  }

  function limit(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function accelerate(v, accel, dt) {
    return v + accel * dt;
  }

  function updateCars(dt, playerSegment, playerW) {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const oldSeg = findSegment(car.z);
      car.z = increase(car.z, dt * car.speed, trackLength);
      const newSeg = findSegment(car.z);

      // Slight lane drift so packs aren't perfectly rigid
      car.offset += Math.sin((car.z * 0.0004) + i) * 0.0008;

      if (oldSeg !== newSeg) {
        const idx = oldSeg.cars.indexOf(car);
        if (idx >= 0) oldSeg.cars.splice(idx, 1);
        newSeg.cars.push(car);
      }

      // Avoid the player somewhat if we're about to overlap in Z
      if (newSeg === playerSegment) {
        if (overlap(player.x, playerW, car.offset, car.width, 1.2)) {
          // nudge NPC if possible
          car.offset += car.offset > player.x ? 0.01 : -0.01;
        }
      }
    }
  }

  function update(dt) {
    if (mode !== "playing") return;

    const speedPct = player.speed / CFG.MAX_SPEED;
    const dx = dt * 2 * speedPct; // steering step
    const startZ = player.z;
    const playerW = CFG.PLAYER_WIDTH;

    player.invuln = Math.max(0, player.invuln - dt);
    player.hitTimer = Math.max(0, player.hitTimer - dt);
    player.pickupTimer = Math.max(0, player.pickupTimer - dt);
    hitFlash.classList.toggle("on", player.hitTimer > 0.12);
    if (pickupMsg) {
      pickupMsg.classList.toggle("hidden", player.pickupTimer <= 0);
    }

    const playerSegment = findSegment(player.z + playerZCam);
    const playerPercent = percentRemaining(player.z + playerZCam, CFG.SEGMENT_LENGTH);
    player.y = interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

    if (keys.left) player.x -= dx;
    else if (keys.right) player.x += dx;

    // Curves shove the car toward the outside (centrifugal)
    player.x -= dx * speedPct * playerSegment.curve * CFG.CENTRIFUGAL;

    if (keys.up) player.speed = accelerate(player.speed, CFG.ACCEL, dt);
    else if (keys.down) player.speed = accelerate(player.speed, CFG.BREAKING, dt);
    else player.speed = accelerate(player.speed, CFG.DECEL, dt);

    const offRoad = Math.abs(player.x) > 1;
    if (offRoad) {
      if (player.speed > CFG.OFF_ROAD_LIMIT) {
        player.speed = accelerate(player.speed, CFG.OFF_ROAD_DECEL, dt);
      }
    }

    player.speed = limit(player.speed, 0, CFG.MAX_SPEED);
    player.x = limit(player.x, -CFG.STEER_MARGIN, CFG.STEER_MARGIN);
    player.z = increase(player.z, dt * player.speed, trackLength);

    // Lap: crossed the start line going forward
    if (startZ > player.z && player.speed > 0) {
      player.lap += 1;
      if (player.lap > CFG.TOTAL_LAPS) {
        player.lap = CFG.TOTAL_LAPS;
        player.finished = true;
        endRace("win");
        return;
      }
    }
    lastLapZ = player.z;

    updateCars(dt, findSegment(player.z + playerZCam), playerW);

    // Collide with NPCs in our segment and the next one
    const seg = findSegment(player.z + playerZCam);
    const next = segments[(seg.index + 1) % segments.length];
    checkCollisions(seg, playerW);
    checkCollisions(next, playerW);
    checkFuel(seg);
    checkFuel(next);
    const prev = segments[(seg.index - 1 + segments.length) % segments.length];
    checkFuel(prev);

    // Fuel
    player.fuel -= (CFG.FUEL_IDLE + CFG.FUEL_RACE * speedPct) * dt;
    if (player.fuel <= 0) {
      player.fuel = 0;
      endRace("fuel");
      return;
    }

    // Parallax — scroll with curve * speed so the skyline leans into turns
    bgOff.sky += CFG.BG_SKY_SPEED * playerSegment.curve * speedPct * CFG.WIDTH;
    bgOff.mountains += CFG.BG_MOUNTAIN_SPEED * playerSegment.curve * speedPct * CFG.WIDTH;
    bgOff.city += CFG.BG_CITY_SPEED * playerSegment.curve * speedPct * CFG.WIDTH;

    raceTime += dt;
    updateHud();
  }

  function checkFuel(segment) {
    if (!segment) return;
    for (let i = segment.sprites.length - 1; i >= 0; i--) {
      const sp = segment.sprites[i];
      if (!sp.pickup) continue;
      if (overlap(player.x, 0.42, sp.offset, 0.5, 1)) {
        player.fuel = Math.min(100, player.fuel + CFG.FUEL_PICKUP);
        segment.sprites.splice(i, 1);
        player.pickupTimer = 1.1;
        if (pickupMsg) {
          pickupMsg.textContent = "BENZİN +" + CFG.FUEL_PICKUP + "%";
          pickupMsg.classList.remove("hidden");
        }
      }
    }
  }

  function checkCollisions(segment, playerW) {
    if (player.invuln > 0) return;
    for (let n = 0; n < segment.cars.length; n++) {
      const car = segment.cars[n];
      if (overlap(player.x, playerW, car.offset, car.width, 0.8)) {
        player.speed *= CFG.HIT_SPEED_FACTOR;
        player.damage = Math.min(100, player.damage + CFG.DAMAGE_PER_HIT);
        player.invuln = CFG.INVULN_TIME;
        player.hitTimer = 0.35;
        if (player.damage >= 100) endRace("damage");
        return;
      }
    }
  }

  function updateHud() {
    const kmh = Math.round((player.speed / CFG.MAX_SPEED) * CFG.KMH_MAX);
    const lap = String(player.lap).padStart(2, "0");
    const total = String(CFG.TOTAL_LAPS).padStart(2, "0");
    lapLabel.textContent = "TUR " + lap + "/" + total;
    const lapProgress = ((player.lap - 1) + player.z / trackLength) / CFG.TOTAL_LAPS;
    lapFill.style.width = limit(lapProgress, 0, 1) * 100 + "%";
    fuelFill.style.transform = "scaleX(" + (player.fuel / 100) + ")";
    damageFill.style.width = player.damage + "%";
    damagePct.textContent = Math.round(player.damage) + "%";
    damagePct.style.color = player.damage > 66 ? "#ff2d8a" : player.damage > 33 ? "#ffd36a" : "#3dff8a";
    speedLabel.textContent = "HIZ: " + String(kmh).padStart(3, "0") + " km/s";
    rpmFill.style.width = (player.speed / CFG.MAX_SPEED) * 100 + "%";
  }

  // =====================================================================
  //  RENDER
  // =====================================================================
  function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#12061f";
    ctx.fillRect(0, 0, CFG.WIDTH, CFG.HEIGHT);

    const baseSegment = findSegment(player.z);
    const basePercent = percentRemaining(player.z, CFG.SEGMENT_LENGTH);
    const playerSegment = findSegment(player.z + playerZCam);
    const playerPercent = percentRemaining(player.z + playerZCam, CFG.SEGMENT_LENGTH);
    const playerY = interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

    // Sky + parallax layers sit on the horizon; hills shift destY a little
    const hillOffset = Math.round((playerY / CFG.CAMERA_HEIGHT) * 40);
    ctx.drawImage(BG.sky, 0, -20 - hillOffset, CFG.WIDTH, 300);
    drawParallax(BG.mountains, bgOff.mountains, 150 - hillOffset, 130);
    drawParallax(BG.city, bgOff.city, 175 - hillOffset, 140);

    let maxy = CFG.HEIGHT;
    let x = 0;
    let dx = -(baseSegment.curve * basePercent);

    // Project every visible segment (front to back for coords, draw back to front)
    for (let n = 0; n < CFG.DRAW_DISTANCE; n++) {
      const segment = segments[(baseSegment.index + n) % segments.length];
      segment.looped = segment.index < baseSegment.index;
      segment.fog = exponentialFog(n / CFG.DRAW_DISTANCE, CFG.FOG_DENSITY);
      segment.clip = maxy;

      const camZ = player.z - (segment.looped ? trackLength : 0);
      project(segment.p1, player.x * CFG.ROAD_WIDTH - x, playerY + CFG.CAMERA_HEIGHT, camZ);
      project(segment.p2, player.x * CFG.ROAD_WIDTH - x, playerY + CFG.CAMERA_HEIGHT, camZ);

      x += dx;
      dx += segment.curve;

      if (
        segment.p1.camera.z <= cameraDepth ||
        segment.p2.screen.y >= segment.p1.screen.y ||
        segment.p2.screen.y >= maxy
      ) {
        continue;
      }

      renderSegment(
        segment.p1.screen.x,
        segment.p1.screen.y,
        segment.p1.screen.w,
        segment.p2.screen.x,
        segment.p2.screen.y,
        segment.p2.screen.w,
        segment.color
      );

      // Haze toward the vanishing point
      const a = 1 - segment.fog;
      if (a > 0.02) {
        ctx.fillStyle = "rgba(255, 140, 70, " + a * 0.22 + ")";
        ctx.fillRect(0, segment.p2.screen.y, CFG.WIDTH, segment.p1.screen.y - segment.p2.screen.y);
      }

      maxy = segment.p2.screen.y;
    }

    // Sprites & cars — nearest last so they occlude correctly
    for (let n = CFG.DRAW_DISTANCE - 1; n > 0; n--) {
      const segment = segments[(baseSegment.index + n) % segments.length];
      if (!segment.p1.screen.scale) continue;

      for (let i = 0; i < segment.cars.length; i++) {
        const car = segment.cars[i];
        const spriteScale = interpolate(segment.p1.screen.scale, segment.p2.screen.scale, 0.5);
        const spriteX = interpolate(segment.p1.screen.x, segment.p2.screen.x, 0.5) +
          interpolate(segment.p1.screen.w, segment.p2.screen.w, 0.5) * car.offset;
        const spriteY = interpolate(segment.p1.screen.y, segment.p2.screen.y, 0.5);
        drawSprite(car.sprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);
      }

      for (let i = 0; i < segment.sprites.length; i++) {
        const sp = segment.sprites[i];
        const spriteScale = segment.p1.screen.scale * (sp.pickup ? 1.55 : 1);
        const spriteX = segment.p1.screen.x + segment.p1.screen.w * sp.offset;
        const spriteY = segment.p1.screen.y;
        drawSprite(sp.src, spriteScale, spriteX, spriteY, sp.offset < 0 ? -1 : 0, -1, segment.clip);
      }
    }

    drawPlayer();
  }

  function drawPlayer() {
    const bounce = player.speed > 80 ? (Math.random() * 2.2 - 1.1) * (player.speed / CFG.MAX_SPEED) : 0;
    const destX = CFG.WIDTH / 2 + player.x * 18;
    const destY = CFG.HEIGHT - 10 + bounce + (player.hitTimer > 0 ? Math.sin(player.hitTimer * 40) * 3 : 0);
    const steer = keys.left ? -1 : keys.right ? 1 : 0;
    const spr = player.speed > CFG.MAX_SPEED * 0.35 ? SPRITES.player : SPRITES.playerIdle;

    ctx.save();
    ctx.translate(destX, destY);
    ctx.rotate(steer * 0.03);
    const scale = 4.8;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      spr,
      (-spr.width * scale) / 2,
      -spr.height * scale,
      spr.width * scale,
      spr.height * scale
    );
    ctx.restore();

    // Speed lines
    if (player.speed > CFG.MAX_SPEED * 0.55) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const sx = (i * 97 + (performance.now() * 0.4)) % CFG.WIDTH;
        const sy = 280 + (i * 37) % 220;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy + 18 + (player.speed / CFG.MAX_SPEED) * 20);
        ctx.stroke();
      }
    }
  }

  // =====================================================================
  //  GAME STATE
  // =====================================================================
  function resetRace() {
    player.x = 0;
    player.z = 0;
    player.y = 0;
    player.speed = 0;
    player.lap = 1;
    player.fuel = 100;
    player.pickupTimer = 0;
    if (pickupMsg) pickupMsg.classList.add("hidden");
    player.damage = 0;
    player.invuln = 0;
    player.hitTimer = 0;
    player.finished = false;
    raceTime = 0;
    lastLapZ = 0;
    bgOff.sky = bgOff.mountains = bgOff.city = 0;
    keys.left = keys.right = keys.up = keys.down = false;

    segments.forEach((s) => {
      s.cars = [];
    });
    resetFuelPickups();
    resetCars();
    cars.forEach((car) => {
      findSegment(car.z).cars.push(car);
    });
    updateHud();
  }

  function enterFullscreen() {
    const el = stage || document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      const p = req.call(el);
      if (p && p.catch) p.catch(function () {});
    }
  }

  function setOverlay(titleHtml, sub, buttonText, variant) {
    overlay.classList.remove("hidden");
    overlayInner.innerHTML =
      titleHtml +
      (sub ? '<p class="ver">' + sub + "</p>" : "") +
      '<p class="blink" id="overlay-prompt">ENTER / TIKLA</p>' +
      '<div class="overlay-actions">' +
      '<button type="button" id="start-btn" class="arcade-btn">' +
      (buttonText || "TEKRAR") +
      "</button>" +
      (variant === "pause"
        ? '<button type="button" id="fs-btn" class="arcade-btn alt">TAM EKRAN</button>'
        : "") +
      "</div>";
    document.getElementById("start-btn").addEventListener("click", onConfirm);
    const fsBtn = document.getElementById("fs-btn");
    if (fsBtn) {
      fsBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        enterFullscreen();
      });
    }
  }

  function startPlaying() {
    resetRace();
    mode = "playing";
    overlay.classList.add("hidden");
    hud.classList.remove("hidden");
    enterFullscreen();
  }

  function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "." + String(cs).padStart(2, "0");
  }

  function endRace(reason) {
    mode = reason === "win" ? "win" : "gameover";
    hud.classList.add("hidden");
    hitFlash.classList.remove("on");
    if (reason === "win") {
      setOverlay(
        '<p class="kicker">FİNİŞ ÇİZGİSİ</p><h1>KAZANDIN</h1>',
        "SÜRE " + formatTime(raceTime) + "  ·  HASAR %" + Math.round(player.damage),
        "TEKRAR YARIŞ"
      );
    } else if (reason === "fuel") {
      setOverlay(
        '<p class="kicker">BENZİN BİTTİ</p><h1>OYUN BİTTİ</h1>',
        "Depo tur " + player.lap + "/" + CFG.TOTAL_LAPS + " sırasında boşaldı.",
        "TEKRAR"
      );
    } else {
      setOverlay(
        '<p class="kicker">KAZA</p><h1>OYUN BİTTİ</h1>',
        "Hasar %100'e çıktı — şasi bir darbe daha kaldıramadı.",
        "TEKRAR"
      );
    }
  }

  function resumeFromPause() {
    if (mode !== "paused") return;
    mode = "playing";
    overlay.classList.add("hidden");
    hud.classList.remove("hidden");
    enterFullscreen();
  }

  function onConfirm() {
    if (mode === "title" || mode === "gameover" || mode === "win") {
      startPlaying();
    } else if (mode === "paused") {
      resumeFromPause();
    }
  }

  function togglePause() {
    if (mode === "playing") {
      mode = "paused";
      hud.classList.add("hidden");
      setOverlay(
        '<p class="kicker">DURAKLATILDI</p><h1>DUR</h1>',
        "Devam etmek için butona bas veya ENTER",
        "DEVAM ET",
        "pause"
      );
    } else if (mode === "paused") {
      resumeFromPause();
    }
  }

  function restoreTitle() {
    mode = "title";
    hud.classList.add("hidden");
    overlay.classList.remove("hidden");
    overlayInner.innerHTML =
      '<p class="kicker">RETRO ARKAD</p>' +
      "<h1>KANKININ<br />YARIŞI</h1>" +
      '<p class="ver">v1.0 — ÇÖL OTOYOLU</p>' +
      '<p class="blink" id="overlay-prompt">BAŞLAMAK İÇİN ENTER / TIKLA</p>' +
      '<ul class="help"><li><kbd>↑</kbd><kbd>W</kbd> GAZ</li>' +
      "<li><kbd>↓</kbd><kbd>S</kbd> FREN</li>" +
      "<li><kbd>←</kbd><kbd>A</kbd> <kbd>→</kbd><kbd>D</kbd> DİREKSİYON</li>" +
      "<li><kbd>P</kbd> DURAKLAT</li></ul>" +
      '<p class="hint">Trafikten kaç · asfaltta kal · kenardaki benzini kap · hasar veya depo bitmeden 3 turu tamamla.</p>' +
      '<button type="button" id="start-btn" class="arcade-btn">MOTORU ÇALIŞTIR</button>';
    document.getElementById("start-btn").addEventListener("click", onConfirm);
  }

  // =====================================================================
  //  LOOP
  // =====================================================================
  let last = performance.now();

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function boot() {
    buildSprites();
    buildBackgrounds();
    buildTrack();
    resetRace();
    bindInput();
    restoreTitle();
    requestAnimationFrame(loop);
  }

  // Live tweaks from DevTools: CursorRacing.CFG.TRAFFIC_COUNT, CursorRacing.keys.up = true
  window.CursorRacing = {
    CFG: CFG,
    keys: keys,
    player: player,
    cars: cars,
    trackLength: function () { return trackLength; },
    getMode: function () { return mode; },
    step: function (dt) {
      update(typeof dt === "number" ? dt : 1 / 60);
      render();
    },
  };

  boot();
})();
