const fs = require("fs");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");
const { spawn } = require("child_process");

const app = express();
app.use(express.static("public"));

const httpsServer = https.createServer({
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem")
}, app);

const io = new Server(httpsServer);

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
  //await startFFmpeg();
  await startRTSP('rtsp://10.57.69.86:1554/live/1');

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
        announcedIp: "10.57.69.146" // GANTI IP SERVER
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
    await transports.get(transportId).connect({ dtlsParameters });
  });

  socket.on("consume", async ({ transportId, rtpCapabilities }, cb) => {

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

async function startRTSP(rtspUrl) {

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
      encodings: [{ ssrc: 22222222 }],
      rtcp: { cname: "video" }
    }
  });

  const port = plain.tuple.localPort;
  console.log("🎥 RTP Port:", port);
  console.log("Producer ID:", producer.id);

  const args = [
  "-rtsp_transport", "tcp",
  "-i", rtspUrl,

  "-an",

  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-tune", "zerolatency",
  "-pix_fmt", "yuv420p",

  "-profile:v", "baseline",
  "-level", "3.0",

  "-g", "30",
  "-bf", "0",

  "-f", "rtp",
  `rtp://127.0.0.1:${port}?payload_type=96&ssrc=22222222`
];

  console.log("🚀 Starting FFmpeg RTSP...");

  const ffmpeg = spawn("ffmpeg", args);

  ffmpeg.stderr.on("data", data => {
    console.log("FFmpeg:", data.toString());
  });

  ffmpeg.on("close", () => {
    console.log("FFmpeg stopped. Restarting in 3s...");
    setTimeout(() => startRTSP(rtspUrl), 3000);
  });
}

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
      encodings: [{ ssrc: 22222222 }],
      rtcp: { cname: "video" }
    }
  });

  const port = plain.tuple.localPort;
  console.log("FFmpeg RTP port:", port);

  const args = [
    "-re",
    "-stream_loop", "-1",
    "-i", "video.mp4",

    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",

    "-profile:v", "baseline",
    "-level", "3.0",

    "-x264opts", "keyint=30:min-keyint=30:no-scenecut",
    "-g", "30",
    "-bf", "0",

    "-bsf:v", "h264_mp4toannexb",

    "-f", "rtp",
    `rtp://127.0.0.1:${port}?payload_type=96&ssrc=22222222`
  ];

  const ffmpeg = spawn("ffmpeg", args);

  ffmpeg.stderr.on("data", d => {
    console.log("FFmpeg:", d.toString());
  });
}

httpsServer.listen(8443, () => {
  console.log("https://192.168.100.5:8443");
});
