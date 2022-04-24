import fetch from "node-fetch";
import { Client, Intents } from "discord.js";
import { GetWheelResultMessage } from "./wheel.js";

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });
const api = process.env.REMOTE_ENDPOINT + "/scripts";

class Wheel {
    constructor() {
        this.angle = 0;
        this.isRolling = false;
        this.items = [];
        this.bannedItems = [];
    }

    getCurrentItem() {
        const ratio = Math.abs(this.angle % (Math.PI * 2) / (Math.PI * 2));
        let i = 0;
        let sumPiece = 0, prevPiece = 0;
        for (const item of this.items) {
            sumPiece += item.probability;
            if (ratio >= prevPiece && ratio < sumPiece) {
                break;
            }
            prevPiece = item.probability;
            i++;
        }
        return this.items[i];
    }

    async fetchItems(filter) {
        const url = `${api}/wheel.php?action=get_wheel&filter=${filter}`;
        const res = await fetch(url);
        const json = await res.json();
        this.items = json.games;
        this.bannedItems = [];
    }

    update() {
        if (!this.items.length) return;

        if (this.noDecelerationTicks === 0) {
            this.speed *= this.decelerationRatio;
            if (this.speed <= 0.002) this.speed = 0;
        }
        else {
            this.noDecelerationTicks--;
        }
        if (this.speed > 0) {
            this.angle -= this.speed;
        }
    }

    spin() {
        this.isRolling = true;
        this.speed = 0.08;
        this.decelerationRatio = 0.989;
        this.angle = -10 + Math.floor(Math.random() * 20);
        this.noDecelerationTicks = 500 + Math.floor(Math.random() * 200);
    }

    findItemById(items, id) {
        for (const item of items) {
            if (item.id === id) return true;
        }
        return false;
    }

    banItem(item) {
        if (!this.findItemById(this.bannedItems, item.id)) {
            this.bannedItems.push(item);
        }
    }

    unbanItem(item) {
        const newBannedItems = [];
        for (const bannedItem of this.bannedItems) {
            if (bannedItem.id !== item.id) {
                newBannedItems.push(bannedItem);
            }
        }
        this.bannedItems = newBannedItems;
    }
}

class Player {
    constructor(player, socket) {
        this.id = player.id;
        this.name = player.name;
        this.avatar = player.avatar;
        this.isReady = false;
        this.socket = socket;
    }
}

class Room {
    constructor(id, hostId, registeredPlayers) {
        this.id = id;
        this.hostId = hostId;
        this.registeredPlayers = registeredPlayers;
        this.players = new Map();
        this.wheel = new Wheel();
    }

    updateRegisteredPlayers(registeredPlayers) {
        this.registeredPlayers = registeredPlayers;
    }

    connectPlayer(player, socket) {
        if (this.registeredPlayers.includes(player.id)) {
            this.players.set(player.id, new Player(player, socket));
            this.sendPlayersList();
        }
        else {
            // guests available?
        }
    }

    disconnectPlayer(id) {
        this.players.delete(id);
        this.sendPlayersList();
    }

    togglePlayer(player) {
        const p = this.players.get(player.id);
        p.isReady = !p.isReady;
        this.sendPlayersList();
    }

    resetPlayers() {
        for (const player of this.players.values()) {
            player.isReady = false;
        }
        this.sendPlayersList();
    }

    isAllPlayersReady() {
        for (const player of this.players.values()) {
            if (!player.isReady) return false;
        }
        return true;
    }

    changeWheelFilter(filter) {
        this.resetPlayers();
        this.wheel.fetchItems(filter).then(() => {
            this.emitToAll("wheel/filter", filter);
            this.sendWheelSetup();
        });
    }

    tick() {
        this.wheel.update();
        if (this.wheel.speed === 0) {
            this.wheel.isRolling = false;
            clearInterval(this.interval);
            this.emitToAll("wheel/rolling", false);

            const channel = client.channels.cache.find(channel => channel.name === process.env.CHANNEL_NAME);
            const message = GetWheelResultMessage(this.wheel);
            channel.send(message);
        }
        this.emitToAll("wheel/angle", this.wheel.angle);
    }

    spinWheel() {
        if (this.interval) {
            clearInterval(this.interval);
        }
        if (this.wheel.isRolling) return;
        if (!this.isAllPlayersReady()) return;

        this.wheel.spin();
        this.interval = setInterval(this.tick.bind(this), 10);
        this.emitToAll("wheel/rolling", true);
    }

    banItem(item) {
        this.wheel.banItem(item);
        this.sendWheelSetup();
    }

    unbanItem(item) {
        this.wheel.unbanItem(item);
        this.sendWheelSetup();
    }

    emitToAll(path, data) {
        for (const player of this.players.values()) {
            player.socket.emit(path, data);
        }
    }

    sendWheelSetup() {
        let totalWeights = 0;
        const items = [];
        for (const item of this.wheel.items) {
            if (!this.wheel.findItemById(this.wheel.bannedItems, item.id)) {
                items.push(item);
                totalWeights += item.weight;
            }
        }
        for (const item of items) {
            item.probability = item.weight / totalWeights;
        }

        this.emitToAll("wheel/setup", {
            items,
            bannedItems: this.wheel.bannedItems,
        });
    }

    sendPlayersList() {
        const players = [];
        for (const player of this.players.values()) {
            players.push({
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                isReady: player.isReady,
            });
        }
        this.emitToAll("players/list", {
            players,
            hostId: this.hostId,
            registeredPlayers: this.registeredPlayers
        });
    }
}

const rooms = new Map();

export function SetupWS(io) {
    client.on("ready", () => {
        console.log(`Logged in as ${client.user.tag}!`);
    });

    // Login to Discord with your client's token
    client.login(process.env.DISCORD_TOKEN);

    io.on("connection", async socket => {
        const roomId = socket.handshake.query.roomId;
        const user = {
            id: socket.handshake.query.id,
            name: socket.handshake.query.name,
            avatar: socket.handshake.query.avatar,
        };

        try {
            console.log("session authorized. user, room:", user.id, roomId);

            // create room
            const url = `${api}/rooms.php?action=get_room&id=${roomId}`;
            const res = await fetch(url);
            const json = await res.json();
            const room = json.room;

            if (room) {
                const registeredPlayers = JSON.parse(room.players);

                let roomInstance = rooms.get(room.id);
                if (!roomInstance) {
                    roomInstance = new Room(room.id, room.host_id, registeredPlayers);
                    rooms.set(room.id, roomInstance);
                }
                else {
                    roomInstance.updateRegisteredPlayers(registeredPlayers);
                }
                roomInstance.connectPlayer(user, socket);
                // socket session data
                socket.userData = { user, room: roomInstance };
            }
        }
        catch (e) {
            console.error("invalid token, error:", e);
            socket.disconnect();
        }

        socket.on("disconnect", () => {
            console.log("session disconnected. user, room:", socket.userData?.user.id, socket.userData?.room.id);
            socket.userData?.room.disconnectPlayer(socket.userData?.user.id);
        });

        socket.on("players/toggle", (player) => {
            socket.userData?.room.togglePlayer(player);
        });

        socket.on("filter/change", (filter) => {
            socket.userData?.room.changeWheelFilter(filter);
        });

        socket.on("wheel/spin", () => {
            socket.userData?.room.spinWheel();
        });

        socket.on("games/ban", (item) => {
            socket.userData?.room.banItem(item);
        });

        socket.on("games/unban", (item) => {
            socket.userData?.room.unbanItem(item);
        });
    });
}