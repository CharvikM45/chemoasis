// Encrypts profile data (questionnaire answers are health information) before it's stored.
// AES-256-GCM with a 32-byte key from the DATA_KEY environment variable (base64).
// Without a key (tests, local development) data is stored as plain JSON, and the server says so
// at startup in production. Stored rows look like { "enc": { "v": 1, "iv", "tag", "data" } }.
const crypto = require('crypto');

function makeBox(keyBase64) {
  if (!keyBase64) return null;
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('DATA_KEY must be 32 random bytes, base64-encoded (for example: openssl rand -base64 32).');
  return {
    seal(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return { enc: { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') } };
    },
    open(stored) {
      if (!stored || !stored.enc) return stored; // written before encryption was turned on
      const { iv, tag, data } = stored.enc;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
    }
  };
}

module.exports = { makeBox };
