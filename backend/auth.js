const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET || 'versa_secret_key_local_only_2025';
const USERS = new Map();

async function register(username, password, role = 'user') {
  if (USERS.has(username)) throw new Error('User already exists');
  const hashedPassword = await bcrypt.hash(password, 10);
  USERS.set(username, { password: hashedPassword, role, created: new Date() });
  return { success: true, username, role };
}

async function login(username, password) {
  const user = USERS.get(username);
  if (!user) throw new Error('User not found');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error('Invalid password');
  
  const token = jwt.sign({ username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  return { token, username, role: user.role };
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } 
  catch (e) { throw new Error('Invalid token'); }
}

function authorize(requiredRole) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
      const decoded = verifyToken(token);
      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      req.user = decoded;
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

module.exports = { register, login, verifyToken, authorize };
