import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// roomId -> Set<WebSocket>
const rooms = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');
    let userRoom = null;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            const { type, roomId } = message || {};

            if (type === 'join' && roomId) {
                userRoom = roomId;

                if (!rooms.has(roomId)) {
                    rooms.set(roomId, new Set());
                }

                const room = rooms.get(roomId);
                room.add(ws);

                console.log(`User joined room ${roomId}. Room size: ${room.size}`);

                // Notify this user how many are in the room
                ws.send(JSON.stringify({
                    type: 'user-count',
                    roomId,
                    count: room.size
                }));

                // Notify others that a user joined
                broadcastToRoom(roomId, {
                    type: 'peer-joined',
                    roomId,
                    count: room.size
                }, ws);
            } else if (userRoom) {
                // Forward signaling messages to the other peer(s) in the room
                broadcastToRoom(userRoom, message, ws);
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });

    ws.on('close', () => {
        if (userRoom && rooms.has(userRoom)) {
            const room = rooms.get(userRoom);
            room.delete(ws);

            if (room.size === 0) {
                rooms.delete(userRoom);
                console.log(`Room ${userRoom} deleted (empty)`);
            } else {
                // Inform remaining peers
                broadcastToRoom(userRoom, {
                    type: 'peer-left',
                    roomId: userRoom,
                    count: room.size
                });
            }
        }
        console.log('Client disconnected');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function broadcastToRoom(roomId, message, exceptWs = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    const payload = JSON.stringify(message);
    room.forEach((client) => {
        if (client !== exceptWs && client.readyState === 1) {
            client.send(payload);
        }
    });
}

// Serve index.html for / and /:roomId
app.get('/:roomId?', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Simple health check
app.get('/health/check', (req, res) => {
    res.json({ status: 'ok', rooms: rooms.size });
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
