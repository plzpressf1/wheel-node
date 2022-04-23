import "dotenv/config";
import express from "express";
import { Server } from "socket.io";
import * as http from "http";

import { VerifyDiscordRequest, DiscordRequest, getRandomEmoji } from "./utils.js";
import {
    InteractionType,
    InteractionResponseType,
    MessageComponentTypes,
    ButtonStyleTypes
} from "discord-interactions";
import {
    TEST_COMMAND,
    WHEEL_COMMAND,
    HasGuildCommands
} from "./commands.js";

import { AddRoomPlayer, CreateRoom, GetRoomMessage } from "./wheel.js";
import { SetupWS } from "./ws.js";

// Create an express app
const app = express();
// Parse request body and verifies incoming requests using discord-interactions package
app.use(express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }));

const server = http.createServer(app);
const io = new Server(server, {
    serveClient: false,
    // below are engine.IO options
    pingInterval: 10000,
    pingTimeout: 5000,
    cookie: false,
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});
SetupWS(io);

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 */
app.post("/interactions", async function (req, res) {
    // Interaction type and data
    const { type, id, data } = req.body;

    /**
     * Handle verification requests
     */
    if (type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
    }

    /**
     * Handle slash command requests
     * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
     */
    if (type === InteractionType.APPLICATION_COMMAND) {
        const { name } = data;

        // "test" guild command
        if (name === "test") {
            // Send a message into the channel where command was triggered from
            return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    // Fetches a random emoji to send from a helper function
                    content: `hello from ${process.env.REMOTE_ENDPOINT} ` + getRandomEmoji(),
                },
            });
        }

        // "wheel" guild command
        if (name === "wheel" && id) {
            const userId = req.body.member.user.id;
            const wheelId = req.body.id;

            await CreateRoom(wheelId, userId);
            const wheelMessage = await GetRoomMessage(wheelId);

            // Send a message into the channel where command was triggered from
            return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: wheelMessage,
                    components: [
                        {
                            type: MessageComponentTypes.ACTION_ROW,
                            components: [
                                {
                                    type: MessageComponentTypes.BUTTON,
                                    // Append the game ID to use later on
                                    custom_id: `accept_button_${wheelId}`,
                                    label: "Буду участвовать!",
                                    style: ButtonStyleTypes.PRIMARY,
                                },
                            ],
                        },
                    ],
                },
            });
        }
    }

    /**
     * Handle requests from interactive components
     * See https://discord.com/developers/docs/interactions/message-components#responding-to-a-component-interaction
     */
    if (type === InteractionType.MESSAGE_COMPONENT) {
        // custom_id set in payload when sending message component
        const userId = req.body.member.user.id;
        const componentId = data.custom_id;
        const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;

        if (componentId.startsWith("accept_button_")) {
            // get the associated wheel ID
            const wheelId = componentId.replace("accept_button_", "");
            await AddRoomPlayer(wheelId, userId);
            const wheelMessage = await GetRoomMessage(wheelId);

            try {
                await res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        // Fetches a random emoji to send from a helper function
                        content: wheelMessage,
                        components: [
                            {
                                type: MessageComponentTypes.ACTION_ROW,
                                components: [
                                    {
                                        type: MessageComponentTypes.BUTTON,
                                        // Append the game ID to use later on
                                        custom_id: `accept_button_${wheelId}`,
                                        label: "Буду участвовать!",
                                        style: ButtonStyleTypes.PRIMARY,
                                    },
                                ],
                            },
                        ],
                    },
                });
                // Delete previous message
                await DiscordRequest(endpoint, { method: "DELETE" });
            } catch (err) {
                console.error("Error sending message:", err);
            }
        }
    }
});

server.listen(process.env.PORT, async () => {
    console.log(`Listening on port ${process.env.PORT}`);

    // Check if guild commands from commands.json are installed (if not, install them)
    await HasGuildCommands(process.env.APP_ID, process.env.GUILD_ID, [
        TEST_COMMAND,
        WHEEL_COMMAND,
    ]);
});
