const keytar = require('keytar');
const SERVICE_NAME = 'VERSA_CLASS';

class CredentialManager {
  async storeCredential(account, password) {
    await keytar.setPassword(SERVICE_NAME, account, password);
  }
  
  async retrieveCredential(account) {
    return await keytar.getPassword(SERVICE_NAME, account);
  }
  
  async deleteCredential(account) {
    await keytar.deletePassword(SERVICE_NAME, account);
  }
}

module.exports = new CredentialManager();
