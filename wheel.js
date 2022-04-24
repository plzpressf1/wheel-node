import fetch from "node-fetch";

const api = process.env.REMOTE_ENDPOINT + "/scripts";

export async function CreateRoom(id, hostId) {
    const url = `${api}/rooms.php?action=create_room&id=${id}&hostId=${hostId}`;
    await fetch(url);
}

export async function GetRoomMessage(id) {
    const url = `${api}/rooms.php?action=get_room&id=${id}`;
    const res = await fetch(url);
    const json = await res.json();
    const room = json.room;

    room.players = JSON.parse(room.players);

    let message =  `Кто будет крутить колесо? [Предложил <@${room.host_id}>]`;
    message += `\nКолесо находится по ссылке: ${process.env.FRONTEND_URL}/#${id}`;
    let playersString = "";
    for (let i = 0; i < room.players.length; ++i) {
        if (i === room.players.length - 1) {
            if (i > 0) playersString += " и ";
        }
        else if (i > 0) {
            playersString += ", ";
        }

        playersString += `<@${room.players[i]}>`;
    }
    if (room.players.length > 0) {
        message += `\n${playersString}`;
        if (room.players.length > 1) {
            message += ` будут крутить колесо`;
        }
        else {
            message += ` будет крутить колесо`;
        }
    }
    return message;
}

export async function AddRoomPlayer(id, player) {
    const url = `${api}/rooms.php?action=add_player&id=${id}&player=${player}`;
    await fetch(url);
}

export function GetWheelResultMessage(wheel) {
    const currentItem = wheel.getCurrentItem();
    let message = "Колесо прокручено:\n";
    let isFirst = true;
    for (const item of wheel.items) {
        if (wheel.findItemById(wheel.bannedItems, item.id)) {
            continue;
        }
        if (isFirst) {
            isFirst = false;
        }
        else {
            message += "\n";
        }
        message += item.name;
        if (currentItem.id === item.id) {
            message += " <-";
        }
    }
    return message;
}
