import * as mediasoupClient from "https://esm.sh/mediasoup-client@3";

const socket = io("https://10.57.69.146:8443", {
  transports: ["websocket"]
});

const video = document.getElementById("video");

let device;
let transport;

(async () => {

  const rtpCapabilities = await new Promise(r =>
    socket.emit("getRtpCapabilities", r)
  );

  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  const params = await new Promise(r =>
    socket.emit("createTransport", r)
  );

  transport = device.createRecvTransport(params);

  transport.on("connect", ({ dtlsParameters }, cb) => {
    socket.emit("connectTransport", {
      transportId: transport.id,
      dtlsParameters
    });
    cb();
  });

  transport.on("connectionstatechange", state => {
    console.log("🚦 connection state:", state);
  });


  const consumerParams = await new Promise(r =>
    socket.emit("consume", {
      transportId: transport.id,
      rtpCapabilities: device.rtpCapabilities
    }, r)
  );

  const consumer = await transport.consume(consumerParams);

  await consumer.resume();
  
  const stream = new MediaStream([consumer.track]);
  video.srcObject = stream;

})();
