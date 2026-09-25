import { getConfig, getStatus, testConnection, applyConfig, reconnect } from '../services/dbManager.js';

export const getDbStatus = async (req, res) => {
  try {
    const status = getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const getDbConfig = async (req, res) => {
  try {
    const cfg = getConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const testDbConnection = async (req, res) => {
  try {
    const { uri } = req.body || {};
    await testConnection(uri);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
};

export const applyDbConfig = async (req, res) => {
  try {
    const { uri } = req.body || {};
    const result = await applyConfig({ uri });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
};

export const reconnectDb = async (req, res) => {
  try {
    const result = await reconnect();
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
};

export default {
  getDbStatus,
  getDbConfig,
  testDbConnection,
  applyDbConfig,
  reconnectDb,
};
