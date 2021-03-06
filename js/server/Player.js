/**
 * Created by Jerome on 26-12-16.
 */

const GameServer = require('./GameServer.js').GameServer;
// Parent class of monsters and players
const MovingEntity = require('./MovingEntity.js');
const PersonalUpdatePacket = require('./PersonalUpdatePacket.js');

class Player extends MovingEntity {
  constructor(name) {
    super();
    this.name = name;
    const startingPosition = GameServer.determineStartingPosition();
    this.x = startingPosition.x;
    this.y = startingPosition.y;
    this.setAOI();
    this.category = 'player';
    this.maxLife = 100;
    this.life = this.maxLife;
    this.speed = 120;
    this.equip(1, 'sword1');
    this.equip(2, 'clotharmor');
    this.updatePacket = new PersonalUpdatePacket();
    this.newAOIs = [];
  }

  setAOI() {
    this.aoi = this.getAOIid();
  }

  setIDs(dbId, socketId) {
    this.id = GameServer.lastPlayerID++;
    GameServer.IDmap[this.id] = dbId;
    this.socketID = socketId;
  }

  getMongoID() {
    return GameServer.IDmap[this.id];
  }

  setLastSavedPosition() {
    this.lastSavedPosition = { x: this.x, y: this.y };
  }

  resetPosition() {
    this.setProperty('x', this.lastSavedPosition.x);
    this.setProperty('y', this.lastSavedPosition.y);
  }

  trim() {
    // Return a smaller object, containing a subset of the initial properties, to be sent to the client
    const trimmed = {};
    const broadcastProperties = ['id', 'name', 'weapon', 'armor', 'inFight', 'alive', 'aoi']; // list of properties relevant for the client
    for (let p = 0; p < broadcastProperties.length; p++) {
      trimmed[broadcastProperties[p]] = this[broadcastProperties[p]];
    }
    trimmed.x = parseInt(this.x, 10);
    trimmed.y = parseInt(this.y, 10);
    if (this.route) trimmed.route = this.route.trim(this.category);
    if (this.target) trimmed.targetID = this.target.id;
    return trimmed;
  }

  dbTrim() {
    // Return a smaller object, containing a subset of the initial properties, to be stored in the database
    const trimmed = {};
    // list of properties relevant to store in the database
    const dbProperties = ['x', 'y', 'name'];
    for (let p = 0; p < dbProperties.length; p += 1) {
      trimmed[dbProperties[p]] = this[dbProperties[p]];
    }
    trimmed.weapon = GameServer.db.itemsIDmap[this.weapon];
    trimmed.armor = GameServer.db.itemsIDmap[this.armor];
    return trimmed;
  }

  getDataFromDb(document) {
    // Set up the player based on the data stored in the databse
    // document is the mongodb document retrieved form the database
    const dbProperties = ['x', 'y', 'name'];
    for (let p = 0; p < dbProperties.length; p++) {
      this[dbProperties[p]] = document[dbProperties[p]];
    }
    this.setAOI();
    this.equip(1, document.weapon);
    this.equip(2, document.armor);
  }

  getIndividualUpdatePackage() {
    if (this.updatePacket.isEmpty()) return null;
    const pkg = this.updatePacket;
    this.updatePacket = new PersonalUpdatePacket();
    return pkg;
  }

  getPathEnd() {
    return {
      x: this.route.path[this.route.path.length - 1].x,
      y: this.route.path[this.route.path.length - 1].y,
    };
  }

  updateFight() {
    this.lastFightUpdate = Date.now();
    if (!this.target || !this.target.alive) return;
    const direction = GameServer.adjacentNoDiagonal(this, this.target);
    if (direction > 0) this.damage();
  }

  regenerate() {
    this.updateLife(2);
  }

  equip(type, item) {
    const equipInfo = GameServer.db.items[item];
    if (type == 1) {
      this.atk = equipInfo.atk;
      this.setProperty('weapon', equipInfo.id);
    } else if (type == 2) {
      this.def = equipInfo.def;
      this.setProperty('armor', equipInfo.id);
    }
  }

  applyItem(item) {
    const itemInfo = GameServer.db.items[item.itemKey];
    if (itemInfo === undefined) {
      console.error('WARNING : undefined data for item : ');
      console.log(item);
      return;
    }
    let picked = true;
    if (itemInfo.heals) {
      const difference = this.updateLife(itemInfo.heals);
      this.updatePacket.addHP(false, difference); // / false = self
      this.updatePacket.addUsed(itemInfo.id);
    } else if (itemInfo.equip) {
      const equipInfo = GameServer.db.items[itemInfo.equip];
      const type = equipInfo.type;
      if (type === 1) { // Weapon
        if (this.atk >= equipInfo.atk) { // don't pick up if a better item is already equipped
          this.updatePacket.addNoPick();
          picked = false;
        }
      } else if (type === 2) { // Armor
        if (this.def >= equipInfo.def) {
          this.updatePacket.addNoPick();
          picked = false;
        }
      }
      if (picked) {
        this.equip(type, itemInfo.equip);
        if (this.x < 92) GameServer.savePlayer(this);
        this.updatePacket.addUsed(equipInfo.id);
      }
    }
    return picked;
  }

  teleport(door) {
    this.x = door.to.x;
    this.y = door.to.y;
    this.manageFoes();
    this.endFight();
  }

  revive() {
    if (this.alive) return;
    this.life = this.maxLife;
    this.resetPosition();
    this.setProperty('alive', true);
    this.updatePacket.updatePosition(this.x, this.y);
  }
}
module.exports.Player = Player;
