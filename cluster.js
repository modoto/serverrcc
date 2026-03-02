const cluster = require('cluster');

const numWorkers = 3; // sesuaikan dengan CPU VPS (4 core = 3 worker)

if (cluster.isPrimary) {

    console.log(`🚀 Master ${process.pid} running`);

    const express = require('express');
    const http = require('http');
    const { Server } = require("socket.io");

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: "*" } });

    app.use(express.static("public"));

    io.on("connection", (socket) => {

        console.log("🔌 Dashboard connected");

        socket.on("command", (data) => {

            console.log("📡 Command from dashboard:", data);

            for (const id in cluster.workers) {
                cluster.workers[id].send({
                    type: "command",
                    data
                });
            }

        });

    });

    server.listen(8443, () => {
        console.log("🌐 Dashboard running on http://localhost:8443");
    });

    // Fork worker
    for (let i = 0; i < numWorkers; i++) {
        cluster.fork({ WORKER_ID: i });
    }

    // Terima status dari worker
    cluster.on("message", (worker, message) => {
        if (message.type === "status") {
            io.emit("camera_status", message.data);
        }
    });

    cluster.on("exit", (worker) => {
        console.log(`❌ Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });

} else {
    require("./worker");
}