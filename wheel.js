import fetch from "node-fetch";

const api = process.env.REMOTE_ENDPOINT + "/scripts";

export async function CreateWheel(id, hostId) {
    const url = `${api}/wheels.php?action=create_wheel&id=${id}&hostId=${hostId}`;
    await fetch(url);
}

export async function GetWheelMessage(id) {
    const url = `${api}/wheels.php?action=get_wheel&id=${id}`;
    const res = await fetch(url);
    const json = await res.json();
    const wheel = json.wheel;

    wheel.players = JSON.parse(wheel.players);

    let message =  `Кто будет крутить колесо? [Предложил <@${wheel.host_id}>]`;
    message += `\nКолесо находится по ссылке: ${process.env.FRONTEND_URL}/${id}`;
    let playersString = "";
    for (let i = 0; i < wheel.players.length; ++i) {
        if (i === wheel.players.length - 1) {
            if (i > 0) playersString += " и ";
        }
        else if (i > 0) {
            playersString += ", ";
        }

        playersString += `<@${wheel.players[i]}>`;
    }
    if (wheel.players.length > 0) {
        message += `\n${playersString}`;
        if (wheel.players.length > 1) {
            message += ` будут крутить колесо`;
        }
        else {
            message += ` будет крутить колесо`;
        }
    }
    return message;
}

export async function AddWheelPlayer(id, player) {
    const url = `${api}/wheels.php?action=add_player&id=${id}&player=${player}`;
    await fetch(url);
}
