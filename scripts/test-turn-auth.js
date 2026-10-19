const dgram = require('dgram');
const crypto = require('crypto');

function testTurn(username, password, host, port) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let tid1 = crypto.randomBytes(12);

    // Step 1: Send unauthenticated Allocate Request (0x0003)
    // STUN Header: Type (2 bytes) = 0x0003, Length (2 bytes) = 0x0004 (REQUESTED-TRANSPORT attribute), Magic Cookie (4 bytes) = 0x2112A442, Transaction ID (12 bytes)
    const req1 = Buffer.alloc(24);
    req1.writeUInt16BE(0x0003, 0); // Allocate
    req1.writeUInt16BE(4, 2);      // Length
    req1.writeUInt32BE(0x2112A442, 4); // Magic cookie
    tid1.copy(req1, 8);
    // Attribute 0x0019: REQUESTED-TRANSPORT, length 4, protocol 17 (UDP)
    req1.writeUInt16BE(0x0019, 20);
    req1.writeUInt16BE(4, 22);
    // Note: buffer is 28 bytes
    const fullReq1 = Buffer.alloc(28);
    req1.copy(fullReq1, 0);
    fullReq1[24] = 17; // UDP
    fullReq1[25] = 0;
    fullReq1[26] = 0;
    fullReq1[27] = 0;

    socket.send(fullReq1, port, host);

    socket.on('message', (msg) => {
      const msgType = msg.readUInt16BE(0);
      const msgLen = msg.readUInt16BE(2);
      if (msgType === 0x0113) {
        // 401 Unauthorized -> extract realm and nonce
        let offset = 20;
        let realm = '';
        let nonce = '';
        while (offset < 20 + msgLen) {
          const attrType = msg.readUInt16BE(offset);
          const attrLen = msg.readUInt16BE(offset + 2);
          const attrVal = msg.slice(offset + 4, offset + 4 + attrLen);
          if (attrType === 0x0014) realm = attrVal.toString();
          if (attrType === 0x0015) nonce = attrVal.toString();
          offset += 4 + Math.ceil(attrLen / 4) * 4;
        }

        console.log(`[${username}] Received 401 Challenge. Realm: "${realm}", Nonce: "${nonce.slice(0, 15)}..."`);

        // Step 2: Send authenticated Allocate Request
        const tid2 = crypto.randomBytes(12);
        
        // Attributes:
        // 1. REQUESTED-TRANSPORT (0x0019, 4 bytes)
        // 2. USERNAME (0x0006)
        // 3. REALM (0x0014)
        // 4. NONCE (0x0015)
        // 5. MESSAGE-INTEGRITY (0x0008, 20 bytes)
        const userBuf = Buffer.from(username);
        const realmBuf = Buffer.from(realm);
        const nonceBuf = Buffer.from(nonce);

        const pad = (n) => (4 - (n % 4)) % 4;
        const attrReqTrans = Buffer.from([0x00, 0x19, 0x00, 0x04, 17, 0, 0, 0]);
        
        const attrUser = Buffer.concat([
          Buffer.from([0x00, 0x06, 0, userBuf.length]),
          userBuf,
          Buffer.alloc(pad(userBuf.length))
        ]);

        const attrRealm = Buffer.concat([
          Buffer.from([0x00, 0x14, 0, realmBuf.length]),
          realmBuf,
          Buffer.alloc(pad(realmBuf.length))
        ]);

        const attrNonce = Buffer.concat([
          Buffer.from([0x00, 0x15, 0, nonceBuf.length]),
          nonceBuf,
          Buffer.alloc(pad(nonceBuf.length))
        ]);

        // Message body before MESSAGE-INTEGRITY
        const bodyBeforeMI = Buffer.concat([attrReqTrans, attrUser, attrRealm, attrNonce]);
        
        // Compute STUN key: MD5(username + ":" + realm + ":" + password)
        const key = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest();

        // Length for header must include MESSAGE-INTEGRITY (24 bytes: 4 header + 20 HMAC)
        const totalMsgLen = bodyBeforeMI.length + 24;

        const header2 = Buffer.alloc(20);
        header2.writeUInt16BE(0x0003, 0);
        header2.writeUInt16BE(totalMsgLen, 2);
        header2.writeUInt32BE(0x2112A442, 4);
        tid2.copy(header2, 8);

        const dataToHmac = Buffer.concat([header2, bodyBeforeMI]);
        const hmac = crypto.createHmac('sha1', key).update(dataToHmac).digest();

        const attrMI = Buffer.concat([
          Buffer.from([0x00, 0x08, 0x00, 0x14]),
          hmac
        ]);

        const fullReq2 = Buffer.concat([dataToHmac, attrMI]);

        socket.removeAllListeners('message');
        socket.on('message', (msg2) => {
          const type2 = msg2.readUInt16BE(0);
          socket.close();
          if (type2 === 0x0103) {
            console.log(`>>> [SUCCESS] Username "${username}" with password "${password}" AUTHENTICATED SUCCESSFULLY! (0x0103 Allocate Success)`);
            resolve(true);
          } else {
            console.log(`>>> [FAILED] Username "${username}" failed with response: 0x${type2.toString(16)} (401 Unauthorized or Error)`);
            resolve(false);
          }
        });

        socket.send(fullReq2, port, host);
      }
    });

    setTimeout(() => {
      try { socket.close(); } catch (e) {}
      resolve(false);
    }, 4000);
  });
}

async function run() {
  console.log('--- Testing Credential 1: 5c4d3a1801d64ed7030aeb8a ---');
  await testTurn('5c4d3a1801d64ed7030aeb8a', 'Uax0Q3gUq2xlpq/w', 'global.relay.metered.ca', 80);

  console.log('\n--- Testing Credential 2: 6c4d3a1081d64ed7836aeb0a ---');
  await testTurn('6c4d3a1081d64ed7836aeb0a', 'Uax0Q3gUq2xlpq/w', 'global.relay.metered.ca', 80);
}

run();
