const fs = require("fs");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();
app.use(express.static("public"));

const server = https.createServer({
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem")
}, app);

const io = new Server(server);

let worker, router;
const transports = new Map();

(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 40100
  });

  router = await worker.createRouter({
    mediaCodecs: [
      { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }
    ]
  });

  console.log("🚀 Mediasoup ready (minimal test)");
})();

io.on("connection", socket => {
  console.log("🔗 client connected:", socket.id);
  socket.emit("join", socket.id);

  socket.on("rtpCapabilities", cb => {
    console.log("➡️ sent rtpCapabilities");
    cb(router.rtpCapabilities);
  });

  socket.on("createTransport", async cb => {
    console.log("🛠 createTransport request");
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: "1192.167.61.17" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000
    });

    transports.set(transport.id, transport);
    console.log("✅ transport created:", transport.id);

    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      // Tambahkan STUN/TURN server
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // {
        //   urls: "turn:your-turn-server:3478",
        //   username: "user",
        //   credential: "pass"
        // }
      ]
    });
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    console.log("🔗 connectTransport received:", transportId);
    const transport = transports.get(transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      console.log("✅ transport connected:", transportId);
    }
  });
});

server.listen(8443, () => {
  console.log("🚀 https://192.167.61.17:8443");
});