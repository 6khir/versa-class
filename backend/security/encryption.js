const crypto = require('crypto');

class DataEncryption {
  constructor(masterKey, salt = process.env.ENCRYPTION_SALT || 'versa_class_scrypt_salt_v1') {
    this.masterKey = crypto.scryptSync(masterKey, salt, 32);
  }
  
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }
  
  decrypt(encryptedData) {
    if (!encryptedData || !encryptedData.iv || !encryptedData.authTag || !encryptedData.encrypted) {
      throw new Error('Invalid encrypted payload structure');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.masterKey,
      Buffer.from(encryptedData.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }
}

module.exports = DataEncryption;
