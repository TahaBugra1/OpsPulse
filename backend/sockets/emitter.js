let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function emitToRequestRoom(requestId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(`request:${requestId}`).emit(event, payload);
}

module.exports = { setIo, emitToRequestRoom };
