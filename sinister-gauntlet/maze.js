/* global Phaser */
"use strict";

const MAZE = {
  tile: 64,
  speed: 235,
  goblinSpeed: 270,
  skeletonSpeed: 190,
  kingSpeed: 294,
  kingDash: 256,
  skeletonArrowSpeed: 200,
  goldArrowCost: 5,
  goal: 30,
  cooldown: 360,
  goblinCap: 5,
  goblinInterval: 2500,
  goblinChestDamage: 1,
  goblinChestCooldown: 700,
  chestHp: 3,
  skeletonCap: 4,
  skeletonInterval: 4000,
  skeletonWindup: 700,
  skeletonReload: 2400,
  kingHp: 8,
  kingDamage: 25,
  kingStun: 3000,
  kingWindup: 1000,
  skeletonArrowDamage: 10,
  chestRespawn: 10000,
  repath: 250,
  invulnerable: 450
};

const MAZE_ROWS = [
  "#########################",
  "#########################",
  "##....####..C..####....##",
  "##.C..##.......####..C.##",
  "##.....#.#########.....##",
  "#####..#.....#####..#####",
  "##.......###.###.......##",
  "##.#####.#.....#.#####.##",
  "##...##........#.###...##",
  "##.C.##.....A....###.C.##",
  "##...##.##........##...##",
  "####.##.##.....##.##.####",
  "##......####.####....####",
  "##.#########.....###...##",
  "##....##...###...##....##",
  "##.C..##.#.......##..C.##",
  "##.......#..C..#.......##",
  "#########################",
  "#########################"
];

const mazeUi = Object.fromEntries([
  "health", "gold", "altar", "weapon", "boss", "message", "overlay",
  "overlay-title", "overlay-copy", "play"
].map(id => [id, document.getElementById(id)]));

class Maze extends Phaser.Scene {
  constructor() { super("Maze"); }

  create() {
    this.prepareRun();
    this.makeTextures();
    this.createGroups();
    this.buildMap();
    this.createPlayer();
    this.bindPhysics();
    this.bindInput();
    this.cameras.main.setBounds(0, 0, this.cols * MAZE.tile, this.rows * MAZE.tile);
    this.cameras.main.startFollow(this.player, true, 1, 1);
    this.bars = this.add.graphics().setDepth(9);
    this.physics.world.pause();
    this.refreshHud();
    this.showHowTo();
  }

  prepareRun() {
    this.started = false;
    this.ended = false;
    this.pausedGame = false;
    this.health = 100;
    this.gold = 0;
    this.altarGold = 0;
    this.kingSummoned = false;
    this.aim = 0;
    this.nextAttack = 0;
    this.invulnerableUntil = 0;
    this.playTime = 0;
    this.nextGoblin = MAZE.goblinInterval;
    this.nextSkeleton = MAZE.skeletonInterval;
    this.king = null;
    this.respawns = [];
    this.messageUntil = 0;
    this.cols = MAZE_ROWS[0].length;
    this.rows = MAZE_ROWS.length;
    this.grid = MAZE_ROWS.map(row => row.split(""));
    this.centerTiles = [];
    this.edgeTiles = [];
    this.altarCol = 0;
    this.altarRow = 0;
    this.physics.world.setBounds(0, 0, this.cols * MAZE.tile, this.rows * MAZE.tile);
  }

  createGroups() {
    this.walls = this.physics.add.staticGroup();
    this.chests = this.physics.add.staticGroup();
    this.coins = this.physics.add.staticGroup();
    this.goblins = this.physics.add.group();
    this.skeletons = this.physics.add.group();
    this.enemyShots = this.physics.add.group();
    this.kings = this.physics.add.group();
  }

  createPlayer() {
    const start = this.world(this.altarCol, this.altarRow + 2);
    this.player = this.physics.add.sprite(start.x, start.y, "player").setDepth(5);
    this.player.setCircle(15, 5, 5).setCollideWorldBounds(true).setBounce(0.2);
    this.playerLabel = this.add.text(start.x, start.y - 28, "YOU", {
      fontSize: "14px", color: "#ffffff"
    }).setOrigin(0.5).setDepth(10);
  }

  bindPhysics() {
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.goblins, this.walls);
    this.physics.add.collider(this.skeletons, this.walls);
    this.physics.add.overlap(this.player, this.coins, (a, b) => this.collectPlayer(a, b));
    this.physics.add.overlap(this.goblins, this.coins, (a, b) => this.collectGoblin(a, b));
    this.physics.add.overlap(this.player, this.enemyShots, (a, b) => this.enemyArrowHit(a, b, true));
    this.physics.add.collider(this.enemyShots, this.walls, shot => this.destroyShot(shot));
    this.physics.add.overlap(this.enemyShots, this.chests, (a, b) => this.enemyArrowHit(a, b, false));
    this.physics.add.overlap(this.enemyShots, this.goblins, (a, b) => this.enemyArrowHit(a, b, false));
    this.physics.add.overlap(this.enemyShots, this.skeletons, (a, b) => this.enemyArrowHit(a, b, false));
    this.physics.add.overlap(this.enemyShots, this.kings, (a, b) => this.enemyArrowHit(a, b, false));
    this.physics.add.overlap(this.kings, this.walls, (a, b) => this.kingBreakWall(a, b));
    this.physics.add.overlap(this.player, this.kings, () => this.kingHitsPlayer());
  }

  bindInput() {
    this.keys = this.input.keyboard.addKeys({
      up: "W", down: "S", left: "A", right: "D", pause: "P", restart: "R"
    });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on("keydown-P", () => this.togglePause());
    this.input.keyboard.on("keydown-R", () => this.restartRun());
    this.input.mouse.disableContextMenu();
    this.input.on("pointermove", pointer => {
      if (this.started && !this.pausedGame && !this.ended) this.aimAt(pointer);
    });
    this.input.on("pointerdown", pointer => this.onPointerDown(pointer));
    mazeUi.play.onclick = () => this.onPlayClicked();
  }

  onPlayClicked() {
    if (this.ended) this.restartRun();
    else if (this.pausedGame) this.togglePause();
    else this.begin();
  }

  onPointerDown(pointer) {
    if (!pointer.leftButtonDown() && pointer.button !== 0) return;
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, point.x, point.y);
    this.clickAttack(point.x, point.y);
  }

  showHowTo() {
    mazeUi.overlay.hidden = false;
    mazeUi["overlay-title"].textContent = "How to play";
    mazeUi["overlay-copy"].innerHTML = this.game.registry.get("maze-instructions") || mazeUi["overlay-copy"].innerHTML;
    this.game.registry.set("maze-instructions", mazeUi["overlay-copy"].innerHTML);
    mazeUi.play.textContent = "Start";
    this.notice("Break gold chests. Keep goblins from filling the altar.", 100000);
  }

  makeTextures() {
    if (this.textures.exists("player")) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const paint = (key, w, h, draw) => { g.clear(); draw(g); g.generateTexture(key, w, h); };
    this.paintActors(paint);
    this.paintProps(paint);
    this.paintKing(paint);
    g.destroy();
  }

  paintActors(paint) {
    paint("player", 40, 40, g => {
      g.fillStyle(0x4199ff).fillRect(5, 5, 30, 30);
      g.fillStyle(0xffffff).fillTriangle(39, 20, 25, 14, 25, 26);
    });
    paint("goblin", 36, 36, g => {
      g.fillStyle(0x72c951).fillRect(4, 4, 28, 28);
      g.fillStyle(0x222222).fillRect(10, 12, 5, 5).fillRect(21, 12, 5, 5);
    });
    paint("skeleton", 36, 36, g => {
      g.fillStyle(0xeeeeee).fillRect(4, 4, 28, 28);
      g.fillStyle(0x222222).fillRect(10, 12, 5, 5).fillRect(21, 12, 5, 5);
    });
  }

  paintProps(paint) {
    paint("chest", 44, 34, g => {
      g.fillStyle(0xa46e38).fillRect(0, 0, 44, 34);
      g.fillStyle(0xe2c16c).fillRect(0, 12, 44, 4).fillRect(19, 10, 6, 11);
    });
    paint("pillar", 64, 64, g => { g.fillStyle(0x666666).fillRect(0, 0, 64, 64); });
    paint("coin", 18, 18, g => { g.fillStyle(0xffd84a).fillRect(2, 2, 14, 14); });
    paint("arrow", 24, 8, g => {
      g.fillStyle(0xffffff).fillRect(0, 3, 19, 2).fillTriangle(24, 4, 16, 0, 16, 8);
    });
  }

  paintKing(paint) {
    paint("king", 64, 80, g => {
      g.fillStyle(0xe2c16c);
      g.fillCircle(32, 16, 10);
      g.fillTriangle(22, 18, 14, 4, 28, 18);
      g.fillTriangle(32, 18, 32, 1, 42, 18);
      g.fillTriangle(42, 18, 50, 4, 54, 18);
      g.fillStyle(0x3d9a32).fillRect(8, 28, 48, 48);
      g.fillStyle(0x111111).fillRect(18, 44, 8, 8).fillRect(38, 44, 8, 8);
    });
  }

  buildMap() {
    const floor = this.add.graphics().setDepth(0);
    floor.fillStyle(0x383838).fillRect(0, 0, this.cols * MAZE.tile, this.rows * MAZE.tile);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) this.placeCell(col, row, floor);
    }
    this.collectCenterTiles();
  }

  placeCell(col, row, floor) {
    const cell = this.grid[row][col];
    if (cell === "#") {
      this.placeWall(col, row);
      return;
    }
    if (this.isEdgeTile(col, row)) this.edgeTiles.push({ col, row });
    if (cell === "A") this.placeAltar(col, row, floor);
    if (cell === "C") this.spawnChest(col, row);
  }

  placeWall(col, row) {
    const spot = this.world(col, row);
    const wall = this.walls.create(spot.x, spot.y, "pillar");
    wall.kind = "wall";
    wall.col = col;
    wall.row = row;
    wall.body.setSize(MAZE.tile, MAZE.tile);
    wall.refreshBody();
  }

  isEdgeTile(col, row) {
    return col <= 2 || row <= 2 || col >= this.cols - 3 || row >= this.rows - 3;
  }

  placeAltar(col, row, floor) {
    const spot = this.world(col, row);
    this.altarCol = col;
    this.altarRow = row;
    floor.fillStyle(0x785797).fillRect(col * MAZE.tile + 8, row * MAZE.tile + 8, 48, 48);
    this.add.text(spot.x, spot.y + 36, "ALTAR", {
      fontSize: "14px", color: "#ffffff"
    }).setOrigin(0.5).setDepth(2);
  }

  collectCenterTiles() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.grid[row][col] === "#") continue;
        const nearAltar = Math.max(Math.abs(col - this.altarCol), Math.abs(row - this.altarRow)) <= 2;
        if (nearAltar) this.centerTiles.push({ col, row });
      }
    }
  }

  world(col, row) {
    return { x: (col + 0.5) * MAZE.tile, y: (row + 0.5) * MAZE.tile };
  }

  tileOf(x, y) {
    return {
      col: Phaser.Math.Clamp(Math.floor(x / MAZE.tile), 0, this.cols - 1),
      row: Phaser.Math.Clamp(Math.floor(y / MAZE.tile), 0, this.rows - 1)
    };
  }

  wallAt(col, row) {
    return this.walls.getChildren().find(wall => wall.active && wall.col === col && wall.row === row) || null;
  }

  chestAt(col, row) {
    return this.chests.getChildren().find(chest => chest.active && chest.col === col && chest.row === row) || null;
  }

  begin() {
    this.started = true;
    mazeUi.overlay.hidden = true;
    this.physics.world.resume();
    this.notice("Left click a monster or chest. Clicking the Goblin King costs 5 gold.", 7000);
    const canvas = document.querySelector("canvas");
    if (canvas) canvas.focus();
  }

  restartRun() { this.scene.restart(); }

  togglePause() {
    if (!this.started || this.ended) return;
    this.pausedGame = !this.pausedGame;
    if (this.pausedGame) {
      this.physics.world.pause();
      this.showOverlay("Paused", "Resume when you're ready. P also resumes the game.", "Resume");
    } else {
      this.physics.world.resume();
      mazeUi.overlay.hidden = true;
      this.input.keyboard.resetKeys();
    }
  }

  aimAt(pointer) {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, point.x, point.y);
  }

  spawnChest(col, row) {
    const spot = this.world(col, row);
    const chest = this.chests.create(spot.x, spot.y, "chest");
    chest.kind = "chest";
    chest.col = col;
    chest.row = row;
    chest.hp = MAZE.chestHp;
    chest.maxHp = MAZE.chestHp;
    chest.setTint(0xffd84a);
    chest.refreshBody();
    return chest;
  }

  dropGold(x, y, amount) {
    for (let i = 0; i < amount; i++) {
      const angle = amount === 1 ? 0 : i * Math.PI * 2 / amount;
      const radius = amount === 1 ? 0 : 10;
      this.coins.create(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, "coin").setDepth(2);
    }
  }

  damageChest(chest, amount) {
    if (!chest || !chest.active) return;
    chest.hp -= amount;
    chest.setTint(0xffffff);
    this.time.delayedCall(90, () => { if (chest.active) chest.setTint(0xffd84a); });
    if (chest.hp <= 0) this.destroyChest(chest);
  }

  destroyChest(chest) {
    if (!chest || !chest.active) return;
    const { x, y, col, row } = chest;
    chest.destroy();
    this.dropGold(x, y, Phaser.Math.Between(3, 5));
    this.respawns.push({ col, row, at: this.playTime + MAZE.chestRespawn });
  }

  spawnGoblin(x, y) {
    if (x === undefined) {
      const tile = Phaser.Utils.Array.GetRandom(this.centerTiles);
      ({ x, y } = this.world(tile.col, tile.row));
    }
    const goblin = this.goblins.create(x, y, "goblin").setDepth(4);
    goblin.kind = "goblin";
    goblin.hp = 1;
    goblin.maxHp = 1;
    goblin.carried = 0;
    goblin.nextRepath = 0;
    goblin.step = null;
    goblin.nextChestHit = 0;
    goblin.setCircle(13, 5, 5).setCollideWorldBounds(true).setBounce(0);
    goblin.marker = this.add.image(x, y - 20, "coin").setDepth(8).setVisible(false);
    goblin.on("destroy", () => {
      if (goblin.marker && goblin.marker.active) goblin.marker.destroy();
    });
    return goblin;
  }

  spawnSkeleton(x, y) {
    if (x === undefined) {
      const tile = Phaser.Utils.Array.GetRandom(this.edgeTiles);
      ({ x, y } = this.world(tile.col, tile.row));
    }
    const skeleton = this.skeletons.create(x, y, "skeleton").setDepth(4);
    skeleton.kind = "skeleton";
    skeleton.hp = 2;
    skeleton.maxHp = 2;
    skeleton.nextRepath = 0;
    skeleton.step = null;
    skeleton.nextShot = this.playTime + MAZE.skeletonWindup;
    skeleton.setCircle(13, 5, 5).setCollideWorldBounds(true).setBounce(0);
    return skeleton;
  }

  collectPlayer(a, b) {
    const coin = a.texture && a.texture.key === "coin" ? a : b;
    if (!this.started || this.ended || !coin.active) return;
    coin.destroy();
    this.gold++;
  }

  collectGoblin(a, b) {
    const goblin = a.kind === "goblin" ? a : b;
    const coin = goblin === a ? b : a;
    if (!this.started || this.ended || !coin.active || !goblin.active || goblin.carried) return;
    coin.destroy();
    goblin.carried = 1;
    goblin.marker.setVisible(true);
  }

  targetAt(x, y) {
    for (const group of [this.kings, this.goblins, this.skeletons, this.chests]) {
      for (const sprite of group.getChildren()) {
        if (!sprite.active || !sprite.body) continue;
        if (sprite.body.hitTest(x, y)) return sprite;
      }
    }
    return null;
  }

  clickAttack(x, y) {
    if (!this.canAct()) return false;
    const target = this.targetAt(x, y);
    if (!target) return false;
    if (target.kind === "king") return this.strikeKing(target);
    this.nextAttack = this.playTime + MAZE.cooldown;
    if (target.kind === "chest") this.destroyChest(target);
    else this.damageMonster(target, 1);
    return true;
  }

  canAct() {
    return this.started && !this.ended && !this.pausedGame && this.playTime >= this.nextAttack;
  }

  strikeKing(king) {
    if (this.gold < MAZE.goldArrowCost) {
      this.notice("Need 5 gold to strike the Goblin King.");
      return false;
    }
    this.gold -= MAZE.goldArrowCost;
    this.nextAttack = this.playTime + MAZE.cooldown;
    this.damageKing(king);
    return true;
  }

  destroyShot(shot) {
    if (shot.active) shot.destroy();
  }

  enemyArrowHit(a, b, hurtsPlayer) {
    const shot = a.kind === "enemy-arrow" ? a : b;
    if (!shot.active) return;
    this.destroyShot(shot);
    if (hurtsPlayer) this.hurtPlayer(MAZE.skeletonArrowDamage, "skeleton arrow");
  }

  damageMonster(target, amount) {
    if (!target.active || this.ended) return;
    target.hp -= amount;
    target.setTint(0xffffff);
    this.time.delayedCall(90, () => { if (target.active) target.clearTint(); });
    if (target.hp > 0) return;
    if (target.kind === "goblin" && target.carried) this.dropGold(target.x, target.y, 1);
    target.destroy();
  }

  damageKing(king) {
    if (!king.active || this.ended) return;
    king.hp -= 1;
    king.setTint(0xffffff);
    this.time.delayedCall(90, () => { if (king.active) king.clearTint(); });
    if (king.hp > 0) return;
    king.destroy();
    this.king = null;
    this.finish(true);
  }

  hurtPlayer(amount, source) {
    if (!this.started || this.ended || this.pausedGame || this.playTime < this.invulnerableUntil) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnerableUntil = this.playTime + MAZE.invulnerable;
    this.player.setTint(0xe48484);
    this.notice(`Hit by ${source}: -${amount} health.`, 1800);
    if (this.health <= 0) this.finish(false);
    return true;
  }

  summonKing() {
    if (this.king && this.king.active) return this.king;
    const spot = this.world(this.altarCol, this.altarRow);
    const king = this.kings.create(spot.x, spot.y, "king").setDepth(6);
    king.kind = "king";
    king.hp = MAZE.kingHp;
    king.maxHp = MAZE.kingHp;
    king.charging = false;
    king.stunUntil = this.playTime + MAZE.kingWindup;
    king.lockX = spot.x;
    king.lockY = spot.y;
    king.setCollideWorldBounds(true).setBounce(0);
    king.body.setSize(48, 48);
    this.king = king;
    this.kingSummoned = true;
    this.notice("The Goblin King is awake. Left click him for 5 gold.", 5000);
    return king;
  }

  kingHitsPlayer() {
    const king = this.king;
    if (!king || !king.active || !king.charging) return;
    if (!this.hurtPlayer(MAZE.kingDamage, "Goblin King")) return;
    king.charging = false;
    king.stunUntil = this.playTime + MAZE.kingStun;
    king.setVelocity(0);
  }

  kingBreakWall(a, b) {
    const wall = a.kind === "wall" ? a : b;
    const king = a.kind === "king" ? a : b;
    if (!king || !king.charging || this.playTime < king.stunUntil || !wall.active) return;
    this.grid[wall.row][wall.col] = ".";
    wall.destroy();
  }

  nextStep(fromCol, fromRow, toCol, toRow) {
    if (fromCol === toCol && fromRow === toRow) return null;
    const key = (col, row) => row * this.cols + col;
    const previous = new Map();
    const seen = new Set([key(fromCol, fromRow)]);
    const queue = [[fromCol, fromRow]];
    while (queue.length) {
      const [col, row] = queue.shift();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextCol = col + dc;
        const nextRow = row + dr;
        if (nextCol < 0 || nextRow < 0 || nextCol >= this.cols || nextRow >= this.rows) continue;
        const id = key(nextCol, nextRow);
        if (seen.has(id) || this.grid[nextRow][nextCol] === "#") continue;
        previous.set(id, [col, row]);
        if (nextCol === toCol && nextRow === toRow) {
          return this.firstStep(previous, fromCol, fromRow, nextCol, nextRow);
        }
        seen.add(id);
        queue.push([nextCol, nextRow]);
      }
    }
    return null;
  }

  firstStep(previous, fromCol, fromRow, goalCol, goalRow) {
    const key = (col, row) => row * this.cols + col;
    let step = [goalCol, goalRow];
    let parent = previous.get(key(goalCol, goalRow));
    while (parent && (parent[0] !== fromCol || parent[1] !== fromRow)) {
      step = parent;
      parent = previous.get(key(parent[0], parent[1]));
    }
    return { col: step[0], row: step[1] };
  }

  steer(actor, goalCol, goalRow, speed) {
    const here = this.tileOf(actor.x, actor.y);
    if (this.playTime >= actor.nextRepath || !actor.step) {
      actor.step = this.nextStep(here.col, here.row, goalCol, goalRow);
      actor.nextRepath = this.playTime + MAZE.repath;
    }
    if (!actor.step) {
      actor.setVelocity(0);
      return;
    }
    const spot = this.world(actor.step.col, actor.step.row);
    if (Phaser.Math.Distance.Between(actor.x, actor.y, spot.x, spot.y) < 8) {
      actor.step = null;
      actor.nextRepath = 0;
    }
    const dx = spot.x - actor.x;
    const dy = spot.y - actor.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) actor.setVelocity(0);
    else if (Math.abs(dx) > Math.abs(dy)) actor.setVelocity(Math.sign(dx) * speed, 0);
    else actor.setVelocity(0, Math.sign(dy) * speed);
  }

  nearestIn(actor, sprites) {
    let best = null;
    let bestDistance = Infinity;
    for (const sprite of sprites) {
      if (!sprite.active) continue;
      const distance = Phaser.Math.Distance.Between(actor.x, actor.y, sprite.x, sprite.y);
      if (distance < bestDistance) {
        best = sprite;
        bestDistance = distance;
      }
    }
    return best;
  }

  nearestChest(actor) {
    return this.nearestIn(actor, this.chests.getChildren());
  }

  nearestCoin(actor) {
    return this.nearestIn(actor, this.coins.getChildren());
  }

  chestInReach(goblin) {
    const chest = this.nearestChest(goblin);
    if (!chest) return null;
    const distance = Phaser.Math.Distance.Between(goblin.x, goblin.y, chest.x, chest.y);
    return distance < 40 ? chest : null;
  }

  strikeChest(goblin) {
    const chest = this.chestInReach(goblin);
    if (!chest || this.playTime < goblin.nextChestHit) return false;
    this.damageChest(chest, MAZE.goblinChestDamage);
    goblin.nextChestHit = this.playTime + MAZE.goblinChestCooldown;
    goblin.setVelocity(0);
    return true;
  }

  updateGoblins() {
    for (const goblin of this.goblins.getChildren()) {
      if (!goblin.active) continue;
      goblin.marker.setPosition(goblin.x, goblin.y - 20);
      if (goblin.carried) this.haulCoin(goblin);
      else this.seekLoot(goblin);
    }
  }

  haulCoin(goblin) {
    const altar = this.world(this.altarCol, this.altarRow);
    if (Phaser.Math.Distance.Between(goblin.x, goblin.y, altar.x, altar.y) < 36) {
      this.depositCoin(goblin);
      return;
    }
    this.steer(goblin, this.altarCol, this.altarRow, MAZE.goblinSpeed);
  }

  depositCoin(goblin) {
    goblin.carried = 0;
    goblin.marker.setVisible(false);
    this.altarGold++;
    if (!this.kingSummoned && this.altarGold >= MAZE.goal) {
      this.kingSummoned = true;
      this.summonKing();
    }
  }

  seekLoot(goblin) {
    if (this.strikeChest(goblin)) return;
    const goal = this.nearestCoin(goblin) || this.nearestChest(goblin);
    if (!goal) {
      goblin.setVelocity(0);
      return;
    }
    const tile = this.tileOf(goal.x, goal.y);
    this.steer(goblin, tile.col, tile.row, MAZE.goblinSpeed);
  }

  shootSkeletonArrow(skeleton) {
    const angle = Phaser.Math.Angle.Between(skeleton.x, skeleton.y, this.player.x, this.player.y);
    const shot = this.enemyShots.create(
      skeleton.x + Math.cos(angle) * 30,
      skeleton.y + Math.sin(angle) * 30,
      "arrow"
    ).setRotation(angle).setDepth(7);
    shot.kind = "enemy-arrow";
    shot.expires = this.playTime + 3000;
    shot.setTint(0xff5353);
    shot.body.setSize(18, 8);
    this.physics.velocityFromRotation(angle, MAZE.skeletonArrowSpeed, shot.body.velocity);
  }

  updateSkeletons() {
    const playerTile = this.tileOf(this.player.x, this.player.y);
    for (const skeleton of this.skeletons.getChildren()) {
      if (!skeleton.active) continue;
      this.steer(skeleton, playerTile.col, playerTile.row, MAZE.skeletonSpeed);
      if (this.playTime >= skeleton.nextShot) {
        this.shootSkeletonArrow(skeleton);
        skeleton.nextShot = this.playTime + MAZE.skeletonReload;
      }
    }
  }

  updateKing() {
    const king = this.king;
    if (!king || !king.active) return;
    if (this.playTime < king.stunUntil) {
      king.setVelocity(0);
      king.charging = false;
      return;
    }
    const arrived = king.charging && Phaser.Math.Distance.Between(king.x, king.y, king.lockX, king.lockY) < 18;
    if (!king.charging || arrived) this.beginKingDash(king);
    this.physics.velocityFromRotation(
      Phaser.Math.Angle.Between(king.x, king.y, king.lockX, king.lockY),
      MAZE.kingSpeed,
      king.body.velocity
    );
  }

  beginKingDash(king) {
    const angle = Phaser.Math.Angle.Between(king.x, king.y, this.player.x, this.player.y);
    king.lockX = king.x + Math.cos(angle) * MAZE.kingDash;
    king.lockY = king.y + Math.sin(angle) * MAZE.kingDash;
    king.charging = true;
  }

  updateRespawns() {
    this.respawns = this.respawns.filter(spot => {
      if (this.playTime < spot.at) return true;
      if (!this.chestAt(spot.col, spot.row)) this.spawnChest(spot.col, spot.row);
      return false;
    });
  }

  drawBars() {
    this.bars.clear();
    const targets = [...this.goblins.getChildren(), ...this.skeletons.getChildren()];
    if (this.king && this.king.active) targets.push(this.king);
    for (const target of targets) {
      if (!target.active || target.hp === target.maxHp) continue;
      const width = target.kind === "king" ? 56 : 32;
      const y = target.y - (target.kind === "king" ? 46 : 24);
      this.bars.fillStyle(0x18151b).fillRect(target.x - width / 2, y, width, 5);
      this.bars.fillStyle(target.kind === "king" ? 0xe2c16c : 0xca727d)
        .fillRect(target.x - width / 2, y, width * Math.max(0, target.hp / target.maxHp), 5);
    }
  }

  notice(text, duration = 3200) {
    mazeUi.message.textContent = text;
    this.messageUntil = this.playTime + duration;
  }

  refreshHud() {
    mazeUi.health.textContent = `Health: ${this.health}/100`;
    mazeUi.gold.textContent = `Gold: ${this.gold}`;
    mazeUi.altar.textContent = `Altar: ${this.altarGold}/${MAZE.goal}`;
    mazeUi.weapon.textContent = "Left click: strike | King click: 5 gold";
    if (this.king && this.king.active) {
      mazeUi.boss.textContent = `Goblin King health: ${Math.max(0, this.king.hp)}/${this.king.maxHp}. Left click him for 5 gold. Each dash is a fixed length. He smashes walls and stops for 3 seconds after he hits you.`;
    } else if (this.kingSummoned) {
      mazeUi.boss.textContent = "The Goblin King is down.";
    } else {
      mazeUi.boss.textContent = `Goal: stop the altar from reaching ${MAZE.goal} (${this.altarGold}/${MAZE.goal}). Left click the king for 5 gold once he wakes.`;
    }
  }

  showOverlay(title, copy, button) {
    mazeUi["overlay-title"].textContent = title;
    mazeUi["overlay-copy"].textContent = copy;
    mazeUi.play.textContent = button;
    mazeUi.overlay.hidden = false;
  }

  finish(won) {
    if (this.ended) return;
    this.ended = true;
    this.physics.world.pause();
    this.refreshHud();
    this.showOverlay(
      won ? "Goblin King defeated!" : "You fell in the maze",
      `${won ? "Clicks brought the king down." : "The dungeon kept the gold, and the king kept charging."} ${this.gold} gold left · altar ${this.altarGold}/${MAZE.goal} · ${Math.floor(this.playTime / 1000)} seconds. Press R or restart below.`,
      "Restart prototype"
    );
    this.notice(won ? "Victory!" : "Run over. Press R to try again.", 100000);
  }

  update(_, delta) {
    if (!this.started || this.ended || this.pausedGame) return;
    this.playTime += Math.min(delta, 50);
    this.movePlayer();
    this.spawnActors();
    this.updateGoblins();
    this.updateSkeletons();
    this.updateKing();
    this.updateRespawns();
    this.expireShots();
    this.refreshIdleMessage();
    this.drawBars();
    this.refreshHud();
  }

  movePlayer() {
    const x = Number(this.keys.right.isDown || this.cursors.right.isDown) - Number(this.keys.left.isDown || this.cursors.left.isDown);
    const y = Number(this.keys.down.isDown || this.cursors.down.isDown) - Number(this.keys.up.isDown || this.cursors.up.isDown);
    const vector = new Phaser.Math.Vector2(x, y).normalize().scale(MAZE.speed);
    this.player.setVelocity(vector.x, vector.y).setRotation(this.aim);
    this.playerLabel.setPosition(this.player.x, this.player.y - 28);
    if (this.playTime >= this.invulnerableUntil) this.player.clearTint();
  }

  spawnActors() {
    if (this.playTime >= this.nextGoblin && this.goblins.countActive() < MAZE.goblinCap) {
      this.spawnGoblin();
      this.nextGoblin = this.playTime + MAZE.goblinInterval;
    }
    if (this.playTime >= this.nextSkeleton && this.skeletons.countActive() < MAZE.skeletonCap) {
      this.spawnSkeleton();
      this.nextSkeleton = this.playTime + MAZE.skeletonInterval;
    }
  }

  expireShots() {
    for (const shot of this.enemyShots.getChildren()) {
      if (shot.active && this.playTime >= shot.expires) shot.destroy();
    }
  }

  refreshIdleMessage() {
    if (this.playTime <= this.messageUntil) return;
    mazeUi.message.textContent = this.kingSummoned
      ? "Left click the king for 5 gold. Left click other monsters for free."
      : "Left click chests and monsters. Goblins haul one coin at a time back to the altar.";
  }
}

window.MAZE = MAZE;
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1000,
  height: 640,
  parent: "game",
  backgroundColor: "#262329",
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: Maze,
  render: { antialias: false },
  audio: { noAudio: true }
});
