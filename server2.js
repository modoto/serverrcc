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

let worker, router, producer;
const transports = new Map();

(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  });

  router = await worker.createRouter({
    mediaCodecs: [
      { 
        kind: "video", 
        mimeType: "video/H264", // VP8
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1
        }
      },
      { 
        kind: "audio", 
        mimeType: "audio/opus", 
        clockRate: 48000, 
        channels: 2 
      }
    ]
  });

  console.log("🚀 Mediasoup ready (minimal test)");
  await startFFmpeg();

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
      listenIps: [{ ip: "0.0.0.0", announcedIp: "192.168.100.5" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000
    });

    transports.set(transport.id, transport);
    console.log("✅ transport created:", transport.id);

    //console.log("RTP port:", transport.touple.localPort);

    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
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

  socket.on("consume", async ({ transportId }, cb) => {
    console.log('ada consume');
    if (!router.canConsume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities
    })) {
      console.error("❌ Cannot consume");
      return;
    }

    const transport = transports.get(transportId);

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false
    });

    cb({
      producerId: producer.id,
      id: consumer.id,
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

  // dari file
  const argsFile = [
   "-re",
  "-stream_loop", "-1",
  "-i", "D:/IMI/SIRAM/Command Center/serverrcc/Spongebob.mp4",

  "-an",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-tune", "zerolatency",
  "-profile:v", "baseline",
  "-pix_fmt", "yuv420p",

  "-f", "rtp",
  `rtp://127.0.0.1:${port}?payload_type=96`
  ];

  spawn("ffmpeg", argsFile);
}

server.listen(8443, () => {
  console.log("🚀 https://192.168.100.5:8443");
});