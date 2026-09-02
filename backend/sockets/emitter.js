let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function emitToRoom(room, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(room).emit(event, payload);
}

function emitToRequestRoom(requestId, event, payload) {
  emitToRoom(`request:${requestId}`, event, payload);
}

function emitToUserRoom(userId, event, payload) {
  emitToRoom(`user:${userId}`, event, payload);
}

function emitToDepartmentQueue(departmentId, event, payload) {
  emitToRoom(`department-queue:${departmentId}`, event, payload);
}

module.exports = { setIo, emitToRequestRoom, emitToUserRoom, emitToDepartmentQueue };
