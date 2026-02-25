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

let worker;
let router;
let producer;
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
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1
        }
      }
    ]
  });

  console.log("🚀 Mediasoup ready");

  await startFFmpeg();

})();

io.on("connection", socket => {

  console.log("client connected", socket.id);

  socket.on("getRtpCapabilities", cb => {
    cb(router.rtpCapabilities);
  });

  socket.on("createTransport", async cb => {

    const transport = await router.createWebRtcTransport({
      listenIps: [{
        ip: "0.0.0.0",
        announcedIp: "192.168.100.5" // GANTI IP SERVER LUAR JIKA VPS
      }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });

    transports.set(transport.id, transport);

    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    const transport = transports.get(transportId);
    await transport.connect({ dtlsParameters });
  });

  socket.on("consume", async ({ transportId, rtpCapabilities }, cb) => {

    if (!router.canConsume({
      producerId: producer.id,
      rtpCapabilities
    })) {
      console.log("cannot consume");
      return;
    }

    const transport = transports.get(transportId);

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: false
    });

    cb({
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

});

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
        },

        rtcpFeedback: [          // ⭐ WAJIB ADA
          { type: "nack" },
          { type: "nack", parameter: "pli" },
          { type: "ccm", parameter: "fir" },
          { type: "goog-remb" },
          { type: "transport-cc" }
        ]
      }],

      encodings: [{ ssrc: 12345678 }],

      rtcp: {
        cname: "video",
        reducedSize: true
      }
    },

    enableTraceEvent: ["rtp", "keyframe", "pli", "fir"]
  });

  producer.on("trace", t => console.log("TRACE:", t));
  plain.on("tuple", t => console.log("plain tuple:", t));

  const port = plain.tuple.localPort;
  console.log("FFmpeg RTP port:", port);

  const args = [
    "-re",
    "-stream_loop", "-1",
    "-i", "D:/IMI/SIRAM/Command Center/serverrcc/video.mp4",

    "-an",

    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",

    "-pix_fmt", "yuv420p",

    "-profile:v", "baseline",
    "-level", "3.0",

    "-x264opts", "keyint=30:min-keyint=30:no-scenecut",
    "-g", "30",                     // KEYFRAME tiap 1 detik
    "-bf", "0",                     // no B frames

    "-bsf:v", "h264_mp4toannexb",

    "-f", "rtp",
    `rtp://127.0.0.1:${port}?payload_type=96&ssrc=12345678`
  ];



  spawn("ffmpeg", args);

  //const ffmpeg = spawn("ffmpeg", args);

  // ffmpeg.stderr.on("data", data => {
  //   console.log("FFmpeg:", data.toString());
  // });

  // ffmpeg.on("close", code => {
  //   console.log("FFmpeg closed:", code);
  // });
}

server.listen(8443, () => {
  console.log("https://192.168.100.5:8443");
});

setInterval(async () => {
  const stats = await producer.getStats();
  console.log("producer stats", stats);
}, 2000);
