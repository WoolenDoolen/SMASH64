/* global Phaser */
"use strict";

const RULES = {
  width: 1800, height: 1400, goal: 30, speed: 235,
  weapons: [
    { name: "Sword", damage: 2, range: 108, arc: 0.48, cooldown: 290 },
    { name: "Axe", damage: 3, range: 118, arc: 1.8, cooldown: 700 },
    { name: "Bow", damage: 2, cooldown: 360 }
  ]
};
const ui = Object.fromEntries([
  "health", "gold", "weapon", "rivals", "boss", "message", "overlay",
  "overlay-title", "overlay-copy", "play"
].map(id => [id, document.getElementById(id)]));

class Dungeon extends Phaser.Scene {
  constructor() { super("Dungeon"); }

  create() {
    this.started = false;
    this.ended = false;
    this.pausedGame = false;
    this.health = 100;
    this.gold = 8;
    this.enemyGold = { goblin: 0, skeleton: 0 };
    this.weaponIndex = 0;
    this.aim = 0;
    this.nextAttack = 0;
    this.invulnerableUntil = 0;
    this.nextSpawn = 2000;
    this.nextChest = 14000;
    this.nextGold = 10000;
    this.playTime = 0;
    this.kills = 0;
    this.boss = null;
    this.bossParts = [];
    this.effectUntil = 0;
    this.messageUntil = 0;
    this.makeTextures();
    this.physics.world.setBounds(32, 32, RULES.width - 64, RULES.height - 64);
    this.drawRoom();

    this.obstacles = this.physics.add.staticGroup();
    for (const [x, y] of [[420, 330], [1380, 330], [420, 1070], [1380, 1070], [680, 480], [1120, 920]]) {
      const pillar = this.obstacles.create(x, y, "pillar");
      pillar.body.setCircle(29, 3, 3);
    }
    this.chests = this.physics.add.staticGroup();
    this.coins = this.physics.add.staticGroup();
    this.heals = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.playerShots = this.physics.add.group();
    this.enemyShots = this.physics.add.group();
    this.parts = this.physics.add.group();
    this.player = this.physics.add.sprite(900, 700, "player").setDepth(5);
    this.player.setCircle(15, 5, 5).setCollideWorldBounds(true).setBounce(0.2);

    this.physics.add.collider(this.player, this.obstacles);
    this.physics.add.collider(this.player, this.chests);
    this.physics.add.collider(this.enemies, this.obstacles);
    this.physics.add.collider(this.enemies, this.chests);
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.collider(this.player, this.parts, () => this.hurtPlayer(12));
    this.physics.add.overlap(this.player, this.enemies, () => this.hurtPlayer(8));
    this.physics.add.overlap(this.player, this.coins, (_, coin) => this.collectPlayer(coin));
    this.physics.add.overlap(this.enemies, this.coins, (enemy, coin) => this.collectEnemy(enemy, coin));
    this.physics.add.overlap(this.player, this.heals, (_, drop) => {
      if (!this.started || this.ended || this.health >= 100) return;
      this.health = Math.min(100, this.health + 18);
      drop.destroy();
      this.notice("Health restored +18");
    });
    this.physics.add.overlap(this.playerShots, this.enemies, (shot, enemy) => this.hitWithArrow(shot, enemy));
    this.physics.add.overlap(this.playerShots, this.chests, (shot, chest) => this.hitWithArrow(shot, chest));
    this.physics.add.overlap(this.playerShots, this.parts, (shot, part) => this.hitWithArrow(shot, part));
    this.physics.add.collider(this.playerShots, this.obstacles, shot => shot.destroy());
    this.physics.add.overlap(this.enemyShots, this.player, shot => {
      if (!shot.active) return;
      shot.destroy();
      this.hurtPlayer(7);
    });
    this.physics.add.collider(this.enemyShots, this.obstacles, shot => shot.destroy());
    this.physics.add.collider(this.enemyShots, this.chests, shot => shot.destroy());

    const chests = [[760, 700], [1050, 700], [900, 510], [900, 900], [260, 240],
      [620, 230], [1180, 250], [1530, 280], [280, 750], [1500, 740],
      [280, 1170], [620, 1150], [1160, 1170], [1530, 1170]];
    chests.forEach(([x, y]) => this.spawnChest(x, y));
    for (let i = 0; i < 46; i++) {
      const point = i < 12
        ? { x: 900 + Math.cos(i * Math.PI / 6) * 240, y: 700 + Math.sin(i * Math.PI / 6) * 240 }
        : this.freePoint();
      this.dropGold(point.x, point.y, 1);
    }
    this.spawnEnemy("goblin", 200, 150);
    this.spawnEnemy("skeleton", 1600, 1230);

    this.keys = this.input.keyboard.addKeys({
      up: "W", down: "S", left: "A", right: "D", space: "SPACE",
      one: "ONE", two: "TWO", three: "THREE", summon: "E", pause: "P", restart: "R"
    });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on("keydown-P", () => this.togglePause());
    this.input.keyboard.on("keydown-R", () => this.restartRun());
    this.input.on("pointermove", pointer => {
      if (this.started && !this.pausedGame && !this.ended) {
        const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, point.x, point.y);
      }
    });
    this.input.on("pointerdown", pointer => {
      const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, point.x, point.y);
    });
    this.cameras.main.setBounds(0, 0, RULES.width, RULES.height);
    this.cameras.main.startFollow(this.player, true, 1, 1);
    this.effects = this.add.graphics().setDepth(8);
    this.bars = this.add.graphics().setDepth(9);
    ui.play.onclick = () => {
      if (this.ended) this.restartRun();
      else if (this.pausedGame) this.togglePause();
      else this.begin();
    };
    this.physics.world.pause();
    this.refreshHud();
    ui.overlay.hidden = false;
    ui["overlay-title"].textContent = "Enter the dungeon";
    ui["overlay-copy"].innerHTML = this.game.registry.get("instructions") || ui["overlay-copy"].innerHTML;
    this.game.registry.set("instructions", ui["overlay-copy"].innerHTML);
    ui.play.textContent = "Start prototype";
    this.notice("Gold is yellow. Chests are brown. You are blue.", 100000);
  }

  makeTextures() {
    if (this.textures.exists("player")) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const texture = (key, w, h, draw) => { g.clear(); draw(g); g.generateTexture(key, w, h); };
    texture("player", 40, 40, g => {
      g.fillStyle(0x568fd3).fillCircle(20, 20, 15);
      g.lineStyle(2, 0xc8e2ff).strokeCircle(20, 20, 15);
      g.fillStyle(0xffffff).fillTriangle(39, 20, 25, 15, 25, 25);
    });
    texture("goblin", 36, 36, g => {
      g.fillStyle(0x739449).fillTriangle(0, 3, 15, 13, 5, 23).fillTriangle(36, 3, 21, 13, 31, 23).fillCircle(18, 18, 13);
      g.fillStyle(0x17171b).fillRect(12, 13, 4, 4).fillRect(22, 13, 4, 4);
    });
    texture("skeleton", 36, 36, g => {
      g.fillStyle(0xddd6bd).fillCircle(18, 15, 12).fillRect(11, 22, 14, 8);
      g.fillStyle(0x29252c).fillRect(10, 11, 6, 6).fillRect(21, 11, 6, 6);
    });
    texture("chest", 44, 34, g => {
      g.fillStyle(0x83552e).fillRect(1, 1, 42, 32);
      g.lineStyle(3, 0xc79a4b).strokeRect(2, 2, 40, 30).lineBetween(3, 13, 40, 13);
      g.fillStyle(0xe8bf55).fillRect(18, 10, 8, 10);
    });
    texture("pillar", 64, 64, g => {
      g.fillStyle(0x4c4850).fillCircle(32, 32, 31);
      g.lineStyle(3, 0x706977).strokeCircle(32, 32, 28);
    });
    texture("coin", 18, 18, g => {
      g.fillStyle(0xe0b848).fillCircle(9, 9, 7);
      g.lineStyle(1, 0xffe5a1).strokeCircle(9, 9, 5);
    });
    texture("heal", 20, 20, g => {
      g.fillStyle(0x83c489).fillRect(7, 1, 6, 18).fillRect(1, 7, 18, 6);
    });
    texture("arrow", 24, 8, g => {
      g.fillStyle(0xe6d7ad).fillRect(0, 3, 19, 2).fillTriangle(24, 4, 16, 0, 16, 8);
    });
    texture("bolt", 14, 14, g => { g.fillStyle(0xdd7285).fillCircle(7, 7, 6); });
    texture("core", 100, 100, g => {
      g.fillStyle(0x713b4b).fillCircle(50, 50, 46);
      g.lineStyle(4, 0xd58b99).strokeCircle(50, 50, 43);
      g.fillStyle(0xf4c590).fillTriangle(50, 27, 34, 62, 66, 62);
    });
    texture("armor", 48, 48, g => {
      g.fillStyle(0x7b7485).fillRect(3, 3, 42, 42);
      g.lineStyle(3, 0xbbb2c6).strokeRect(3, 3, 42, 42);
      g.lineStyle(2, 0x413b49).lineBetween(8, 8, 40, 40).lineBetween(8, 40, 40, 8);
    });
    g.destroy();
  }

  drawRoom() {
    const g = this.add.graphics();
    g.fillStyle(0x262329).fillRect(0, 0, RULES.width, RULES.height);
    g.lineStyle(1, 0x302d34);
    for (let x = 0; x <= RULES.width; x += 80) g.lineBetween(x, 0, x, RULES.height);
    for (let y = 0; y <= RULES.height; y += 80) g.lineBetween(0, y, RULES.width, y);
    g.lineStyle(28, 0x514a50).strokeRect(16, 16, RULES.width - 32, RULES.height - 32);
    g.lineStyle(3, 0x9173b0).strokeCircle(900, 700, 65);
    g.fillStyle(0x563d70, 0.5).fillCircle(900, 700, 62);
    this.add.text(900, 773, "ALTAR · 30 GOLD · E", { fontSize: "15px", color: "#b9a0d0" }).setOrigin(0.5);
    for (const [x, y] of [[900, 60], [1740, 700], [900, 1340], [60, 700]]) {
      g.fillStyle(0x151318).fillRect(x - 28, y - 28, 56, 56);
    }
  }

  begin() {
    this.started = true;
    ui.overlay.hidden = true;
    this.physics.world.resume();
    this.notice("Gather 30 gold before the monsters do. Return to the altar to summon.", 7000);
    document.querySelector("canvas").focus();
  }

  restartRun() {
    // Rebuild all groups, colliders and input listeners through Phaser's scene lifecycle.
    this.scene.restart();
  }

  togglePause() {
    if (!this.started || this.ended) return;
    this.pausedGame = !this.pausedGame;
    if (this.pausedGame) {
      this.physics.world.pause();
      this.showOverlay("Paused", "Resume when you're ready. P also resumes the game.", "Resume");
    } else {
      this.physics.world.resume();
      ui.overlay.hidden = true;
      this.input.keyboard.resetKeys();
    }
  }

  freePoint() {
    // Avoid placing loot in a pillar, chest, wall or the starting position.
    for (let attempt = 0; attempt < 100; attempt++) {
      const point = { x: Phaser.Math.Between(110, 1690), y: Phaser.Math.Between(110, 1290) };
      const blocked = [...this.obstacles.getChildren(), ...this.chests.getChildren()]
        .some(body => Phaser.Math.Distance.Between(point.x, point.y, body.x, body.y) < 65);
      if (!blocked && Phaser.Math.Distance.Between(point.x, point.y, 900, 700) > 100) return point;
    }
    return { x: 900, y: 1050 };
  }

  spawnChest(x, y) {
    const chest = this.chests.create(x, y, "chest");
    chest.kind = "chest";
    chest.hp = 3;
    return chest;
  }

  dropGold(x, y, amount) {
    for (let i = 0; i < amount; i++) {
      const angle = amount === 1 ? 0 : i * Math.PI * 2 / amount;
      const radius = amount === 1 ? 0 : 22;
      this.coins.create(Phaser.Math.Clamp(x + Math.cos(angle) * radius, 50, 1750),
        Phaser.Math.Clamp(y + Math.sin(angle) * radius, 50, 1350), "coin").setDepth(1);
    }
  }

  spawnEnemy(type, x, y) {
    if (x === undefined) {
      const doors = [[900, 65], [1735, 700], [900, 1335], [65, 700]];
      [x, y] = Phaser.Utils.Array.GetRandom(doors);
      x += Phaser.Math.Between(-20, 20);
      y += Phaser.Math.Between(-20, 20);
    }
    const enemy = this.enemies.create(x, y, type).setDepth(3);
    enemy.kind = "enemy";
    enemy.faction = type;
    enemy.hp = type === "goblin" ? 4 : 3;
    enemy.maxHp = enemy.hp;
    enemy.carried = 0;
    enemy.nextShot = this.playTime + 1800;
    enemy.setCircle(13, 5, 5).setCollideWorldBounds(true).setBounce(0.3);
    return enemy;
  }

  collectPlayer(coin) {
    if (!this.started || this.ended || !coin.active) return;
    coin.destroy();
    this.gold++;
    if (this.gold === RULES.goal && !this.boss) this.notice("30 gold! Return to the center altar and press E.", 7000);
  }

  collectEnemy(enemy, coin) {
    if (!this.started || this.ended || !coin.active || !enemy.active) return;
    coin.destroy();
    enemy.carried++;
    this.enemyGold[enemy.faction]++;
    if (!this.boss && this.enemyGold[enemy.faction] >= RULES.goal) this.summonBoss(true, enemy.faction);
  }

  attack() {
    if (!this.started || this.ended || this.pausedGame || this.playTime < this.nextAttack) return false;
    const weapon = RULES.weapons[this.weaponIndex];
    this.nextAttack = this.playTime + weapon.cooldown;
    if (this.weaponIndex === 2) {
      if (this.gold <= 0) { this.notice("No gold for arrows. Use 1 (sword) or 2 (axe)."); return false; }
      this.gold--;
      const shot = this.playerShots.create(this.player.x + Math.cos(this.aim) * 28,
        this.player.y + Math.sin(this.aim) * 28, "arrow").setRotation(this.aim).setDepth(6);
      shot.damage = weapon.damage;
      shot.expires = this.playTime + 1500;
      shot.body.setSize(18, 8);
      this.physics.velocityFromRotation(this.aim, 650, shot.body.velocity);
      return true;
    }
    this.effects.clear();
    this.effects.lineStyle(this.weaponIndex === 0 ? 9 : 14, this.weaponIndex === 0 ? 0xcddcea : 0xe0b576, 0.85);
    if (this.weaponIndex === 0) {
      this.effects.lineBetween(this.player.x + Math.cos(this.aim) * 22, this.player.y + Math.sin(this.aim) * 22,
        this.player.x + Math.cos(this.aim) * weapon.range, this.player.y + Math.sin(this.aim) * weapon.range);
    } else {
      this.effects.beginPath();
      this.effects.arc(this.player.x, this.player.y, 88, this.aim - weapon.arc, this.aim + weapon.arc);
      this.effects.strokePath();
    }
    this.effectUntil = this.playTime + 120;
    for (const target of [...this.enemies.getChildren(), ...this.chests.getChildren(), ...this.parts.getChildren()]) {
      if (!target.active) continue;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y);
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y);
      const padding = target.kind === "core" ? 24 : 12;
      if (distance <= weapon.range + padding && Math.abs(Phaser.Math.Angle.Wrap(angle - this.aim)) <= weapon.arc) {
        this.damageTarget(target, weapon.damage);
      }
    }
    return true;
  }

  hitWithArrow(shot, target) {
    if (!shot.active || !target.active) return;
    const damage = shot.damage;
    shot.destroy();
    this.damageTarget(target, damage);
  }

  damageTarget(target, amount) {
    if (!target.active || this.ended) return;
    if (target.kind === "core" && this.bossParts.some(part => part.active)) {
      if (this.playTime >= (this.shieldNotice || 0)) {
        this.notice("Core shielded: break BOTH arms and the crown first.");
        this.shieldNotice = this.playTime + 1800;
      }
      return;
    }
    target.hp -= amount;
    target.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(90, () => { if (target.active) target.clearTint(); });
    if (target.hp > 0) return;
    const { x, y, kind } = target;
    if (kind === "chest") {
      target.destroy();
      this.dropGold(x, y, 5);
      if (Phaser.Math.Between(0, 3) === 0) this.heals.create(x, y, "heal");
    } else if (kind === "enemy") {
      this.enemyGold[target.faction] = Math.max(0, this.enemyGold[target.faction] - target.carried);
      this.dropGold(x, y, 2 + target.carried);
      target.destroy();
      this.kills++;
      this.health = Math.min(100, this.health + 2);
    } else if (kind === "armor") {
      target.destroy();
      const remaining = this.bossParts.filter(part => part.active).length;
      this.dropGold(x, y, 5);
      this.notice(remaining ? `Boss part broken! ${remaining} remaining.` : "All parts broken! Attack the exposed CORE.", 5000);
    } else if (kind === "core") {
      target.destroy();
      this.finish(true);
    }
  }

  hurtPlayer(amount) {
    if (!this.started || this.ended || this.pausedGame || this.playTime < this.invulnerableUntil) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnerableUntil = this.playTime + 750;
    this.player.setTint(0xe48484).setTintMode(Phaser.TintModes.FILL);
    if (this.health <= 0) this.finish(false);
  }

  trySummon() {
    if (this.boss) { this.notice("The boss is already here. Break its parts, then its core."); return false; }
    if (this.gold < RULES.goal) { this.notice("You need 30 gold to summon the boss."); return false; }
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, 900, 700) > 100) {
      this.notice("Return to the purple altar in the center of the room.");
      return false;
    }
    this.gold -= RULES.goal;
    this.summonBoss(false, this.enemyGold.skeleton > this.enemyGold.goblin ? "skeleton" : "goblin");
    return true;
  }

  summonBoss(empowered, faction) {
    if (this.boss) return;
    // Spawn away from the player; each piece has its own Arcade body and health.
    const x = this.player.x < 900 ? 1250 : 550;
    const y = this.player.y < 700 ? 1000 : 400;
    const core = this.parts.create(x, y, "core").setDepth(4).setImmovable(true);
    core.kind = "core";
    core.hp = empowered ? 28 : 20;
    core.maxHp = core.hp;
    core.body.setCircle(44, 6, 6);
    core.body.moves = false;
    this.boss = { core, faction, empowered, nextAction: this.playTime + 1800, chargeUntil: 0,
      warningUntil: 0, chargeAngle: 0, speed: faction === "goblin" ? 65 : 42 };
    const offsets = [[-67, 8, "Left arm"], [67, 8, "Right arm"], [0, -67, "Crown"]];
    this.bossParts = offsets.map(([dx, dy, name]) => {
      const part = this.parts.create(x + dx, y + dy, "armor").setDepth(5).setImmovable(true);
      Object.assign(part, { kind: "armor", hp: empowered ? 14 : 10, maxHp: empowered ? 14 : 10, dx, dy, partName: name });
      part.body.setSize(44, 44);
      part.body.moves = false;
      return part;
    });
    this.notice(empowered ? "The monsters collected 30 gold! An empowered boss has arrived." : "Boss summoned! Break the two arms and crown, then the core.", 6500);
    this.cameras.main.shake(180, 0.005);
  }

  shootBolt(x, y, angle, speed = 230) {
    const shot = this.enemyShots.create(x, y, "bolt").setDepth(6);
    shot.expires = this.playTime + 3500;
    shot.setCircle(6, 1, 1);
    this.physics.velocityFromRotation(angle, speed, shot.body.velocity);
  }

  updateEnemies() {
    const loot = this.coins.getChildren();
    for (const enemy of this.enemies.getChildren()) {
      let target = this.player;
      let nearest = 500;
      for (const coin of loot) {
        const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, coin.x, coin.y);
        if (distance < nearest) { nearest = distance; target = coin; }
      }
      const playerDistance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
      const ranged = enemy.faction === "skeleton";
      this.physics.velocityFromRotation(angle, ranged ? 65 : 100, enemy.body.velocity);
      if (ranged && target === this.player && playerDistance < 260) enemy.setVelocity(0);
      if (ranged && playerDistance < 500 && this.playTime > enemy.nextShot) {
        const aim = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
        this.shootBolt(enemy.x, enemy.y, aim);
        enemy.nextShot = this.playTime + 2400;
      }
    }
  }

  updateBoss(delta) {
    if (!this.boss || !this.boss.core.active) return;
    const boss = this.boss;
    const core = boss.core;
    const alive = this.bossParts.filter(part => part.active).length;
    const angle = Phaser.Math.Angle.Between(core.x, core.y, this.player.x, this.player.y);
    let speed = boss.speed;
    let moveAngle = angle;
    if (boss.faction === "goblin") {
      if (this.playTime > boss.nextAction) {
        boss.warningUntil = this.playTime + 650;
        boss.chargeUntil = this.playTime + 1250;
        boss.chargeAngle = angle;
        boss.nextAction = this.playTime + 3400;
      }
      if (this.playTime < boss.warningUntil) speed = 0;
      else if (this.playTime < boss.chargeUntil) { speed = 180 + alive * 35; moveAngle = boss.chargeAngle; }
    } else if (this.playTime > boss.nextAction) {
      const count = 4 + alive * 2;
      for (let i = 0; i < count; i++) this.shootBolt(core.x, core.y, angle + i * Math.PI * 2 / count, 190);
      boss.nextAction = this.playTime + 1700;
    }
    // Move the compound boss as one unit, with its armor attached to the core.
    const seconds = delta / 1000;
    core.setPosition(Phaser.Math.Clamp(core.x + Math.cos(moveAngle) * speed * seconds, 140, 1660),
      Phaser.Math.Clamp(core.y + Math.sin(moveAngle) * speed * seconds, 140, 1260));
    core.body.updateFromGameObject();
    for (const part of this.bossParts) {
      if (!part.active) continue;
      part.setPosition(core.x + part.dx, core.y + part.dy);
      part.body.updateFromGameObject();
    }
    core.setAlpha(alive ? 0.65 : 1);
  }

  drawBars() {
    this.bars.clear();
    for (const target of [...this.enemies.getChildren(), ...this.parts.getChildren()]) {
      if (!target.active) continue;
      const width = target.kind === "core" ? 80 : 32;
      const y = target.y - (target.kind === "core" ? 55 : 29);
      this.bars.fillStyle(0x18151b).fillRect(target.x - width / 2, y, width, 5);
      this.bars.fillStyle(target.kind === "armor" ? 0xe0b576 : 0xca727d)
        .fillRect(target.x - width / 2, y, width * Math.max(0, target.hp / target.maxHp), 5);
    }
    if (this.boss && this.boss.core.active && this.playTime < this.boss.warningUntil) {
      const { x, y } = this.boss.core;
      this.bars.lineStyle(3, 0xef6d65).strokeCircle(x, y, 105);
      this.bars.lineBetween(x, y, x + Math.cos(this.boss.chargeAngle) * 200, y + Math.sin(this.boss.chargeAngle) * 200);
    }
  }

  notice(text, duration = 3200) {
    ui.message.textContent = text;
    this.messageUntil = this.playTime + duration;
  }

  refreshHud() {
    ui.health.textContent = `Health: ${this.health} / 100`;
    ui.gold.textContent = `Gold: ${this.gold}${this.boss ? " (arrow ammo)" : " / 30"}`;
    const weapon = RULES.weapons[this.weaponIndex];
    ui.weapon.textContent = `${this.weaponIndex + 1} ${weapon.name}${this.weaponIndex === 2 ? " · 1 gold / arrow" : ""}`;
    ui.rivals.textContent = `Enemy gold: Goblins ${this.enemyGold.goblin} · Skeletons ${this.enemyGold.skeleton}`;
    if (this.boss) {
      const name = this.boss.faction === "goblin" ? "Goblin Warlord" : "Skeleton Lich";
      const remaining = this.bossParts.filter(part => part.active).length;
      ui.boss.textContent = `${this.boss.empowered ? "Empowered " : ""}${name} · Parts: ${3 - remaining}/3 broken · Core: ${Math.max(0, this.boss.core.hp)} / ${this.boss.core.maxHp}${remaining ? " (shielded)" : " — exposed!"}`;
    } else {
      ui.boss.textContent = this.gold >= RULES.goal
        ? "Ready to summon: return to the purple center altar and press E."
        : "Collect 30 gold, return to the purple center altar, and press E.";
    }
  }

  showOverlay(title, copy, button) {
    ui["overlay-title"].textContent = title;
    ui["overlay-copy"].textContent = copy;
    ui.play.textContent = button;
    ui.overlay.hidden = false;
  }

  finish(won) {
    if (this.ended) return;
    this.ended = true;
    this.physics.world.pause();
    this.refreshHud();
    this.showOverlay(won ? "Boss defeated!" : "You fell in the dungeon",
      `${won ? "All three parts and the core destroyed." : "Keep moving, break chests, and recover gold from monsters."} ${this.kills} monsters defeated · ${this.gold} gold left · ${Math.floor(this.playTime / 1000)} seconds. Press R or restart below.`, "Restart prototype");
    this.notice(won ? "Victory!" : "Run over. Press R to try again.", 100000);
  }

  update(_, delta) {
    if (!this.started || this.ended || this.pausedGame) return;
    delta = Math.min(delta, 50);
    this.playTime += delta;
    const x = Number(this.keys.right.isDown || this.cursors.right.isDown) - Number(this.keys.left.isDown || this.cursors.left.isDown);
    const y = Number(this.keys.down.isDown || this.cursors.down.isDown) - Number(this.keys.up.isDown || this.cursors.up.isDown);
    const vector = new Phaser.Math.Vector2(x, y).normalize().scale(RULES.speed);
    this.player.setVelocity(vector.x, vector.y).setRotation(this.aim);
    if (this.playTime >= this.invulnerableUntil) this.player.clearTint();
    [this.keys.one, this.keys.two, this.keys.three].forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.weaponIndex = index;
    });
    if (this.keys.space.isDown || this.input.activePointer.isDown) this.attack();
    if (Phaser.Input.Keyboard.JustDown(this.keys.summon)) this.trySummon();
    if (this.playTime >= this.effectUntil) this.effects.clear();
    this.updateEnemies();
    this.updateBoss(delta);
    if (this.playTime > this.nextSpawn && this.enemies.countActive() < (this.boss ? 10 : 18)) {
      this.spawnEnemy(Math.random() < 0.6 ? "goblin" : "skeleton");
      this.nextSpawn = this.playTime + (this.boss ? 5000 : 2800);
    }
    if (this.playTime > this.nextChest && this.chests.countActive() < 14) {
      const point = this.freePoint();
      this.spawnChest(point.x, point.y);
      this.nextChest = this.playTime + 14000;
    }
    if (this.playTime > this.nextGold && this.coins.countActive() < 65) {
      const point = this.freePoint();
      this.dropGold(point.x, point.y, 4);
      this.nextGold = this.playTime + 10000;
    }
    for (const shot of [...this.playerShots.getChildren(), ...this.enemyShots.getChildren()]) {
      if (this.playTime >= shot.expires) shot.destroy();
    }
    if (this.playTime > this.messageUntil) {
      ui.message.textContent = this.boss ? "Break the three armor parts, then the core. P: pause · R: restart."
        : "Gold: yellow · Chests: brown · Altar: center of room · E: summon with 30 gold";
    }
    this.drawBars();
    this.refreshHud();
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1000, height: 640,
  parent: "game", backgroundColor: "#262329",
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: Dungeon,
  render: { antialias: false },
  audio: { noAudio: true }
});
