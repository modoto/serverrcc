import * as mediasoupClient from "https://esm.sh/mediasoup-client@3";

console.log("🔥 client.js loaded");

const socket = io("https://localhost:8443", { transports: ["websocket"] });

let device, recvTransport;

socket.on("join", async clientId => {
  console.log("📥 join success:", clientId);

  const rtpCapabilities = await new Promise(res =>
    socket.emit("rtpCapabilities", res)
  );
  console.log("📥 rtpCapabilities:", rtpCapabilities);

  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  // 1️⃣ MINTA TRANSPORT KE SERVER
  const recvParams = await new Promise(res =>
    socket.emit("createTransport", res)
  );
  console.log("📥 recvParams:", recvParams);

  // 2️⃣ BUAT RECV TRANSPORT DI CLIENT
  recvTransport = device.createRecvTransport(recvParams);

  // 3️⃣ CONNECT TRANSPORT (DTLS)
  recvTransport.on("connect", ({ dtlsParameters }, cb) => {
    console.log("➡️ connectTransport fired:", dtlsParameters);
    socket.emit("connectTransport", {
      transportId: recvTransport.id,
      dtlsParameters
    });
    cb();
  });

  // 4️⃣ STATE CHANGE
  recvTransport.on("connectionstatechange", state => {
    console.log("🚦 connection state:", state);
    if (state === "connected") consume();
  });
});

function consume() {
  console.log("🎬 consume request from client");
  socket.emit("consume", { rtpCapabilities: device.rtpCapabilities }, async params => {
    console.log("📥 consume params:", params);

    const consumer = await recvTransport.consume({
      id: params.id,
      producerId: params.producerId,
      kind: params.kind,
      rtpParameters: params.rtpParameters
    });

    await consumer.resume();
    console.log("✅ consumer resumed:", consumer.id);

    const stream = new MediaStream([consumer.track]);
    const video = document.getElementById("video");
    video.srcObject = stream;
    await video.play().catch(err => {
      console.warn("⚠️ video play blocked:", err);
    });
  });
}