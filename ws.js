import fetch from "node-fetch";

const api = process.env.REMOTE_ENDPOINT + "/scripts";

class Wheel {
    constructor() {
        this.angle = 0;
        this.isRolling = false;
        this.items = [];
    }

    async fetchItems(filter) {
        const url = `${api}/wheel.php?action=get_wheel&filter=${filter}`;
        const res = await fetch(url);
        const json = await res.json();
        this.items = json.games;
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
            this.emitToAll("wheel/setup", this.wheel.items);
        });
    }

    tick() {
        this.wheel.update();
        if (this.wheel.speed === 0) {
            this.wheel.isRolling = false;
            clearInterval(this.interval);
            this.emitToAll("wheel/rolling", false);
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

    emitToAll(path, data) {
        for (const player of this.players.values()) {
            player.socket.emit(path, data);
        }
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
    });
}