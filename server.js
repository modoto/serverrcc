const fs = require("fs");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");
const { spawn } = require("child_process");

const app = express();
app.use(express.static("public"));

const server = https.createServer({
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem")
}, app);

const io = new Server(server);

let worker, router;
let producer;
const transports = new Map();

// ================= MEDIASOUP INIT =================
(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 40100
  });

  router = await worker.createRouter({
    mediaCodecs: [{
      kind: "video",
      mimeType: "video/H264",
      clockRate: 90000,
      parameters: {
        "packetization-mode": 1,
        "profile-level-id": "42e01f",
        "level-asymmetry-allowed": 1
      }
    }]
  });
  console.log("🚀 Mediasoup ready");
  await startFFmpeg();
})();

// ================= SOCKET =================
io.on("connection", socket => {
  console.log("🔗 client connected:", socket.id);
  socket.emit("join", socket.id);

  socket.on("rtpCapabilities", (callback) => {
    console.log("➡️ sent rtpCapabilities");
    callback(router.rtpCapabilities);
  });

  socket.on("createTransport", async callback => {
    console.log("🛠 createTransport request");
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: "192.168.10.202", announcedIp: "192.168.10.202" }], // ganti dengan IP server kamu
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000
    });

    transports.set(transport.id, transport);
    console.log("✅ transport created:", transport.id);

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    console.log("🔗 connectTransport received:", transportId);
    const transport = transports.get(transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      console.log("✅ transport connected:", transportId);
    } else {
      console.error("❌ transport not found:", transportId);
    }
  });

  socket.on("consume", async ({ rtpCapabilities }, cb) => {
    console.log("🎬 consume request");
    if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      console.error("❌ Cannot consume with given rtpCapabilities");
      return;
    }

    const transport = transports.values().next().value;
    if (!transport) {
      console.error("❌ No transport available for consume");
      return;
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: false
    });

    console.log("✅ consumer created:", consumer.id);

    cb({
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });
});

// ================= FFMPEG =================
async function startFFmpeg() {
  const plain = await router.createPlainTransport({
    listenIp: "127.0.0.1",
    rtcpMux: true,
    comedia: true
  });

  producer = await plain.produce({
    kind: "video",
    rtpParameters: {
      codecs: [{
        mimeType: "video/H264",
        payloadType: 96,
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f"
        }
      }],
      encodings: [{ ssrc: 12345678 }]
    }
  });

  const port = plain.tuple.localPort;
  console.log("🎥 FFmpeg RTP port:", port);

  spawn("ffmpeg", [
    "-rtsp_transport", "tcp",
    "-i", "rtsp://admin:spmkawal123%23@192.168.10.163:554/",
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "3.1",
    "-pix_fmt", "yuv420p",
    "-x264-params", "keyint=30:scenecut=0:bframes=0",
    "-payload_type", "96",
    "-f", "rtp",
    `rtp://192.168.10.202:${port}`
  ]);
}

// ================= START SERVER =================
server.listen(8443, () => {
  console.log("🚀 https://localhost:8443");
});